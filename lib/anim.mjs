import { renderBrain, wordSkin } from './brain.mjs';
import { grad } from './palette.mjs';
import { ESC, fancy, fg, dim, bold } from './style.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// The mirror letters a dyslexic reader trips on. They tumble, then settle into the real text.
const GLYPHS = 'bdpqunmwszMWNZ';
const BLOCKS = '░▒▓█';
const pick = s => s[Math.floor(Math.random() * s.length)];

export const promptGlyph = out => (fancy(out) ? fg(grad(0), '›') + ' ' : '> ');
export const swatch = name => '  ' + Array.from({ length: 24 }, (_, i) => fg(grad(i / 23), '█')).join('') + `  ${name}`;

const FONT = {
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  X: ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
};
export const banner = word => FONT.D.map((_, r) => [...word].map(ch => FONT[ch][r]).join(' '));

export async function intro(out) {
  const rows = [...banner('DYSLEXIC'), '', ...banner('MODE')];
  const w = Math.max(...rows.map(r => r.length));
  if (!fancy(out) || out.columns < w + 4) {
    out.write(`\n  ${bold('DYSLEXIC MODE')}\n\n`);
    return;
  }
  // Each block cell gets its own settle frame: a left-to-right wave with jitter, so the
  // word looks like scrambled letters snapping into place rather than a plain fade.
  const settle = rows.map((r, y) => [...r].map((_, x) => x * 0.55 + y * 0.8 + Math.random() * 10));
  const last = Math.max(...settle.flat()) + 18;
  const bannerLine = (y, f) => {
    let line = '';
    for (let x = 0; x < rows[y].length; x++) {
      const on = rows[y][x] !== ' ', t = settle[y][x], c = grad(x / w * 0.8 + f / 60);
      if (f < t - 6) line += Math.random() < 0.08 ? fg(grad(Math.random()), pick(GLYPHS)) : ' ';
      else if (f < t) line += fg(c, on ? pick(BLOCKS) : (Math.random() < 0.35 ? pick(GLYPHS) : ' '));
      else line += on ? fg(f - t < 2 ? [255, 255, 255] : c, '█') : ' ';
    }
    return line;
  };
  // The brain spins left of the banner when the window has room for both. Its cells start as
  // mirror glyphs too, and it stops on a three-quarter view as the banner lands.
  const BW = 34, BH = 15;
  const withBrain = out.columns >= BW + w + 7 && out.rows >= BH + 8;
  const H = withBrain ? BH : rows.length, top = withBrain ? (BH - rows.length) >> 1 : 0;
  const brainSettle = Array.from({ length: BH }, (_, y) => Array.from({ length: BW }, (_, x) => x * 0.5 + y * 0.6 + Math.random() * 8));
  out.write(`${ESC}?25l\n` + '\n'.repeat(H));
  for (let f = 0; f <= last; f++) {
    const brain = withBrain && paint(renderBrain({ cols: BW, rows: BH, angle: (f - last) * 0.07 - 0.7 }).map((row, y) =>
      row.map((c, x) => (c && f < brainSettle[y][x] ? { ch: pick(GLYPHS), lum: 0.75, hue: Math.random() } : c))), 0.1 * Math.sin(f / 20));
    let frame = `${ESC}${H}A`;
    for (let y = 0; y < H; y++) {
      const by = y - top;
      frame += `${ESC}2K  ${brain ? brain[y] + '   ' : ''}${by >= 0 && by < rows.length ? bannerLine(by, f) : ''}\n`;
    }
    out.write(frame);
    await sleep(28);
  }
  out.write(`${ESC}?25h`);
  await typeLine(out, '  turn your agent dyslexic');
}

// Cells → one string per row. A colour code only goes out when the colour changes, and
// colours snap to steps of 6, so even a full-screen frame stays small enough to draw smoothly.
export function paint(cells, shift = 0) {
  return cells.map(row => {
    let s = '', prev = '';
    for (const c of row) {
      if (!c) { s += ' '; continue; }
      const k = 0.3 + 0.7 * c.lum, white = Math.max(0, c.lum - 0.8) * 2.5;
      // A word on the brain keeps its company's colour; the plain brain takes the palette's.
      const rgb = (c.rgb ?? grad(c.hue + shift)).map(v => Math.round(Math.min(255, v * k + (255 - v * k) * white) / 6) * 6);
      const code = `${ESC}38;2;${rgb.join(';')}m`;
      if (code !== prev) { s += code; prev = code; }
      s += c.ch;
    }
    return s + `${ESC}0m`;
  });
}

