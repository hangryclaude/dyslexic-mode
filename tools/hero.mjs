#!/usr/bin/env node
// Draws media/hero.png, the README banner. It is a PNG because sites that show a project card
// from its README (angusbuilds.com) skip SVG. The brain and the wordmark are the intro's own
// code, stopped on its last frame. Needs Google Chrome; nothing to install.
// Usage: node tools/hero.mjs [out.png]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderBrain } from '../lib/brain.mjs';
import { banner, paint } from '../lib/anim.mjs';
import { grad } from '../lib/palette.mjs';
import { MAKERS } from '../lib/makers.mjs';

const out = resolve(process.argv[2] || 'media/hero.png');
const W = 1200, H = 800;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const css = rgb => `rgb(${rgb.join(',')})`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// paint() speaks ANSI; turn its colour codes into spans.
const html = line => line.split(/\x1b\[([0-9;]*)m/).map((part, i) => {
  if (i % 2 === 0) return esc(part);
  const m = part.match(/^38;2;(\d+);(\d+);(\d+)$/);
  return m ? `</span><span style="color:rgb(${m[1]},${m[2]},${m[3]})">` : '';
}).join('');

// The intro's last frame: three-quarter view, banner coloured left to right.
const BW = 34, BH = 15;
const brain = paint(renderBrain({ cols: BW, rows: BH, angle: -0.7 })).map(l => `<span>${html(l)}</span>`);
const rows = [...banner('DYSLEXIC'), '', ...banner('MODE')];
const w = Math.max(...rows.map(r => r.length));
const word = rows.map(r => [...r].map((ch, x) => (ch === ' ' ? ' ' : `<span style="color:${css(grad(1 - x / w * 0.6))}">█</span>`)).join(''));
const top = (BH - rows.length) >> 1;
const lines = brain.map((b, y) => `${b}   ${word[y - top] ?? ''}`);

const families = MAKERS.slice(0, 8).map(m => `<span><i style="background:${css(m.color)}"></i>${m.family}</span>`).join('');

const page = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;background:#0d0f14;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6e6e6}
pre{margin:0;font:inherit;font-size:20px;line-height:24px;white-space:pre}
h1{margin:0;font-size:46px;font-weight:600;letter-spacing:.01em;color:${css(grad(0.55))}}
p{margin:0;display:flex;gap:22px;font-size:21px}
p span{display:flex;align-items:center;gap:10px}
p i{width:14px;height:14px;border-radius:50%}
p em{font-style:normal;color:#7c8293}
</style><pre>${lines.join('\n')}</pre>
<h1>turn your agent dyslexic</h1>
<p>${families}<em>+${MAKERS.length - 8} more</em></p>`;

const dir = mkdtempSync(join(tmpdir(), 'hero-'));
writeFileSync(join(dir, 'hero.html'), page);
execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
  '--force-device-scale-factor=2', `--screenshot=${out}`, `file://${join(dir, 'hero.html')}`], { stdio: 'ignore' });
console.log(out);
