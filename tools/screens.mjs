// Terminal screens as pictures, for the README and for posts: text with colour codes → cells →
// an SVG window, and SVG frames → PNG → an animated WebP or an MP4. The SVGs need nothing. PNGs
// need rsvg-convert, the WebP img2webp and the MP4 ffmpeg (brew install librsvg webp ffmpeg).
// The app itself needs none of these.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// One screen of text → rows of cells { ch, fg, bg, bold, dim, inv }.
export function parse(text, rows) {
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
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cellsSvg(grid) {
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

// A terminal window around the body, the way the README shows every screen.
function windowSvg(body, { cols, rows }) {
  const W = Math.round(cols * CW + PAD * 2), H = Math.round(rows * CH + PAD * 2 + BAR);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14" xml:space="preserve">
<rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
<rect width="${W}" height="${BAR}" rx="12" fill="#161922"/><rect y="${BAR - 12}" width="${W}" height="12" fill="#161922"/>
<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
<text x="${W / 2}" y="22" fill="#7c8293" font-size="13" text-anchor="middle">dyslexic mode</text>
${body}
</svg>
`;
}

// One screen as a still SVG window.
export const stillSvg = (text, size) => windowSvg(cellsSvg(parse(text, size.rows)), size);

// Screens taken every `every` ms → one SVG that plays them with CSS. Identical neighbours
// collapse into one longer frame so the file stays small.
export function animatedSvg(shots, { cols, rows, every }) {
  const keyed = [];
  for (const text of shots) {
    if (keyed.length && keyed.at(-1).text === text) keyed.at(-1).n++;
    else keyed.push({ text, n: 1 });
  }
  const total = shots.length * every / 1000;
  let at = 0;
  const groups = keyed.map((f, i) => {
    const start = at / shots.length * 100, end = (at + f.n) / shots.length * 100;
    at += f.n;
    const anim = keyed.length > 1
      ? `<style>#f${i}{animation:k${i} ${total}s step-end infinite}@keyframes k${i}{0%{visibility:hidden}${start ? `${start.toFixed(3)}%{visibility:visible}` : '0%{visibility:visible}'}${end < 100 ? `${end.toFixed(3)}%{visibility:hidden}` : ''}}</style>` : '';
    return `${anim}<g id="f${i}"${keyed.length > 1 && start > 0 ? ' visibility="hidden"' : ''}>${cellsSvg(parse(f.text, rows))}</g>`;
  }).join('');
  return { svg: windowSvg(groups, { cols, rows }), count: keyed.length };
}

// Identical neighbouring screens [{ text, ms }] become one that lasts as long as all of them.
export function collapse(timed) {
  const out = [];
  for (const s of timed) {
    if (out.length && out.at(-1).text === s.text) out.at(-1).ms += s.ms;
    else out.push({ ...s });
  }
  return out;
}

// Frames [{ svg, ms }] → out.webp (animated, loops forever) or out.mp4 (H.264, for posting).
// Frames are drawn at `zoom` times their size so text stays sharp on dense screens. An MP4 is
// one size square, the window centred on `background`, and needs frames of equal length.
export function encode(frames, out, { zoom = 2, square = 1080, margin = 48, background = '#07080c', quality = 70, work = null } = {}) {
  const dir = work ?? mkdtempSync(join(tmpdir(), 'dyslexic-frames-'));
  mkdirSync(dir, { recursive: true });
  const name = i => join(dir, String(i).padStart(4, '0'));
  frames.forEach((f, i) => writeFileSync(`${name(i)}.svg`, f.svg));
  const mp4 = out.endsWith('.mp4');
  // Drawing is the slow step, so eight frames draw at once.
  execFileSync('sh', ['-c', `ls *.svg | xargs -P 8 -I{} rsvg-convert -z ${zoom}${mp4 ? ` -b '${background}'` : ''} {} -o {}.png`], { cwd: dir });
  if (mp4) {
    const fps = Math.round(1000 / frames[0].ms), inner = square - 2 * margin;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%04d.svg.png'),
      '-vf', `scale=${inner}:${inner}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${square}:${square}:(ow-iw)/2:(oh-ih)/2:color=${background.slice(1)},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'animation', '-movflags', '+faststart', out]);
  } else {
    // -mixed lets each frame pick lossless (sharp text that barely changes) or lossy (motion).
    const args = ['-loop', '0', '-mixed'];
    frames.forEach((f, i) => args.push('-d', String(Math.round(f.ms)), '-q', String(quality), `${name(i)}.svg.png`));
    execFileSync('img2webp', [...args, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  if (!work) rmSync(dir, { recursive: true });
}