// One frame of the /brain screen as lines: the brain, then the caption centred under it.
// TURN frames make one full turn and three passing thoughts, so frame TURN is frame 0 again and
// a recording of TURN frames loops without a seam. tools/reel.mjs records these same frames.
export const TURN = 240;
const skins = new WeakMap();
export function brainLines({ cols, rows, f, words = [], caption = [] }) {
  const turn = (2 * Math.PI * (f % TURN)) / TURN, angle = turn - 0.7, under = caption.length ? caption.length + 1 : 0;
  const size = { cols, rows: Math.max(4, rows - under) };
  let cells = renderBrain({ ...size, angle, pulse: ((3 * f) % TURN) / TURN });
  if (words.length) {
    // Laying the words out takes a moment, so it happens once per window size, not per frame.
    if (!skins.has(words)) skins.set(words, new Map());
    const bySize = skins.get(words), key = `${size.cols}x${size.rows}`;
    if (!bySize.has(key)) bySize.set(key, wordSkin(words, size));
    cells = bySize.get(key)(cells, { angle });
  }
  const centred = caption.map(([text, style]) => ' '.repeat(Math.max(0, (cols - text.length) >> 1)) + style(text));
  return [...paint(cells, 0.12 * Math.sin(turn)), ...(under ? ['', ...centred] : [])];
}

// The lines under the brain: the tagline, then a tally like "248 models · 18 companies".
export const brainCaption = tally => [['turn your agent dyslexic', s => fg(grad(0.55), s)], [tally, dim]];

