import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextWindow, estimateTokens, usedTokens, measure, breakdown, barCounts, bar, count, share } from '../lib/context.mjs';
import { openSession } from '../lib/session.mjs';
import { ask } from '../lib/claude.mjs';
import { models } from '../lib/modelmenu.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
beforeEach(() => { process.env.DYSLEXIC_MODE_HOME = join(mkdtempSync(join(tmpdir(), 'dm-ctx-')), 'home'); });
afterEach(() => { delete process.env.FAKE_WINDOW; });

test('the window is 200k, 1M when the id has [1m], a listed size wins, and what claude reported wins over all', () => {
  assert.equal(contextWindow('sonnet'), 200_000);
  assert.equal(contextWindow(undefined), 200_000);
  assert.equal(contextWindow('opus[1m]'), 1_000_000);
  assert.equal(contextWindow('claude-sonnet-4-5[1M]'), 1_000_000);
  assert.equal(contextWindow('other-model', { known: [{ id: 'other-model', contextWindow: 400_000 }] }), 400_000);
  assert.equal(contextWindow('opus[1m]', { known: [{ id: 'opus[1m]', contextWindow: 800_000 }] }), 800_000);
  assert.equal(contextWindow('opus[1m]', { reported: 500_000 }), 500_000);
  assert.equal(contextWindow('haiku', { known: models() }), models()[0].contextWindow);
});

test('context in use is everything read plus what was written, and a missing field counts as zero', () => {
  assert.equal(usedTokens({ input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 7 }), 130);
  assert.equal(usedTokens({ output_tokens: 7 }), 7);
  assert.equal(usedTokens(undefined), 0);
  assert.equal(estimateTokens('x'.repeat(401)), 101);
  assert.equal(estimateTokens(''), 0);
});

test('a result gives its usage and the window of the model that did the most work', () => {
  const usage = { input_tokens: 4, cache_creation_input_tokens: 54164, cache_read_input_tokens: 1678, output_tokens: 192, iterations: [], service_tier: 'standard' };
  const modelUsage = {
    side: { inputTokens: 5, outputTokens: 5, contextWindow: 200_000 },
    main: { inputTokens: 4, cacheReadInputTokens: 1678, cacheCreationInputTokens: 54164, outputTokens: 192, contextWindow: 1_000_000 },
  };
  assert.deepEqual(measure({ usage, modelUsage }), {
    usage: { input_tokens: 4, cache_read_input_tokens: 1678, cache_creation_input_tokens: 54164, output_tokens: 192 },
    contextWindow: 1_000_000,
  });
  assert.deepEqual(measure({}), {}, 'an old claude that reports nothing gives nothing');
  assert.deepEqual(measure({ modelUsage: { m: { inputTokens: 1 } } }), {}, 'no window reported, no window claimed');
});

test('the last call of a turn beats the turn total, which counts every call and reads far too big', () => {
  // The numbers come from a real claude turn with one tool call, so two API calls.
  const total = { input_tokens: 4, cache_creation_input_tokens: 54164, cache_read_input_tokens: 1678, output_tokens: 192 };
  const last = { input_tokens: 2, cache_creation_input_tokens: 51627, cache_read_input_tokens: 1678, output_tokens: 117, service_tier: 'standard' };
  assert.equal(usedTokens(measure({ usage: total }).usage), 56038);
  assert.equal(usedTokens(measure({ usage: total }, last).usage), 53424);
});

test('before a reply only the system prompt is counted, and after one it is carved out of the measured total', () => {
  const none = breakdown({ window: 200_000, system: 4000 });
  assert.equal(none.measured, false);
  assert.deepEqual(none.parts, [['system', 4000], ['conversation', 0], ['free', 196_000]]);
  const usage = { input_tokens: 3, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000, output_tokens: 500 };
  const after = breakdown({ window: 200_000, usage, system: 4000 });
  assert.equal(after.measured, true);
  assert.equal(after.used, 10_503);
  assert.deepEqual(after.parts, [['system', 4000], ['conversation', 6503], ['free', 189_497]]);
  // A guess bigger than the measured total never makes the conversation negative.
  assert.deepEqual(breakdown({ window: 200_000, usage: { input_tokens: 100 }, system: 4000 }).parts, [['system', 100], ['conversation', 0], ['free', 199_900]]);
  assert.equal(breakdown({ window: 1000, usage: { input_tokens: 5000 }, system: 10 }).parts[2][1], 0, 'past the window nothing is free');
});

