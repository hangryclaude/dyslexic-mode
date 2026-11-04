#!/usr/bin/env node
// Records a terminal program for the README: an animated SVG, or a smooth animated WebP when the
// name ends in .webp (that needs the tools named in tools/screens.mjs).
// No recorder is installed on purpose: tmux already keeps every cell's color, so we read that.
// Usage: node tools/capture.mjs <out.svg|out.webp> --cols 96 --rows 30 --frames 40 --every 120
//   [--keys "hey\n"@2000] [--type "hey\n"@2000] [--hold 6000] [--work dir] -- <command...>
// --keys sends the text at once, --type a letter at a time. For a WebP, --hold is how long the
// last screen stays before the loop starts again, and --work keeps the frames.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { animatedSvg, collapse, encode, stillSvg } from './screens.mjs';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const opts = argv.slice(0, split);
const command = argv.slice(split + 1).join(' ');
const out = opts[0];
const num = (name, d) => (opts.includes(`--${name}`) ? Number(opts[opts.indexOf(`--${name}`) + 1]) : d);
const cols = num('cols', 96), rows = num('rows', 30), frames = num('frames', 40), every = num('every', 120);
const wait = num('wait', 1500);
const timedText = flag => opts.filter((_, i) => opts[i - 1] === flag).map(k => {
  const at = k.lastIndexOf('@');
  return { text: k.slice(0, at).replace(/\\n/g, '\n'), at: Number(k.slice(at + 1)) };
});
// Typed text goes in at a person's pace, so a smooth recording shows it being typed.
const keys = [...timedText('--keys'), ...timedText('--type').flatMap(({ text, at }) => [...text].map((ch, i) => ({ text: ch, at: at + i * 55 })))];

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
  shots.push({ text: tmux('capture-pane', '-t', name, '-p', '-e'), at: performance.now() });
  advance(every);
}
try { tmux('kill-server'); } catch {}

if (out.endsWith('.svg')) {
  const { svg, count } = animatedSvg(shots.map(s => s.text), { cols, rows, every });
  writeFileSync(out, svg);
  console.log(`${out}: ${count} frames, ${(svg.length / 1024).toFixed(0)} KB`);
} else {
  // Each screen plays for as long as it really showed: measured, since capturing takes time too.
  const timed = shots.map((s, i) => ({ text: s.text, ms: (shots[i + 1]?.at ?? s.at + every) - s.at }));
  const screens = collapse(timed);
  if (num('hold', 0)) screens.at(-1).ms = num('hold', 0);
  const frames = screens.map(f => ({ svg: stillSvg(f.text, { cols, rows }), ms: f.ms }));
  encode(frames, out, { work: opts.includes('--work') ? opts[opts.indexOf('--work') + 1] : null });
  console.log(`${out}: ${frames.length} frames`);
}
