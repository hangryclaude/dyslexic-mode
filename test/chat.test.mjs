import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask } from '../lib/claude.mjs';
import { reply } from '../lib/filter.mjs';
import { systemPrompt, rewritePrompt } from '../lib/prompt.mjs';
import { leet, plinyfy, DIVIDER } from '../lib/pliny.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

test('leet swaps prose letters', () => {
  assert.equal(leet('hello toast'), 'h3ll0 70457');
});

test('leet leaves code, inline code, urls and paths alone', () => {
  const src = 'go to `npm test` at https://example.com/a and ~/dev/site\n```js\nconst a = 1\n```';
  assert.equal(leet(src), 'g0 70 `npm test` 47 https://example.com/a 4nd ~/dev/site\n```js\nconst a = 1\n```');
});

test('plinyfy wraps the reply in dividers', () => {
  const s = plinyfy('ok');
  assert.ok(s.startsWith(DIVIDER) && s.endsWith(DIVIDER));
  assert.match(s, /0k/);
});

test('system prompt carries the skill body, not its frontmatter', () => {
  const s = systemPrompt('---\nname: x\n---\n# Pass\nrule one');
  assert.match(s, /rule one/);
  assert.doesNotMatch(s, /name: x/);
  assert.match(systemPrompt(), /The pass, part 1/);
});

test('rewrite prompt lists each hard hit and the draft', () => {
  const s = rewritePrompt('draft text', [{ line: 2, rule: 'long-sentence', message: '30 words', suggestion: 'split' }]);
  assert.match(s, /line 2: long-sentence, 30 words → split/);
  assert.match(s, /<reply>\ndraft text\n<\/reply>/);
});

test('ask talks to the CLI over stream-json with tools and user settings off', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'dm-')), 'argv');
  process.env.FAKE_LOG = log;
  const r = await ask('-starts with a dash', { system: 'SYS', sessionId: 'old', model: 'haiku', bin: FAKE });
  assert.deepEqual(r, { text: 'echo: -starts with a dash', sessionId: 'sess-1' });
  const argv = JSON.parse(readFileSync(log, 'utf8'));
  for (const pair of [['--tools', ''], ['--setting-sources', ''], ['--system-prompt', 'SYS'], ['--resume', 'old'], ['--model', 'haiku']])
    assert.equal(argv[argv.indexOf(pair[0]) + 1], pair[1], pair[0]);
});

test('ask rejects on an error result', async () => {
  await assert.rejects(ask('FAIL now', { system: 's', bin: FAKE }), /boom/);
});

test('reply keeps a clean answer without a rewrite', async () => {
  const calls = [];
  const fake = async p => { calls.push(p); return { text: 'Short and clear.', sessionId: 's' }; };
  const r = await reply(fake, 'hi', {});
  assert.equal(calls.length, 1);
  assert.deepEqual({ rewrites: r.rewrites, hard: r.hard }, { rewrites: 0, hard: 0 });
});

test('reply rewrites once on a hard hit, and never twice', async () => {
  const long = Array(40).fill('word').join(' ') + '.';
  const calls = [];
  const fake = async (p, o) => { calls.push({ p, o }); return { text: long, sessionId: 's2' }; };
  const r = await reply(fake, 'hi', { system: 'S' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].p, /long-sentence/);
  assert.equal(calls[1].o.sessionId, 's2');
  assert.equal(r.rewrites, 1);
  assert.ok(r.hard > 0);
});
