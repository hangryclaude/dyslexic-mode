import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, LEVEL_NAMES, promptThinking, transcript, withHistory, exploreTurn } from '../lib/think.mjs';
import { STYLES } from '../lib/thinking.mjs';
import { reply } from '../lib/filter.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));

test('there are five thinking levels, off first, each with a one-line description', () => {
  assert.deepEqual(LEVEL_NAMES, ['off', 'dyslexic', 'strong', 'extreme', 'explorer']);
  for (const [name, help] of LEVELS) assert.ok(help && !help.includes('\n'), name);
});

test('only the prompt styles reach systemPrompt: off and explorer add nothing to it', () => {
  assert.equal(promptThinking('off'), undefined);
  assert.equal(promptThinking('explorer'), undefined);
  for (const level of ['dyslexic', 'strong', 'extreme']) {
    assert.equal(promptThinking(level), level);
    assert.ok(level in STYLES, `${level} is a style the thinking module knows`);
  }
});

test('the transcript keeps the last three turns, trims long ones, and rides inside the question', () => {
  const history = [{ q: 'one', text: 'A1' }, { q: 'two', text: 'A2' }, { q: 'three', text: 'A3' }, { q: 'four', text: 'A4' }];
  assert.equal(withHistory('now', []), 'now');
  const q = withHistory('now', history);
  assert.match(q, /^Earlier in this chat:\nYou: two\nClaude: A2\n\nYou: three\nClaude: A3\n\nYou: four\nClaude: A4\n\nNew message:\nnow$/);
  assert.doesNotMatch(q, /You: one/);
  assert.match(transcript([{ q: 'x'.repeat(2000), text: 'y' }], { max: 10 }), /^You: x{10}…\nClaude: y$/);
});

// An ask that takes a moment, so calls overlap, and that obeys its signal like the real one.
function fakeAsk({ delay = 5, say = p => (p.startsWith('Three thinkers') ? 'FINAL' : 'a draft'), fail = () => false } = {}) {
  const calls = [];
  let open = 0, peak = 0;
  const ask = (prompt, { signal }) => new Promise((resolve, reject) => {
    calls.push(prompt);
    open++;
    peak = Math.max(peak, open);
    const n = calls.length;
    let settled = false;
    const settle = fn => { if (!settled) { settled = true; open--; fn(); } };
    signal.addEventListener('abort', () => settle(() => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))), { once: true });
    setTimeout(() => settle(() => (fail(prompt) ? reject(new Error('boom')) : resolve({ text: say(prompt), usage: { output_tokens: n }, contextWindow: 123 }))), delay);
  });
  return { ask, calls, peak: () => peak, open: () => open };
}

test('an explore turn asks once per lens at the same time, then weighs the drafts, and says so', async () => {
  const f = fakeAsk(), status = [];
  const turn = exploreTurn({ ask: f.ask, onStatus: s => status.push(s) });
  const r = await turn.go('the question');
  assert.deepEqual(status, ['exploring 3 ways', 'weighing 3 drafts']);
  assert.equal(f.calls.length, 4);
  assert.equal(f.peak(), 3);
  assert.ok(f.calls.at(-1).startsWith('Three thinkers') && f.calls.at(-1).includes('the question'));
  assert.equal(r.text, 'FINAL');
  assert.deepEqual(r.usage, { output_tokens: 4 }, 'the usage is the last call, the one that weighed the drafts');
  assert.equal(r.contextWindow, 123);
});

test('stopping an explore turn ends every call and reports it stopped', async () => {
  const f = fakeAsk({ delay: 300 });
  const turn = exploreTurn({ ask: f.ask });
  const running = turn.go('q');
  await wait(20);
  assert.equal(turn.stop(), true);
  assert.deepEqual(await running, { text: '', stopped: true });
  assert.equal(f.calls.length, 3, 'it never got as far as weighing');
  assert.equal(f.open(), 0);
});

test('one draft failing ends the others and the error comes through', async () => {
  const f = fakeAsk({ delay: 50, fail: p => p.startsWith('Solve this by looking') });
  const turn = exploreTurn({ ask: f.ask });
  await assert.rejects(turn.go('q'), /boom/);
  assert.equal(f.open(), 0, 'the other two were ended, not left running');
});

test('through reply, the rewrite pass is one plain call and not a second exploration', async () => {
  const long = Array(40).fill('word').join(' ') + '.';
  const f = fakeAsk({ say: p => (p.startsWith('Three thinkers') ? long : p.startsWith('Your last reply') ? 'Short and clear.' : 'a draft') });
  const turn = exploreTurn({ ask: f.ask });
  const r = await reply(turn.go, 'q', {});
  assert.equal(f.calls.length, 5, 'three drafts, the weighing, then the rewrite');
  assert.ok(f.calls.at(-1).startsWith('Your last reply'));
  assert.equal(r.rewrites, 1);
  assert.equal(r.text, 'Short and clear.');
});
