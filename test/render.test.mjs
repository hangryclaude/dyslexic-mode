import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stream, layout, inline, paint, textOf, speechLines } from '../lib/render.mjs';
import { visible } from '../lib/style.mjs';

const SAMPLE = [
  'You have **1.4 TB** free out of 2 TB.',
  '',
  '## Space',
  '',
  '| Item | Size |',
  '|------|-----:|',
  '| Total disk | 2.0 TB |',
  '| Used | ~560 GB |',
  '',
  '1. Buy an external SSD of 2 TB. Your data is about 500 GB today, so the 2 TB size leaves room for old versions of your files.',
  '2. Open `System Settings`, then [Time Machine](https://support.apple.com/en-us/104984).',
  '- a bullet with *soft* words',
  '  - nested bullet',
  '- [x] done item',
  '',
  '> a quoted line',
  '',
  '```bash',
  'tmutil startbackup --auto',
  '```',
  '---',
  'See https://www.backblaze.com for cloud backup.',
].join('\n');

const shown = r => r.lines.map(l => textOf(l.cells));
const said = r => r.units.map(u => textOf(u.cells));

test('the sample lays out as headings, a box table, lists, a quote, code and a rule', () => {
  const r = layout(SAMPLE, { width: 60 });
  assert.deepEqual(shown(r), [
    'You have 1.4 TB free out of 2 TB.',
    '',
    '▍ Space',
    '',
    '╭────────────┬─────────╮',
    '│ Item       │    Size │',
    '├────────────┼─────────┤',
    '│ Total disk │  2.0 TB │',
    '│ Used       │ ~560 GB │',
    '╰────────────┴─────────╯',
    '',
    '1. Buy an external SSD of 2 TB. Your data is about 500 GB',
    '   today, so the 2 TB size leaves room for old versions of',
    '   your files.',
    '2. Open System Settings, then Time Machine',
    '   https://support.apple.com/en-us/104984.',
    '• a bullet with soft words',
    '  • nested bullet',
    '☑ done item',
    '',
    '│ a quoted line',
    '',
    '│ tmutil startbackup --auto',
    '────────────────────────────────────',
    'See https://www.backblaze.com for cloud backup.',
  ]);
});

test('read aloud: step numbers yes, bullets, links and code no, table rows with a pause', () => {
  assert.deepEqual(said(layout(SAMPLE, { width: 60 })), [
    'You have 1.4 TB free out of 2 TB.',
    'Space',
    'Item, Size',
    'Total disk, 2.0 TB',
    'Used, ~560 GB',
    '1. Buy an external SSD of 2 TB. Your data is about 500 GB today, so the 2 TB size leaves room for old versions of your files.',
    '2. Open System Settings, then Time Machine.',
    'a bullet with soft words',
    'nested bullet',
    'done item',
    'a quoted line',
    'See  for cloud backup.',
  ]);
});

test('every spoken letter knows the screen cell it sits in', () => {
  const r = layout(SAMPLE, { width: 40 });
  let placed = 0;
  for (const u of r.units) for (const c of u.cells) {
    if (!c.at) continue;
    assert.equal(r.lines[c.at[0]].cells[c.at[1]], c);
    placed++;
  }
  assert.ok(placed > 200);
});

test('streaming in any size of pieces gives the same screen as the whole text at once', () => {
  const whole = layout(SAMPLE, { width: 44 });
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 40; round++) {
    const written = [];
    const s = stream(l => written.push(l), { width: 44 });
    for (let i = 0; i < SAMPLE.length;) { const n = 1 + Math.floor(rand() * 12); s.push(SAMPLE.slice(i, i + n)); i += n; }
    const r = s.end();
    assert.deepEqual(shown(r), shown(whole));
    assert.deepEqual(said(r), said(whole));
    assert.equal(written.length, r.lines.length, 'each line written exactly once');
  }
});

test('lines are written only once their source line is complete', () => {
  const written = [];
  const s = stream(l => written.push(visible(l)), { width: 72 });
  s.push('first line\nsecond li');
  assert.deepEqual(written, ['  first line']);
  s.push('ne\n| a | b |\n|---|---|\n');
  assert.equal(written.length, 2, 'a table waits for its last row');
  s.push('| 1 | 2 |\n\nafter');
  assert.equal(written.length, 8);
  s.end();
  assert.equal(written.at(-1), '  after');
});

