import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readerView, readInPlace } from '../lib/reader.mjs';
import { print } from '../lib/render.mjs';
import { visible } from '../lib/style.mjs';

process.env.DYSLEXIC_SAY_BIN = fileURLToPath(new URL('./fixtures/fake-say.mjs', import.meta.url));
const TEXT = 'First paragraph here.\n\nSecond one is this.\n\nThird and last.';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (ok, ms = 2000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(5)) if (ok()) return;
  throw new Error('timed out');
};

// A terminal and a keyboard on paper: frames are kept, keys are pressed by hand.
function rig() {
  const frames = [];
  const out = { columns: 60, rows: 12, write: s => frames.push(s) };
  const input = Object.assign(new EventEmitter(), { resume() {} });
  input.on('keypress', () => { throw new Error('the chat must not get keys while the reader is open'); });
  const press = (s, key = { name: s }) => input.emit('keypress', s, key);
  // The last full frame, as rows. A faded row starts with the dim code.
  const rows = () => frames.filter(f => f.startsWith('\x1b[H')).at(-1).split('\n').map(r => r.replace(/^(\x1b\[H)?\x1b\[2K/, ''));
  const lit = () => rows().join('\n').match(/\x1b\[1;7m([^\x1b]*)/)?.[1];
  return { out, input, press, rows, lit, frames };
}

test('the reader lights the spoken word and fades every paragraph but the one being read', async () => {
  process.env.SAY_MS = '30';
  const r = rig();
  const done = readerView(r.out, r.input, TEXT, { rate: 180 });
  await until(() => r.lit());
  const rows = r.rows();
  assert.ok(!rows[0].includes('\x1b[2m'), 'the first paragraph is bright');
  assert.ok(rows[2].startsWith('  \x1b[2m'), 'the second is faded');
  assert.ok(['First', 'paragraph', 'here.'].includes(r.lit()), r.lit());
  r.press('right');
  await until(() => ['Second', 'one', 'is', 'this.'].includes(r.lit()));
  assert.ok(r.rows()[0].startsWith('  \x1b[2m'), 'after →, the first fades');
  assert.ok(!r.rows()[2].includes('\x1b[2m'), 'and the second is bright');
  r.press('+', { name: undefined });
  await wait(20);
  assert.match(visible(r.rows().at(-1)), /speed 200/);
  r.press('escape');
  assert.deepEqual(await done, { rate: 200 });
  assert.ok(r.frames.at(-1).includes('\x1b[?1049l'), 'the chat screen comes back');
  assert.equal(r.input.listenerCount('keypress'), 1, 'the chat gets its keys back');
  delete process.env.SAY_MS;
});

test('space pauses and plays, and at the end it offers to play again', async () => {
  process.env.SAY_MS = '5';
  const r = rig();
  const done = readerView(r.out, r.input, 'one two', { rate: 180 });
  r.press(' ', { name: 'space' });
  assert.match(visible(r.rows().at(-1)), /paused/);
  r.press(' ', { name: 'space' });
  await wait(300);
  assert.match(visible(r.rows().at(-1)), /done, space plays it again/);
  r.press('q');
  await done;
  delete process.env.SAY_MS;
});

test('a reply with nothing to read aloud says so instead of failing', async () => {
  const r = rig();
  const done = readerView(r.out, r.input, '```\nls -la\n```', { rate: 180 });
  assert.match(visible(r.rows().at(-1)), /nothing here to read aloud/);
  r.press('escape');
  await done;
});

// Just enough of a terminal to see where drawn text lands: wrap at the right edge, cursor
// moves, save and restore, and reverse video, which is how the lit word is marked.
function terminal(columns, height) {
  const grid = Array.from({ length: height }, () => Array.from({ length: columns }, () => ({ ch: ' ', lit: false })));
  let y = 0, x = 0, wrap = false, lit = false, saved = [0, 0, false];
  const snaps = [];
  const write = s => {
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\x1b' && '78'.includes(s[k + 1])) {
        if (s[++k] === '7') saved = [y, x, wrap];
        else [y, x, wrap] = saved;
      } else if (c === '\x1b') {
        const [all, p, f] = /^\[([0-9;?]*)([A-Za-z])/.exec(s.slice(k + 1));
        k += all.length;
        if (f === 'A') { y -= Number(p) || 1; wrap = false; }
        if (f === 'C') { x = Math.min(columns - 1, x + (Number(p) || 1)); wrap = false; }
        if (f === 'm') for (const n of p.split(';')) { if (n === '' || n === '0') lit = false; if (n === '7') lit = true; }
      } else if (c === '\r') { x = 0; wrap = false; }
      else if (c === '\n') { y++; x = 0; wrap = false; }
      else {
        // Writing in the last column leaves the cursor there until the next letter comes.
        if (wrap) { y++; x = 0; wrap = false; }
        grid[y][x] = { ch: c, lit };
        if (x === columns - 1) wrap = true;
        else x++;
      }
    }
    snaps.push({ text: grid.map(r => r.map(g => g.ch).join('')).join('\n'), lit: grid.flat().filter(g => g.lit).map(g => g.ch).join('') });
  };
  return { out: { columns, rows: height, write }, snaps };
}

const PATH = '/Users/angus/dev/dyslexic-mode/lib/a-path-that-is-far-too-long.mjs';

test('in place, a word on a line wider than the terminal lights exactly over itself', async () => {
  process.env.SAY_MS = '2';
  const t = terminal(20, 30);
  const shown = print(t.out, `One ${PATH} fits.\n\nShort one.`, { width: 72, columns: 20 });
  t.out.write('› ');
  const before = t.snaps.at(-1).text, from = t.snaps.length;
  assert.ok(shown.lines[0].rows > 3, 'the path runs over several rows');
  await readInPlace(t.out, { ...shown, below: 1 }, { rate: 180 }).done;
  const reading = t.snaps.slice(from);
  for (const s of reading) assert.equal(s.text, before, 'lighting a word never moves a letter');
  assert.deepEqual([...new Set(reading.map(s => s.lit).filter(Boolean))], ['One', PATH, 'fits.', 'Short', 'one.']);
  assert.equal(t.snaps.at(-1).lit, '', 'nothing stays lit');
  delete process.env.SAY_MS;
});

test('the reader shows a line longer than the screen in full, over more than one row', async () => {
  const r = rig();
  const done = readerView(r.out, r.input, `See ${PATH} now.`, { rate: 180 });
  const rows = r.rows().map(row => visible(row).trim());
  assert.equal(rows[1] + rows[2], PATH);
  assert.equal(rows[3], 'now.');
  r.press('escape');
  await done;
});
