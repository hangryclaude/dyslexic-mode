import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordParser, speak, locate } from '../lib/voice.mjs';
import { readInPlace, runs } from '../lib/reader.mjs';
import { layout } from '../lib/render.mjs';
import { spoken } from '../lib/style.mjs';

const FAKE_SAY = fileURLToPath(new URL('./fixtures/fake-say.mjs', import.meta.url));

// The exact bytes macOS 26 `say --interactive=bold` wrote for three lines with a blank one
// between, recorded on Angus's Mac. The first line starts with an embedded volume command.
const REAL = [
  '\x1b[?25l',
  '\r\x1b[M[[volm 0.02]]\x1b[1mFirst\x1b(B\x1b[m line here.',
  '\r\x1b[M[[volm 0.02]]First \x1b[1mline\x1b(B\x1b[m here.',
  '\r\x1b[M[[volm 0.02]]First line \x1b[1mhere.\x1b(B\x1b[m',
  '\r\x1b[M[[volm 0.02]]First line here.\n\n\x1b[1mSecond,\x1b(B\x1b[m with a comma.',
  '\r\x1b[MSecond, \x1b[1mwith\x1b(B\x1b[m a comma.',
  '\r\x1b[MSecond, with \x1b[1ma\x1b(B\x1b[m comma.\r\x1b[MSecond, with a \x1b[1mcomma.\x1b(B\x1b[m',
  '\r\x1b[MSecond, with a comma.\n\x1b[1mThird\x1b(B\x1b[m line: 2.0 TB free.',
  '\r\x1b[MThird \x1b[1mline:\x1b(B\x1b[m 2.0 TB free.',
  '\r\x1b[MThird line: \x1b[1m2.0\x1b(B\x1b[m TB free.',
  '\r\x1b[MThird line: 2.0 \x1b[1mTB\x1b(B\x1b[m free.',
  '\r\x1b[MThird line: 2.0 TB \x1b[1mfree.\x1b(B\x1b[m',
  '\r\x1b[MThird line: 2.0 TB free.\n\x1b[?12l\x1b[?25h',
  '\x1b[?12l\x1b[?25h',
].join('');
const WORDS = [
  [0, 13, 18, 'First'], [0, 19, 23, 'line'], [0, 24, 29, 'here.'],
  [2, 0, 7, 'Second,'], [2, 8, 12, 'with'], [2, 13, 14, 'a'], [2, 15, 21, 'comma.'],
  [3, 0, 5, 'Third'], [3, 6, 11, 'line:'], [3, 12, 15, '2.0'], [3, 16, 18, 'TB'], [3, 19, 24, 'free.'],
];
const parse = chunks => {
  const got = [];
  const feed = wordParser((...e) => got.push(e));
  for (const c of chunks) feed(c);
  return got;
};

test('real say output becomes one event per word, with the first word of each line kept', () => {
  assert.deepEqual(parse([REAL]), WORDS);
});

test('the word events are the same however the bytes are split', () => {
  for (let cut = 1; cut < REAL.length; cut++) assert.deepEqual(parse([REAL.slice(0, cut), REAL.slice(cut)]), WORDS, `cut at ${cut}`);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 50; round++) {
    const chunks = [];
    for (let i = 0; i < REAL.length;) { const n = 1 + Math.floor(rand() * 9); chunks.push(REAL.slice(i, i + n)); i += n; }
    assert.deepEqual(parse(chunks), WORDS);
  }
});

test('locate trusts say offsets that match, and finds the word by text when they do not', () => {
  assert.deepEqual(locate('Plug the SSD in.', 'the', 5, 8), [5, 8]);
  assert.deepEqual(locate('Plug the SSD in.', 'SSD', 0, 3), [9, 12]);
  assert.deepEqual(locate('a b a b', 'a', 9, 10, 2), [4, 5]);
  assert.equal(locate('one two', 'three', 0, 5), null);
});

