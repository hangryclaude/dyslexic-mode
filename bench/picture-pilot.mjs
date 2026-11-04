#!/usr/bin/env node
// Real-call pilot for the picture and whiteboard conditions: one proof that a model reads a PNG,
// then three hand-written questions through both conditions on one model. Twelve model calls and
// one more for the proof, so it is cheap on haiku.
// Usage: node bench/picture-pilot.mjs [--model claude:haiku] [--jobs 3]
// Writes each picture, the SVG it came from, and results.json to bench/results/picture-pilot/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { picture, whiteboard, renderPng, claudeText, claudeImage } from './picture.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const model = arg('model', 'claude:haiku');
const jobs = Number(arg('jobs', 3));
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'results', 'picture-pilot');

// The answers were checked a second way than by hand: the robot and the die were stepped in code.
const ITEMS = [
  {
    id: 'grid-walk',
    family: 'spatial',
    prompt: 'A robot starts on a 5 by 5 grid at column 2, row 2. Columns are numbered 1 to 5 from left to right and rows 1 to 5 from bottom to top. It makes six moves, in this order: right 2, up 2, left 3, down 1, right 1, up 1. In which column and row does the robot end?',
    ask: 'In which column and row does the robot end?',
    format: 'Finish with one line: ANSWER: <column>,<row>',
    answer: '2,4',
  },
  {
    id: 'die-roll',
    family: 'spatial',
    prompt: 'A standard die has opposite faces that add up to 7. It sits on a table with 1 on top, 2 facing north and 3 facing east. It is rolled three times, each roll tipping it over one bottom edge: first north, then north again, then east. Rolling in a direction moves the old top face to that side. Which number is on top at the end?',
    ask: 'Which number is on top at the end?',
    format: 'Finish with one line: ANSWER: <number>',
    answer: '4',
  },
  {
    id: 'riddle',
    family: 'riddle',
    prompt: 'Riddle: what five-letter word becomes shorter when you add two letters to it?',
    ask: 'What is the answer to the riddle?',
    format: 'Finish with one line: ANSWER: <word>',
    answer: 'short',
  },
];

// A 7 drawn with a stroke, so the model has to read a picture and not a font.
const SEVEN = '<svg viewBox="0 0 800 800"><path d="M 200 220 H 600 L 380 620" stroke="#000" stroke-width="64" fill="none"/></svg>';

const norm = s => s.toLowerCase().replace(/[\s()'"*`.]/g, '');
const given = text => (text.match(/answer:\s*(.+)/gi)?.at(-1) ?? '').replace(/^answer:\s*/i, '');

async function proof() {
  writeFileSync(join(OUT, 'digit-7.svg'), SEVEN);
  const png = join(OUT, 'digit-7.png');
  const via = await renderPng(SEVEN, png);
  const t = Date.now();
  const reply = await claudeImage(model, png, 'What digit is shown in the picture? Reply with the digit only.');
  return { question: 'What digit is shown in the picture?', reply, ok: reply.trim() === '7', ms: Date.now() - t, via };
}

// Every call is timed on its own, so the numbers say where a run spends its time.
async function run(item, name, condition) {
  const steps = [];
  const timed = (kind, fn) => async (...args) => {
    const t = Date.now();
    const out = await fn(...args);
    steps.push({ kind, ms: Date.now() - t });
    return out;
  };
  const render = async (svg, png) => {
    const t = Date.now();
    const via = await renderPng(svg, png);
    steps.push({ kind: 'render', ms: Date.now() - t, via });
  };
  const t0 = Date.now();
  const row = { id: item.id, condition: name, gold: item.answer };
  try {
    const r = await condition({
      model, item, render, dir: OUT, name: `${item.id}.${name}`,
      runText: timed('draw', claudeText),
      runImage: timed('answer', claudeImage),
    });
    Object.assign(row, { given: given(r.text), ok: norm(given(r.text)) === norm(item.answer), calls: r.calls, png: relative(OUT, r.png), reply: r.text });
  } catch (err) {
    Object.assign(row, { ok: false, error: err.message });
  }
  return { ...row, ms: Date.now() - t0, steps };
}

async function pool(tasks, limit) {
  const done = [];
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const at = next++;
      done[at] = await tasks[at]();
    }
  }));
  return done;
}

const sec = ms => `${(ms / 1000).toFixed(1)}s`;
const line = r => [
  r.id.padEnd(10), r.condition.padEnd(10),
  `gave ${String(r.given ?? r.error).padEnd(8)}`, `gold ${r.gold.padEnd(6)}`, r.ok ? 'RIGHT' : 'WRONG',
  `calls ${r.calls ?? '-'}`, `total ${sec(r.ms).padStart(6)}`,
  r.steps.map(s => `${s.kind} ${sec(s.ms)}${s.via ? ` (${s.via})` : ''}`).join('  '),
].join('  ');

mkdirSync(OUT, { recursive: true });
const started = Date.now();
const p = await proof();
console.log(`proof       ${model} reads digit-7.png -> ${JSON.stringify(p.reply)}  ${p.ok ? 'RIGHT' : 'WRONG'}  ${sec(p.ms)}  (rendered by ${p.via})`);
const tasks = ITEMS.flatMap(item => [['picture', picture], ['whiteboard', whiteboard]].map(([name, condition]) => async () => {
  const r = await run(item, name, condition);
  console.log(line(r));
  return r;
}));
const runs = await pool(tasks, jobs);
const results = { model, date: new Date().toISOString(), jobs, wallMs: Date.now() - started, proof: p, runs };
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const name of ['picture', 'whiteboard']) {
  const mine = runs.filter(r => r.condition === name);
  console.log(`${name.padEnd(10)}  ${mine.filter(r => r.ok).length} of ${mine.length} right`);
}
console.log(`wall ${sec(results.wallMs)}, results in ${relative(process.cwd(), OUT) || '.'}`);
