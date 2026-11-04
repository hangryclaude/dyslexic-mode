#!/usr/bin/env node
// Records a terminal program into an animated SVG for the README.
// No recorder is installed on purpose: tmux already keeps every cell's color, so we read that.
// Usage: node tools/capture.mjs <out.svg> --cols 96 --rows 30 --frames 40 --every 120 [--keys "hey\n"@2000] -- <command...>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const opts = argv.slice(0, split);
const command = argv.slice(split + 1).join(' ');
const out = opts[0];
const num = (name, d) => (opts.includes(`--${name}`) ? Number(opts[opts.indexOf(`--${name}`) + 1]) : d);
const cols = num('cols', 96), rows = num('rows', 30), frames = num('frames', 40), every = num('every', 120);
const wait = num('wait', 1500);
const keys = opts.filter((_, i) => opts[i - 1] === '--keys').map(k => {
  const at = k.lastIndexOf('@');
  return { text: k.slice(0, at).replace(/\\n/g, '\n'), at: Number(k.slice(at + 1)) };
});

const name = `capture-${process.pid}`;
const tmux = (...a) => execFileSync('tmux', ['-L', name, ...a], { encoding: 'utf8' });
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

tmux('new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows), `env COLORTERM=truecolor TERM=xterm-256color ${command}`);
tmux('set-option', '-g', 'status', 'off');
const shots = [];
let clock = 0;
// Each key goes in at its own time, even inside one long wait: a menu has to be open before the
// key that picks from it arrives.
const advance = ms => {
  const until = clock + ms;
  for (const k of keys.filter(k => k.at > clock && k.at <= until).sort((a, b) => a.at - b.at)) {
    sleep(k.at - clock);
    clock = k.at;
    for (const part of k.text.split(/(\n)/)) if (part) tmux('send-keys', '-t', name, ...(part === '\n' ? ['Enter'] : ['-l', part]));
  }
  sleep(until - clock);
  clock = until;
};
advance(wait);
for (let i = 0; i < frames; i++) {
  shots.push(tmux('capture-pane', '-t', name, '-p', '-e'));
  advance(every);
}
try { tmux('kill-server'); } catch {}

// xterm 16-color base, the tmux palette fallback when a program asks for 0-15.
const BASE = ['#1d1f21', '#cc6666', '#b5bd68', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6',
  '#666666', '#d54e53', '#b9ca4a', '#e7c547', '#7aa6da', '#c397d8', '#70c0b1', '#eaeaea'];
const cube = n => {
  if (n < 16) return BASE[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgb(v, v, v); }
  n -= 16; const c = v => (v ? 55 + v * 40 : 0);
  return rgb(c(Math.floor(n / 36)), c(Math.floor(n / 6) % 6), c(n % 6));
};
const rgb = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const FG = '#e6e6e6', BG = '#0d0f14';

function parse(text) {
  const lines = text.replace(/\n$/, '').split('\n').slice(0, rows);
  return lines.map(line => {
    const cells = [];
    let st = { fg: FG, bg: null, bold: false, dim: false, inv: false };
    const re = /\x1b\[([0-9;]*)m|([^\x1b])/gu;
    for (const m of line.matchAll(re)) {
      if (m[2] !== undefined) { cells.push({ ch: m[2], ...st }); continue; }
      const p = (m[1] || '0').split(';').map(Number);
      for (let i = 0; i < p.length; i++) {
        const v = p[i];
        if (v === 0) st = { fg: FG, bg: null, bold: false, dim: false, inv: false };
        else if (v === 1) st = { ...st, bold: true };
        else if (v === 2) st = { ...st, dim: true };
        else if (v === 22) st = { ...st, bold: false, dim: false };
        else if (v === 7) st = { ...st, inv: true };
        else if (v === 27) st = { ...st, inv: false };
        else if (v === 39) st = { ...st, fg: FG };
        else if (v === 49) st = { ...st, bg: null };
        else if (v >= 30 && v <= 37) st = { ...st, fg: BASE[v - 30] };
        else if (v >= 90 && v <= 97) st = { ...st, fg: BASE[v - 82] };
        else if (v >= 40 && v <= 47) st = { ...st, bg: BASE[v - 40] };
        else if (v >= 100 && v <= 107) st = { ...st, bg: BASE[v - 92] };
        else if ((v === 38 || v === 48) && p[i + 1] === 2) { const c = rgb(p[i + 2], p[i + 3], p[i + 4]); st = { ...st, [v === 38 ? 'fg' : 'bg']: c }; i += 4; }
        else if ((v === 38 || v === 48) && p[i + 1] === 5) { st = { ...st, [v === 38 ? 'fg' : 'bg']: cube(p[i + 2]) }; i += 2; }
      }
    }
    return cells;
  });
}

const CW = 8.4, CH = 18, PAD = 20, BAR = 34;
const W = Math.round(cols * CW + PAD * 2), H = Math.round(rows * CH + PAD * 2 + BAR);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frameSvg(grid) {
  let rects = '', texts = '';
  grid.forEach((cells, y) => {
    let x = 0, run = null;
    const flush = () => {
      if (!run) return;
      const fill = run.dim ? `fill="${run.fg}" fill-opacity="0.6"` : `fill="${run.fg}"`;
      if (run.text.trim()) texts += `<text x="${(PAD + run.x * CW).toFixed(1)}" y="${(BAR + PAD + y * CH + 13).toFixed(1)}" ${fill}${run.bold ? ' font-weight="700"' : ''}>${esc(run.text)}</text>`;
      run = null;
    };
    for (const c of cells) {
      const fg = c.inv ? (c.bg || BG) : c.fg, bg = c.inv ? c.fg : c.bg;
      if (bg) rects += `<rect x="${(PAD + x * CW).toFixed(1)}" y="${BAR + PAD + y * CH}" width="${(CW + 0.3).toFixed(1)}" height="${CH}" fill="${bg}"/>`;
      if (run && run.fg === fg && run.bold === c.bold && run.dim === c.dim) { run.text += c.ch; run.n++; }
      else { flush(); run = { x, text: c.ch, n: 1, fg, bold: c.bold, dim: c.dim }; }
      x++;
    }
    flush();
  });
  return rects + texts;
}

// Identical neighbours collapse into one longer frame so the file stays small.
const grids = shots.map(parse);
const keyed = [];
for (const [i, g] of grids.entries()) {
  const key = shots[i];
  if (keyed.length && keyed.at(-1).key === key) keyed.at(-1).n++;
  else keyed.push({ key, grid: g, n: 1 });
}
const total = shots.length * every / 1000;
let at = 0;
const groups = keyed.map((f, i) => {
  const start = at / shots.length * 100, end = (at + f.n) / shots.length * 100;
  at += f.n;
  const anim = keyed.length > 1
    ? `<style>#f${i}{animation:k${i} ${total}s step-end infinite}@keyframes k${i}{0%{visibility:hidden}${start ? `${start.toFixed(3)}%{visibility:visible}` : '0%{visibility:visible}'}${end < 100 ? `${end.toFixed(3)}%{visibility:hidden}` : ''}}</style>` : '';
  return `${anim}<g id="f${i}"${keyed.length > 1 && start > 0 ? ' visibility="hidden"' : ''}>${frameSvg(f.grid)}</g>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14" xml:space="preserve">
<rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
<rect width="${W}" height="${BAR}" rx="12" fill="#161922"/><rect y="${BAR - 12}" width="${W}" height="12" fill="#161922"/>
<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
<text x="${W / 2}" y="22" fill="#7c8293" font-size="13" text-anchor="middle">dyslexic mode</text>
${groups}
</svg>
`;
writeFileSync(out, svg);
console.log(`${out}: ${keyed.length} frames, ${(svg.length / 1024).toFixed(0)} KB`);