test('speak passes rate and voice, counts lines from `from`, and reports every word', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-say-'));
  process.env.SAY_LOG = join(dir, 'argv');
  const got = [];
  const ctl = speak(['zero here', 'One two.', 'Three'], { from: 1, rate: 200, voice: 'Daniel', bin: FAKE_SAY, onWord: (...e) => got.push(e) });
  assert.equal(await ctl.done, true);
  assert.deepEqual(got, [[1, 0, 3, 'One'], [1, 4, 8, 'two.'], [2, 0, 5, 'Three']]);
  assert.deepEqual(JSON.parse(readFileSync(process.env.SAY_LOG, 'utf8')), ['--interactive=bold', '-r', '200', '-v', 'Daniel']);
});

test('stop ends the voice early, even while paused, and says it did not finish', async () => {
  process.env.SAY_MS = '40';
  const got = [];
  const ctl = speak(['a b c d e f g h i j'], { bin: FAKE_SAY, onWord: (...e) => got.push(e) });
  await new Promise(r => setTimeout(r, 60));
  ctl.pause();
  assert.equal(ctl.paused, true);
  ctl.stop();
  assert.equal(await ctl.done, false);
  assert.ok(got.length < 10, `${got.length} words`);
  delete process.env.SAY_MS;
});

test('a missing say says what it needs', async () => {
  await assert.rejects(speak(['hi'], { bin: '/nonexistent/say' }).done, /needs the macOS say command/);
});

test('reading in place lights each word where it sits, then puts it back', async () => {
  const writes = [];
  const out = { columns: 80, rows: 24, write: s => writes.push(s) };
  const { lines, units } = layout('one two\nthree four', { width: 72, columns: 80 });
  const ctl = readInPlace(out, { lines, units, below: 4 }, { bin: FAKE_SAY });
  await ctl.done;
  // "two" is on the first of two lines, 4 columns in; the prompt sits 4 rows under the last.
  assert.ok(writes.includes(`\x1b7\x1b[5A\r\x1b[6C${spoken('two')}\x1b8`), writes.join('\n'));
  assert.ok(writes.includes(`\x1b7\x1b[4A\r\x1b[2C${spoken('three')}\x1b8`));
  assert.equal(writes.at(-1), '\x1b7\x1b[4A\r\x1b[8Cfour\x1b8', 'the last word goes back to normal');
});

test('reading in place skips lines that have scrolled out of view', async () => {
  const writes = [];
  const out = { columns: 80, rows: 5, write: s => writes.push(s) };
  const { lines, units } = layout('top line\n\nbottom', { width: 72, columns: 80 });
  await readInPlace(out, { lines, units, below: 3 }, { bin: FAKE_SAY }).done;
  assert.ok(writes.every(w => !w.includes('top')), 'the top line is 5 rows up, off a 5-row screen');
  assert.ok(writes.some(w => w.includes(spoken('bottom'))));
});

test('say can speak two words as one, and lighting them keeps the space between', async () => {
  process.env.SAY_WORDS = 'credit card|\\S+';
  const writes = [];
  const out = { columns: 80, rows: 24, write: s => writes.push(s) };
  const { lines, units } = layout('A credit card lets you', { width: 72, columns: 80 });
  await readInPlace(out, { lines, units, below: 4 }, { bin: FAKE_SAY }).done;
  delete process.env.SAY_WORDS;
  assert.ok(writes.includes(`\x1b7\x1b[4A\r\x1b[4C${spoken('credit card')}\x1b8`), writes.join('\n'));
  assert.ok(writes.includes('\x1b7\x1b[4A\r\x1b[4Ccredit card\x1b8'), 'put back exactly as it was');
});

test('a lit range that crosses a wrap is drawn as one run per line', () => {
  const { lines, units } = layout('alpha beta gamma delta', { width: 10, columns: 80 });
  // The spaces at the two wrap points are never drawn, so they have no place on screen.
  const cells = units[0].cells.filter(c => c.at).slice(6, 15);
  assert.deepEqual(runs(cells).map(r => r.map(c => c.ch).join('')), ['beta', 'gamma']);
  assert.equal(lines.length, 3);
});