test('the bar adds up to its width, shows each part that exists, and never looks full with room left', () => {
  const window = 200_000, width = 40;
  for (const [sys, chat] of [[0, 0], [1000, 0], [4000, 6503], [100_000, 99_000], [1, 1], [100, 150_000], [150_000, 60_000], [199_000, 0]]) {
    const counts = barCounts([['system', sys], ['conversation', chat], ['free', Math.max(0, window - sys - chat)]], window, width);
    const label = `${sys}/${chat}: ${counts}`;
    assert.equal(counts.reduce((a, b) => a + b), width, label);
    assert.ok(counts.every(n => n >= 0), label);
    if (sys > 0) assert.ok(counts[0] >= 1, label);
    if (chat > 0 && sys + chat < window) assert.ok(counts[1] >= 1, label);
    if (sys + chat < window) assert.ok(counts[2] >= 1, label);
    else assert.equal(counts[2], 0, label);
  }
  assert.deepEqual(barCounts([['system', 0], ['conversation', 0], ['free', window]], window, width), [0, 0, 40]);
  assert.equal(bar([2, 1, 3]), '▒▒█░░░');
  assert.equal(bar([1, 1, 1], (i, s) => `[${i}${s}]`), '[0▒][1█][2░]');
});

test('numbers read with commas, and shares keep a decimal while they are small', () => {
  assert.equal(count(1234567), '1,234,567');
  assert.equal(share(0, 1000), '0%');
  assert.equal(share(1, 1_000_000), '<0.1%');
  assert.equal(share(72_000, 1_000_000), '7.2%');
  assert.equal(share(500_000, 1_000_000), '50%');
  assert.equal(share(997_258, 1_000_000), '99.7%', 'nearly empty is not 100% free');
  assert.equal(share(999_990, 1_000_000), '99.9%');
  assert.equal(share(1_000_000, 1_000_000), '100%');
  assert.equal(share(1_200_000, 1_000_000), '120%', 'past the window it says so');
});

test('a session turn resolves with its usage, reads earlier turns back from the cache, and passes on the window claude reported', async () => {
  process.env.FAKE_WINDOW = '1000000';
  const s = openSession({ system: 'SYS', bin: FAKE });
  const a = await s.send('hello there');
  assert.equal(a.contextWindow, 1_000_000);
  assert.equal(usedTokens(a.usage), 3 + 3003 + 5);
  const b = await s.send('-and again');
  assert.deepEqual(b.usage, { input_tokens: 3, cache_read_input_tokens: 3000 + 3 + 5, cache_creation_input_tokens: 3, output_tokens: 4 });
  assert.ok(usedTokens(b.usage) > usedTokens(a.usage), 'a longer chat fills more');
  s.close();
});

test('with no window reported there is none claimed', async () => {
  const s = openSession({ system: 'SYS', bin: FAKE });
  const r = await s.send('hi');
  s.close();
  assert.ok(r.usage);
  assert.ok(!('contextWindow' in r));
});

test('after tool calls the usage is the last call, not the sum of every call in the turn', async () => {
  const s = openSession({ system: 'SYS', bin: FAKE, tools: true });
  const r = await s.send('TOOL go');
  s.close();
  // Two calls: the first read 3002 tokens and wrote 3. The second read the first back. Summed, the turn would read 6023.
  assert.deepEqual(r.usage, { input_tokens: 3, cache_read_input_tokens: 3005, cache_creation_input_tokens: 3, output_tokens: 4 });
  assert.equal(usedTokens(r.usage), 3015);
});

test('ask reports usage and the window too, and a signal ends the call with an AbortError', async () => {
  process.env.FAKE_WINDOW = '500000';
  const r = await ask('hi', { system: 'S', bin: FAKE });
  assert.equal(r.contextWindow, 500_000);
  assert.deepEqual(r.usage, { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 3001, output_tokens: 2 });
  const ctl = new AbortController();
  const slow = ask('SLOW now', { system: 'S', bin: FAKE, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 80);
  await assert.rejects(slow, { name: 'AbortError' });
  await assert.rejects(ask('hi', { system: 'S', bin: FAKE, signal: AbortSignal.abort() }), { name: 'AbortError' });
});
