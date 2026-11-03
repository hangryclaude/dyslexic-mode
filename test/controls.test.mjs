import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { MENU, GROUPS, distance, resolve } from '../lib/commands.mjs';
import { PALETTES, NAMES, grad, setPalette, nextPalette, randomPalette, palette } from '../lib/palette.mjs';
import { renderBrain, LOBES } from '../lib/brain.mjs';
import { menu, secret } from '../lib/anim.mjs';
import { APP } from './fixtures/app.mjs';

const NAMES_TYPED = MENU.map(([n]) => n).filter(n => n !== '!');

test('a swapped pair of letters is one slip, not two', () => {
  assert.equal(distance('/calm', '/clam'), 1);
  assert.equal(distance('/brain', '/brian'), 1);
  assert.equal(distance('/test', '/test'), 0);
  assert.equal(distance('', 'abc'), 3);
});

test('typed commands forgive slips but never guess between two', () => {
  assert.equal(resolve('/clam', NAMES_TYPED), '/calm');
  assert.equal(resolve('/tset', NAMES_TYPED), '/test');
  assert.equal(resolve('/brian', NAMES_TYPED), '/brain');
  assert.equal(resolve('/stast', NAMES_TYPED), '/stats');
  assert.equal(resolve('/prof', NAMES_TYPED), '/profile');
  assert.equal(resolve('/t', NAMES_TYPED), null);
  assert.equal(resolve('/zzzzzz', NAMES_TYPED), null);
});

test('the new commands forgive slips too', () => {
  for (const [typed, meant] of [['/modle', '/model'], ['/hlep', '/help'], ['/compcat', '/compact'], ['/ocntext', '/context'], ['/thnik', '/think'], ['/exprot', '/export'], ['/cpoy', '/copy'], ['/voic', '/voice'], ['/reusme', '/resume'], ['/nwe', '/new'], ['/cler', '/clear']])
    assert.equal(resolve(typed, NAMES_TYPED), meant, typed);
});

test('a start that two commands share is not guessed, but a start only one has is enough', () => {
  for (const typed of ['/co', '/c', '/pl', '/stat', '/ex', '/staus']) assert.equal(resolve(typed, NAMES_TYPED), null, typed);
  for (const [typed, meant] of [['/cop', '/copy'], ['/com', '/compact'], ['/con', '/context'], ['/pla', '/plan'], ['/pli', '/pliny'], ['/statu', '/status'], ['/exp', '/export'], ['/re', '/resume'], ['/mod', '/model'], ['/th', '/think']])
    assert.equal(resolve(typed, NAMES_TYPED), meant, typed);
});

test('the read-aloud commands are gone: /read finds nothing, and /voice and /key are for ChatGPT voice', () => {
  assert.equal(resolve('/read', NAMES_TYPED), null);
  assert.equal(resolve('/raed', NAMES_TYPED), null);
  assert.ok(MENU.some(([n, help]) => n === '/voice' && /ChatGPT voice/.test(help)));
  assert.ok(MENU.some(([n, help]) => n === '/key' && /OpenAI key/.test(help)));
  assert.equal(resolve('/kye', NAMES_TYPED), '/key');
});

test('the menu covers every command once, with the flag first', () => {
  assert.equal(MENU[0][0], '!');
  assert.equal(new Set(MENU.map(([n]) => n)).size, MENU.length);
});

test('the groups hold every command, each with a one-line description, and /help and /exit are there', () => {
  assert.deepEqual(GROUPS.flatMap(([, items]) => items), MENU);
  for (const [title, items] of GROUPS) {
    assert.ok(title && items.length, title);
    for (const [name, help] of items) assert.ok(/^[!/]/.test(name) && help && !help.includes('\n'), name);
  }
  for (const name of ['/help', '/model', '/context', '/compact', '/clear', '/status', '/think', '/plan', '/export', '/copy', '/voice', '/key', '/resume', '/new', '/test', '/stats', '/profile', '/tools', '/color', '/brain', '/calm', '/pliny', '/exit'])
    assert.ok(MENU.some(([n]) => n === name), name);
});

test('the app handles exactly the commands the menu lists', () => {
  const handled = [...readFileSync(APP, 'utf8').matchAll(/^ {2}'([!/]\w*)':/gm)].map(m => m[1]);
  assert.deepEqual(handled.sort(), MENU.map(([n]) => n).sort());
});

// A terminal that keeps what is drawn on it, and a keyboard the test presses keys on.
function terminal({ rows = 24, columns = 80 } = {}) {
  const out = { isTTY: true, rows, columns, text: '', write(s) { this.text += s; return true; } };
  const input = Object.assign(new EventEmitter(), { resume() {} });
  return { out, input, press: (s, key = {}) => input.emit('keypress', s, key) };
}
const items = Array.from({ length: 30 }, (_, i) => [`/cmd${i}`, `help ${i}`]);

test('a menu taller than the window scrolls with the selection and keeps the cursor math whole', async () => {
  delete process.env.NO_COLOR;
  const t = terminal({ rows: 12 });
  const picked = menu(t.out, t.input, items);
  assert.equal(t.out.text.split('\n').length - 1, 8, 'rows 12 leaves room for 8 menu rows');
  for (let i = 0; i < 10; i++) t.press(undefined, { name: 'down' });
  const frame = t.out.text.split('\x1b[8A').at(-1);
  assert.equal(frame.split('\n').length - 1, 8);
  assert.match(frame, /› .*\/cmd10 +help 10/);
  assert.doesNotMatch(frame, /help 2\b/);
  assert.ok(frame.includes('↑') && frame.includes('↓'), 'arrows say more rows wait above and below');
  t.press(undefined, { name: 'return' });
  assert.equal(await picked, 10);
  assert.ok(t.out.text.endsWith('\x1b[8A\x1b[J\x1b[?25h'), 'closing wipes exactly the rows drawn');
  assert.equal(t.input.listenerCount('keypress'), 0);
});