// Full-screen spinning brain on the alternate screen, until `until` resolves. With words, the
// brain is written in them. caption: [[text, style]] lines under it.
export async function brainScreen(out, until, hint, { words = [], caption = [] } = {}) {
  const frame = f => brainLines({ cols: out.columns || 80, rows: Math.max(4, (out.rows || 24) - 2), f, words, caption });
  if (!fancy(out)) { out.write(frame(0).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n') + '\n'); return; }
  let done = false;
  until.then(() => { done = true; });
  out.write(`${ESC}?1049h${ESC}?25l`);
  for (let f = 0; !done; f++) {
    out.write(`${ESC}H` + frame(f).map(l => `${ESC}2K${l}`).join('\n') + `\n${ESC}2K` + dim(`  ${hint}`));
    await sleep(33);
  }
  out.write(`${ESC}?25h${ESC}?1049l`);
}

async function typeLine(out, text) {
  await settleLine(out, [...text].map(ch => ({ ch, style: s => fg(grad(0.55), s) })), 10);
  out.write('\n');
}

// Waits on Claude with the word "reading" whose letters keep flipping into their mirror twins.
// Calm mode shows a still line. Returns stop(); stop.status(text) shows what Claude is doing,
// such as the tool it is using.
// It lives on the line under the reply, so stop.redraw() puts it back after a line of the
// reply is written over it.
export function thinking(out, { calm = false } = {}) {
  let status = '';
  const handle = (stop, redraw = () => {}) => Object.assign(stop, { status: s => { status = s; redraw(); }, redraw });
  const tail = () => (status ? dim('  ' + fit(status, out.columns - 22)) : '');
  if (!fancy(out)) return handle(() => {});
  if (calm) {
    const line = () => out.write(`\r${ESC}2K` + dim('  reading…') + tail());
    line();
    return handle(() => out.write(`\r${ESC}2K`), line);
  }
  const word = 'reading', twin = { r: 'ɹ', e: 'ə', a: 'ɐ', d: 'b', i: 'ı', n: 'u', g: 'ƃ' };
  const start = Date.now();
  let f = 0;
  const draw = () => {
    const s = [...word].map((ch, i) => fg(grad(i / 9 + f / 25), Math.random() < 0.3 ? twin[ch] : ch)).join('');
    out.write(`\r${ESC}2K  ${s}${dim('…  ' + ((Date.now() - start) / 1000).toFixed(1) + 's')}${tail()}`);
  };
  out.write(`${ESC}?25l`);
  const timer = setInterval(() => { draw(); f++; }, 70);
  return handle(() => { clearInterval(timer); out.write(`\r${ESC}2K${ESC}?25h`); }, draw);
}

const fit = (s, max) => (s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s);

// An arrow-key menu: up and down move, a number jumps, Enter picks, Esc closes.
// Resolves to the picked item's index, or -1. Readline's own key handler is set aside while
// the menu is open, so arrows move the menu instead of scrolling the chat history.
// A list taller than the window scrolls with the selection, because rows pushed off the top
// of the screen could not be redrawn. `at` is the row it starts on, and `nameMax` how wide the
// name column may grow for a long name. An item is [name, help], or [name, help, rgb] for a
// coloured dot before the name, like each company's colour in /model.
export function menu(out, input, items, { at: start = 0, nameMax = 24 } = {}) {
  if (!fancy(out)) return Promise.resolve(-1);
  let at = Math.min(Math.max(start, 0), items.length - 1), top = 0;
  const size = Math.min(items.length, Math.max(5, (out.rows || 24) - 4));
  const nameWidth = Math.min(nameMax, Math.max(10, ...items.map(([name]) => name.length)));
  const dots = items.some(item => item[2]);
  const draw = first => {
    if (!first) out.write(`${ESC}${size}A`);
    top = Math.min(Math.max(top, at - size + 1), at);
    for (let i = top; i < top + size; i++) {
      const [name, help, color] = items[i];
      // A row that wraps would throw off the cursor-up count, so every row fits the window.
      // The first and last row show an arrow when more rows wait above or below.
      const more = (i === top && top > 0 && '↑') || (i === top + size - 1 && top + size < items.length && '↓');
      const dot = dots ? `${color ? fg(color, '●') : ' '} ` : '';
      const num = dim((more || String(i + 1)).padStart(2)), row = fit(`${name.padEnd(nameWidth)} ${help}`, Math.max(10, out.columns - 9 - (dots ? 2 : 0)));
      out.write(`${ESC}2K  ${num} ${i === at ? fg(grad(0), '› ') + dot + bold(fg(grad(0.5), row)) : '  ' + dot + dim(row)}\n`);
    }
  };
  return new Promise(resolve => {
    const saved = input.listeners('keypress');
    input.removeAllListeners('keypress');
    const done = pick => {
      input.removeListener('keypress', onKey);
      for (const l of saved) input.on('keypress', l);
      out.write(`${ESC}${size}A${ESC}J${ESC}?25h`);
      resolve(pick);
    };
    const onKey = (s, key = {}) => {
      if (key.name === 'up') at = (at + items.length - 1) % items.length;
      else if (key.name === 'down' || key.name === 'tab') at = (at + 1) % items.length;
      else if (key.name === 'return') return done(at);
      else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return done(-1);
      else if (/^[1-9]$/.test(s ?? '') && Number(s) <= items.length) return done(Number(s) - 1);
      else return;
      draw(false);
    };
    out.write(`${ESC}?25l`);
    draw(true);
    input.on('keypress', onKey);
    input.resume();
  });
}

// Reads one line without showing it, for a secret. Readline's key handler is set aside, as in
// menu(), so nothing is echoed and nothing lands in its history. Enter returns what was typed,
// Esc or Ctrl-C returns null. The caller reads a plain line when there is no terminal, because a
// pipe shows nothing anyway.
export function secret(out, input, prompt) {
  return new Promise(resolve => {
    const saved = input.listeners('keypress');
    input.removeAllListeners('keypress');
    let text = '';
    const done = value => {
      input.removeListener('keypress', onKey);
      for (const l of saved) input.on('keypress', l);
      out.write('\n');
      resolve(value);
    };
    const onKey = (s, key = {}) => {
      if (key.name === 'return') return done(text);
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return done(null);
      if (key.name === 'backspace') text = text.slice(0, -1);
      // A paste arrives one key at a time, and only plain printable characters belong in a key.
      else if (!key.ctrl && !key.meta && /^[\x20-\x7e]+$/.test(s ?? '')) text += s;
    };
    out.write(prompt);
    input.on('keypress', onKey);
    input.resume();
  });
}

// Draws one line where every character starts as a mirror glyph and settles left to right.
async function settleLine(out, cells, frames = 8) {
  const n = cells.length;
  for (let f = 1; f <= frames; f++) {
    const done = Math.ceil(n * f / frames);
    const s = cells.map((c, i) => i < done || c.ch === ' ' ? c.style(c.ch)
      : fg(grad(i / Math.max(n, 1) + f / frames), pick(GLYPHS))).join('');
    out.write(`\r${ESC}2K${s}`);
    await sleep(16);
  }
}
