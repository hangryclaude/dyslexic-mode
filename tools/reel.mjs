#!/usr/bin/env node
// Records /brain as a seamless loop: the app's own brainLines frames for one full turn, drawn one
// by one rather than timed off a live terminal, so the motion is perfectly even.
// Usage: node tools/reel.mjs <out.webp|out.mp4> [--models models.json] [--cols 76] [--rows 34]
//   [--palette neon] [--zoom 1] [--square 1080] [--work dir]
// It needs the tools named in tools/screens.mjs.
import { readFileSync } from 'node:fs';
import { brainCaption, brainLines, TURN } from '../lib/anim.mjs';
import { brainOf } from '../lib/modelmenu.mjs';
import { setPalette } from '../lib/palette.mjs';
import { encode, stillSvg } from './screens.mjs';

const argv = process.argv.slice(2), out = argv[0];
const opt = (name, d) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : d);
const cols = Number(opt('cols', 76)), rows = Number(opt('rows', 34));
setPalette(opt('palette', 'neon'));
// The models: a models.json you name, else the list /model keeps.
const file = opt('models', null);
const { words, tally } = brainOf(file ? JSON.parse(readFileSync(file, 'utf8')).models : undefined);

const screens = Array.from({ length: TURN }, (_, f) => brainLines({ cols, rows, f, words, caption: brainCaption(tally) }));
// Rows that no frame ever uses go, keeping one blank row between the brain and its caption,
// and what is left sits in the middle of the window.
const plain = l => l.replace(/\x1b\[[0-9;]*m/g, '').trim();
const used = screens[0].map((_, r) => screens.some(lines => plain(lines[r])));
const keep = used.flatMap((u, r) => (u || (used[r - 1] && used.slice(r).includes(true)) ? [r] : []));
const top = Array((rows - keep.length) >> 1).fill('');
const frames = screens.map(lines => ({ svg: stillSvg([...top, ...keep.map(r => lines[r])].join('\n'), { cols, rows }), ms: 1000 / 30 }));

// Every frame of a turning brain is new, so a WebP's size grows with every pixel: it is drawn at
// its own size. An MP4 is drawn twice as big and scaled down into the square, for sharp text.
encode(frames, out, { zoom: Number(opt('zoom', out.endsWith('.mp4') ? 2 : 1)), square: Number(opt('square', 1080)), work: opt('work', null) });
console.log(`${out}: ${frames.length} frames, ${words.length} names, ${tally}`);