test('a menu starts where it is told, wraps around, jumps on a number and closes on Esc', async () => {
  delete process.env.NO_COLOR;
  const start = terminal();
  const at = menu(start.out, start.input, items, { at: 20 });
  start.press(undefined, { name: 'return' });
  assert.equal(await at, 20);
  const wrap = terminal();
  const up = menu(wrap.out, wrap.input, items);
  wrap.press(undefined, { name: 'up' });
  wrap.press(undefined, { name: 'return' });
  assert.equal(await up, items.length - 1);
  const jump = terminal();
  const three = menu(jump.out, jump.input, items);
  jump.press('3', { name: '3' });
  assert.equal(await three, 2);
  const esc = terminal();
  const closed = menu(esc.out, esc.input, items);
  esc.press(undefined, { name: 'escape' });
  assert.equal(await closed, -1);
  assert.equal(await menu({ isTTY: false, write() {} }, new EventEmitter(), items), -1, 'no menu without a terminal');
});

test('a short menu is drawn whole, and a long name widens its column', async () => {
  delete process.env.NO_COLOR;
  const t = terminal();
  const picked = menu(t.out, t.input, [['haiku', 'Haiku'], ['claude-opus-4-5-20251101', 'Opus']]);
  t.press(undefined, { name: 'return' });
  await picked;
  assert.equal(t.out.text.split('\n').length - 1, 2);
  assert.match(t.out.text, /claude-opus-4-5-20251101 Opus/);
});

test('a name column can be allowed to grow wider than the usual 24 for long model ids', async () => {
  delete process.env.NO_COLOR;
  const long = 'opencode-go/nemotron-3.5-super-vl-free';
  const narrow = terminal({ columns: 120 });
  const a = menu(narrow.out, narrow.input, [[long, 'Nemotron'], ['claude/opus', 'Opus']]);
  narrow.press(undefined, { name: 'return' });
  await a;
  assert.match(narrow.out.text, /opencode-go\/nemotron-3\.5-super-vl-free Nemotron/);
  const wide = terminal({ columns: 120 });
  const b = menu(wide.out, wide.input, [[long, 'Nemotron'], ['claude/opus', 'Opus']], { nameMax: 40 });
  wide.press(undefined, { name: 'return' });
  await b;
  assert.match(wide.out.text, new RegExp(`claude/opus${' '.repeat(long.length - 'claude/opus'.length)} Opus`), 'the short name is padded to the long one');
});

test('palettes: ends match the stops, and the hue ping-pongs instead of jumping', () => {
  for (const name of NAMES) {
    setPalette(name);
    const stops = PALETTES[name];
    assert.deepEqual(grad(0), stops[0]);
    assert.deepEqual(grad(1), stops[stops.length - 1]);
    assert.deepEqual(grad(1.2), grad(0.8));
    assert.deepEqual(grad(-0.3), grad(0.3));
  }
});

test('palettes: /color steps through all of them, and a bad name says what exists', () => {
  setPalette(NAMES[0]);
  const seen = new Set(NAMES.map(() => nextPalette()));
  assert.equal(seen.size, NAMES.length);
  assert.throws(() => setPalette('beige'), /Try: neon/);
  assert.equal(randomPalette(() => 0.999), NAMES[NAMES.length - 1]);
  assert.equal(palette(), NAMES[NAMES.length - 1]);
});

test('the brain is coloured by lobe, and a side view shows at least four of them', () => {
  const parts = new Set(renderBrain({ cols: 70, rows: 28, angle: Math.PI / 2 }).flat().filter(Boolean).map(c => c.part));
  assert.ok(parts.size >= 4, [...parts].join(','));
  for (const p of parts) assert.ok(p in LOBES);
});

test('a secret is typed with nothing shown, backspace works, Enter returns it, and readline gets its keys back', async () => {
  const t = terminal();
  const readline = () => {};
  t.input.on('keypress', readline);
  const got = secret(t.out, t.input, 'key: ');
  assert.deepEqual(t.input.listeners('keypress').includes(readline), false, 'readline is set aside while the secret is typed');
  for (const ch of 'sk-abcx') t.press(ch, { name: ch });
  t.press(undefined, { name: 'backspace' });
  t.press('\t', { name: 'tab' });
  t.press('\x01', { name: 'a', ctrl: true });
  t.press('\x1b[200~', { name: undefined });
  t.press('12', { name: undefined });
  t.press(undefined, { name: 'return' });
  assert.equal(await got, 'sk-abc12');
  assert.equal(t.out.text, 'key: \n', 'only the prompt and the line break were drawn, never a letter of it');
  assert.deepEqual(t.input.listeners('keypress'), [readline]);
});

test('Esc or Ctrl-C gives up on a secret and returns null, with the keys given back and nothing kept', async () => {
  for (const key of [{ name: 'escape' }, { name: 'c', ctrl: true }]) {
    const t = terminal();
    const readline = () => {};
    t.input.on('keypress', readline);
    const got = secret(t.out, t.input, 'key: ');
    t.press('a', { name: 'a' });
    t.press(undefined, key);
    assert.equal(await got, null);
    assert.deepEqual(t.input.listeners('keypress'), [readline]);
    assert.equal(t.out.text, 'key: \n');
  }
});
