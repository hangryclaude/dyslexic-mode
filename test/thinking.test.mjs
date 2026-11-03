import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, STYLE_NAMES, withStyle, scramble, scrambled, LENSES } from '../lib/thinking.mjs';
import { explore } from '../lib/explorer.mjs';

test('every style but base has text, and withStyle puts the question last', () => {
  for (const name of STYLE_NAMES) if (name !== 'base') assert.ok(STYLES[name].length > 100, name);
  assert.equal(withStyle('base', 'Q?'), 'Q?');
  assert.match(withStyle('dyslexic', 'Q?'), /^How to think:\n[\s\S]+\n\nQuestion:\nQ\?$/);
  assert.throws(() => withStyle('nope', 'Q?'), /unknown thinking style/);
});

test('scramble keeps first and last letters, numbers and short words, and is seeded', () => {
  const q = 'You stand at x=0, y=0 facing north. Walk forward 12 steps.';
  const s = scramble(q, 7);
  assert.equal(s, scramble(q, 7));
  assert.notEqual(s, q);
  const words = q.split(/\b/), got = s.split(/\b/);
  assert.equal(got.length, words.length);
  words.forEach((w, i) => {
    if (/^[A-Za-z]{4,}$/.test(w)) {
      assert.equal(got[i][0], w[0]);
      assert.equal(got[i].at(-1), w.at(-1));
      assert.deepEqual([...got[i]].sort(), [...w].sort());
    } else assert.equal(got[i], w);
  });
  assert.match(scrambled(q, 7), /jumbled[\s\S]*Question:\n/);
});

test('explore asks once per lens at the same time, then combines every draft', async () => {
  const asked = [];
  let open = 0, peak = 0;
  const ask = async prompt => {
    asked.push(prompt);
    open++; peak = Math.max(peak, open);
    await new Promise(r => setTimeout(r, 5));
    open--;
    return prompt.startsWith('Three thinkers') ? 'ANSWER: 4' : `draft ${asked.length}`;
  };
  const { text, drafts } = await explore('2+2?', ask, { format: 'End with ANSWER: <n>' });
  assert.equal(asked.length, Object.keys(LENSES).length + 1);
  assert.equal(peak, Object.keys(LENSES).length);
  assert.equal(drafts.length, 3);
  assert.equal(text, 'ANSWER: 4');
  const last = asked.at(-1);
  for (const d of drafts) assert.ok(last.includes(d.text));
  assert.ok(last.endsWith('End with ANSWER: <n>'));
});