test('wrapped lines fit the width, and the space at a wrap point is still read', () => {
  const text = 'word '.repeat(60).trim() + ' https://example.com/a/very/long/path/that/cannot/wrap/anywhere/at/all/ok';
  const r = layout(text, { width: 30 });
  for (const l of r.lines.slice(0, -1)) assert.ok(l.cells.length <= 30, textOf(l.cells));
  assert.equal(said(r)[0], 'word '.repeat(60).trim() + ' ');
  assert.ok(r.lines.at(-1).cells.length > 30, 'a long link keeps its own line, whole');
});

test('a table wider than the line wraps inside its cells and stays a table', () => {
  const t = [
    '| Feature | Credit card | Debit card |',
    '|---|---|---|',
    "| Whose money | The bank's, paid back later | Yours, from your bank account |",
    '| Interest | Yes, if you carry a balance | None |',
  ].join('\n');
  const lines = shown(layout(t, { width: 60 }));
  assert.equal(new Set(lines.map(l => [...l].length)).size, 1, 'every row of the box is the same width');
  assert.ok(lines.every(l => [...l].length <= 60));
  assert.ok(lines.some(l => /^│ +│ back later +│ bank account +│$/.test(l)), lines.join('\n'));
  assert.equal(lines.filter(l => l.startsWith('├')).length, 2, 'a rule under the header and one between the two rows');
  assert.deepEqual(said(layout(t, { width: 60 })).slice(1), ["Whose money, The bank's, paid back later, Yours, from your bank account", 'Interest, Yes, if you carry a balance, None']);
});

test('with too many columns to fit, each row becomes a short list', () => {
  const t = '| Name | Price | Size | Note |\n|---|---|---|---|\n| T7 | $120 | 2 TB | fast and small |\n';
  assert.deepEqual(shown(layout(t, { width: 30 })), ['• T7', '  • Price: $120', '  • Size: 2 TB', '  • Note: fast and small']);
});

test('numbers right-align on their own, text stays left, and an align row wins', () => {
  const r = layout('| a | n |\n|---|---|\n| x | 5 |\n| yy | 120 |\n', { width: 72 });
  assert.deepEqual(shown(r).slice(3, 5), ['│ x  │   5 │', '│ yy │ 120 │']);
  const l = layout('| a | n |\n|:---|:---|\n| x | 5 |\n| yy | 120 |\n', { width: 72 });
  assert.deepEqual(shown(l).slice(3, 5), ['│ x  │ 5   │', '│ yy │ 120 │']);
});

test('mark splits working notes from the answer', () => {
  const s = stream(() => {}, { width: 72 });
  s.push('let me look');
  s.mark();
  s.push('\n\nthe answer\n');
  const r = s.end();
  assert.equal(r.from, 1);
  assert.deepEqual(r.units.map(u => textOf(u.cells)), ['the answer']);
  assert.deepEqual(shown(r), ['let me look', '', 'the answer']);
});

test('inline markdown: an unclosed marker stays as typed, italics lose their stars', () => {
  assert.equal(textOf(inline('5 ** 2 is 25')), '5 ** 2 is 25');
  assert.equal(textOf(inline('a *soft* word and snake_case_name')), 'a soft word and snake_case_name');
  assert.equal(textOf(inline('run `npm test` now')), 'run npm test now');
  assert.equal(textOf(inline('see (https://a.com/x).')), 'see (https://a.com/x).');
  assert.ok(inline('see https://a.com/x.').filter(c => !c.say).length === 'https://a.com/x'.length);
});

test('paint styles each run once and draws the same letters', () => {
  const cells = inline('plain **bold bold** `code` plain');
  const s = paint(cells);
  assert.equal(visible(s), textOf(cells));
  assert.ok((s.match(/\x1b\[/g) || []).length < 12, 'runs, not one code per letter');
});

test('speech lines keep every offset: "[[" is swapped one for one', () => {
  const r = layout('see [[note]] and\ttab', { width: 72 });
  const [line] = speechLines(r.units);
  assert.equal(line, 'see ((note]] and tab');
  assert.equal([...line].length, r.units[0].cells.length);
});

test('a carriage return before a newline never reaches the screen', () => {
  assert.deepEqual(shown(layout('one\r\ntwo\r\n', { width: 72 })), ['one', 'two']);
});
