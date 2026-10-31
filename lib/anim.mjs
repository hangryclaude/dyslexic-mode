const ESC = '\x1b[';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The mirror letters a dyslexic reader trips on. They tumble, then settle into the real text.
const GLYPHS = 'bdpqunmwszMWNZ';
const BLOCKS = '░▒▓█';
const pick = s => s[Math.floor(Math.random() * s.length)];

export const fancy = out => out.isTTY && !process.env.NO_COLOR;

// Purple → pink → cyan, sampled at 0..1.
const STOPS = [[168, 85, 247], [236, 72, 153], [34, 211, 238]];
function grad(t) {
  t = ((t % 1) + 1) % 1;
  const x = t * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
const fg = ([r, g, b], s) => `${ESC}38;2;${r};${g};${b}m${s}${ESC}0m`;
export const dim = s => `${ESC}2m${s}${ESC}0m`;
const bold = s => `${ESC}1m${s}${ESC}0m`;
const cyan = s => `${ESC}36m${s}${ESC}0m`;

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
const banner = word => FONT.D.map((_, r) => [...word].map(ch => FONT[ch][r]).join(' '));

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
  out.write(`${ESC}?25l\n` + '\n'.repeat(rows.length));
  for (let f = 0; f <= last; f++) {
    out.write(`${ESC}${rows.length}A`);
    for (let y = 0; y < rows.length; y++) {
      let line = '  ';
      for (let x = 0; x < rows[y].length; x++) {
        const on = rows[y][x] !== ' ', t = settle[y][x], c = grad(x / w * 0.8 + f / 60);
        if (f < t - 6) line += Math.random() < 0.08 ? fg(grad(Math.random()), pick(GLYPHS)) : ' ';
        else if (f < t) line += fg(c, on ? pick(BLOCKS) : (Math.random() < 0.35 ? pick(GLYPHS) : ' '));
        else line += on ? fg(f - t < 2 ? [255, 255, 255] : c, '█') : ' ';
      }
      out.write(`${ESC}2K${line}\n`);
    }
    await sleep(28);
  }
  out.write(`${ESC}?25h`);
  await typeLine(out, '  claude, re-read for the way you read');
  out.write('\n' + dim('  /pliny  l33t mode    /calm  no motion    /new  fresh chat    /exit') + '\n\n');
}

async function typeLine(out, text) {
  await settleLine(out, [...text].map(ch => ({ ch, style: s => fg(grad(0.55), s) })), 10);
  out.write('\n');
}

// Waits on Claude with the word "reading" whose letters keep flipping into their mirror twins.
export function thinking(out) {
  if (!fancy(out)) return () => {};
  const word = 'reading', twin = { r: 'ɹ', e: 'ə', a: 'ɐ', d: 'b', i: 'ı', n: 'u', g: 'ƃ' };
  const start = Date.now();
  let f = 0;
  out.write(`${ESC}?25l`);
  const timer = setInterval(() => {
    const s = [...word].map((ch, i) => fg(grad(i / 9 + f / 25), Math.random() < 0.3 ? twin[ch] : ch)).join('');
    out.write(`\r${ESC}2K  ${s}${dim('…  ' + ((Date.now() - start) / 1000).toFixed(1) + 's')}`);
    f++;
  }, 70);
  return () => { clearInterval(timer); out.write(`\r${ESC}2K${ESC}?25h`); };
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

// Markdown → styled cells: **bold** and `code` spans, a heading colour, nothing else.
function spans(line) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.flatMap((p, i) => {
    if (i % 2 === 0) return [...p].map(ch => ({ ch, style: s => s }));
    const code = p.startsWith('`'), inner = code ? p.slice(1, -1) : p.slice(2, -2);
    return [...inner].map(ch => ({ ch, style: code ? cyan : bold }));
  });
}

function wrap(cells, width, indent) {
  const lines = [];
  let cur = [], word = [];
  const flush = () => {
    if (cur.length && cur.length + word.length > width) {
      lines.push(cur);
      cur = [...' '.repeat(indent)].map(ch => ({ ch, style: s => s }));
      while (word[0]?.ch === ' ') word.shift();
    }
    cur.push(...word);
    word = [];
  };
  for (const c of cells) { if (c.ch === ' ') flush(); word.push(c); }
  flush();
  lines.push(cur);
  return lines;
}

export async function render(out, text, { calm }) {
  const width = Math.min((out.columns || 80) - 4, 80);
  let inCode = false;
  for (const raw of text.split('\n')) {
    if (raw.trimStart().startsWith('```')) { inCode = !inCode; continue; }
    if (inCode || raw.trimStart().startsWith('|')) {
      out.write('  ' + (inCode ? cyan(raw) : raw) + '\n');
      continue;
    }
    const h = raw.match(/^#{1,6}\s+(.*)/);
    let cells = h ? [...h[1]].map(ch => ({ ch, style: s => bold(fg(grad(0.1), s)) })) : spans(raw);
    const indent = (raw.match(/^\s*(?:[-*]|\d+\.)\s+/) || [''])[0].length;
    for (const line of wrap(cells, width, indent)) {
      const cellsWithGutter = [{ ch: ' ', style: s => s }, { ch: ' ', style: s => s }, ...line];
      if (calm || !fancy(out)) out.write(cellsWithGutter.map(c => c.style(c.ch)).join(''));
      else await settleLine(out, cellsWithGutter);
      out.write('\n');
    }
  }
}
