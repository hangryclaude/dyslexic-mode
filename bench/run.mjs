#!/usr/bin/env node
// Run every (model, condition, item) once and append one JSON line per job to --out.
//   node bench/run.mjs --models claude:haiku,claude:opus --conds base,careful,dyslexic \
//     --families walk,dice --per 8 --seed 1 --out bench/results/run1.jsonl --conc claude=6,opencode=6,grok=3
// Stop it any time and start it again with the same arguments: finished jobs are skipped.
// --scale 3 makes walk, dice, arith and letters three times as long, for a model that already gets most standard items right.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CONDITIONS, styled } from './conditions.mjs';
import * as realRunners from './runners.mjs';
import { readRows, rowKey } from './stats.mjs';
import { FAMILIES, makeItems, score, shuffled } from './tasks.mjs';

const PICTURE = fileURLToPath(new URL('./picture.mjs', import.meta.url));
const PICTURE_CONDS = ['picture', 'whiteboard'];
const DEFAULT_CONC = { claude: 6, opencode: 6, grok: 3 };
const { backendOf } = realRunners;

// A counting semaphore. A freed slot goes straight to the oldest waiter.
class Gate {
  #free;
  #waiting = [];
  constructor(n) { this.#free = n; }
  async run(fn) {
    if (this.#free > 0) this.#free--;
    else await new Promise(resolve => this.#waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    }
  }
}

const clock = ms => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

// After this many quota or login failures in a row, a model's other jobs are not worth trying.
const TRIP_AFTER = 3;

// `conds` maps a name to a condition function, so a caller can add its own (see styled()). Jobs are
// shuffled by `seed` so no model and no condition gets the quiet hours. The caps limit how many
// processes each backend runs at once, including the parallel calls inside one job.
export async function runBench({
  models, conds, items, out, conc = DEFAULT_CONC, seed = 1, timeoutMs, runners = realRunners, log = line => process.stderr.write(`${line}\n`),
}) {
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set(readRows(out).filter(r => !r.error).map(rowKey));
  const all = shuffled(models.flatMap(model => Object.keys(conds).flatMap(cond => items.map(item => ({ model, cond, item })))), seed);
  const todo = all.filter(j => !done.has(rowKey({ model: j.model, cond: j.cond, id: j.item.id })));
  const gates = {}, queues = {};
  for (const job of todo) {
    const b = backendOf(job.model);
    gates[b] ??= new Gate(conc[b] ?? DEFAULT_CONC[b] ?? 4);
    (queues[b] ??= []).push(job);
  }
  log(`${all.length} jobs, ${all.length - todo.length} already done, ${todo.length} to run`);

  const stats = { total: todo.length, finished: 0, errors: 0 };
  const failures = {}, tripped = new Set();
  const t0 = Date.now();

  async function runJob({ model, cond, item }) {
    const gate = gates[backendOf(model)];
    // outTokens stays null for a backend that does not report them, rather than a made-up 0.
    const acc = { calls: 0, outTokens: null, modelId: null };
    const through = fn => args => gate.run(async () => {
      const r = await fn({ timeoutMs, ...args, model });
      acc.calls++;
      if (r.outTokens != null) acc.outTokens = (acc.outTokens ?? 0) + r.outTokens;
      acc.modelId ??= r.modelId ?? null;
      return r;
    });
    const base = { model, cond, id: item.id, family: item.family, answer: item.answer };
    const start = Date.now();
    let row;
    try {
      if (tripped.has(model)) throw new Error(`skipped: ${model} failed ${TRIP_AFTER} times in a row on quota or login`);
      const res = await conds[cond]({ model, item, runText: through(runners.runText), runImage: through(runners.runImage) });
      const s = score(item, res.text);
      failures[model] = 0;
      row = { ...base, got: s.got, correct: s.correct, formatOk: s.formatOk, ms: Date.now() - start, calls: res.calls, chars: res.text.length, text: res.text, error: null, outTokens: acc.outTokens, modelId: acc.modelId };
    } catch (err) {
      if (err.fatal && (failures[model] = (failures[model] ?? 0) + 1) >= TRIP_AFTER) tripped.add(model);
      stats.errors++;
      row = { ...base, got: null, correct: null, formatOk: false, ms: Date.now() - start, calls: acc.calls, chars: 0, text: '', error: err.message, outTokens: acc.outTokens, modelId: acc.modelId };
    }
    appendFileSync(out, JSON.stringify(row) + '\n');
    stats.finished++;
    if (stats.finished % 10 === 0 || stats.finished === stats.total) {
      const spent = Date.now() - t0, eta = (spent / stats.finished) * (stats.total - stats.finished);
      log(`[${stats.finished}/${stats.total}] ${Math.round((100 * stats.finished) / stats.total)}%  errors ${stats.errors}  elapsed ${clock(spent)}  eta ${clock(eta)}`);
    }
  }

  const workers = Object.entries(queues).flatMap(([b, queue]) => (
    Array.from({ length: Math.min(conc[b] ?? DEFAULT_CONC[b] ?? 4, queue.length) }, async () => {
      for (let job; (job = queue.shift());) await runJob(job);
    })
  ));
  await Promise.all(workers);
  return { ...stats, skipped: all.length - todo.length, rows: readRows(out) };
}

// "claude=6,grok=3" -> { claude: 6, grok: 3 }
export function parseConc(text) {
  const conc = { ...DEFAULT_CONC };
  for (const part of text ? text.split(',') : []) {
    const [name, n] = part.split('=');
    if (!(name in DEFAULT_CONC) || !(Number(n) >= 1)) throw new Error(`bad --conc entry "${part}": use claude=6,opencode=6,grok=3`);
    conc[name] = Number(n);
  }
  return conc;
}

const list = text => (text ? text.split(',').map(s => s.trim()).filter(Boolean) : null);

async function main() {
  const { values: v } = parseArgs({
    options: {
      models: { type: 'string' }, conds: { type: 'string' }, families: { type: 'string' }, per: { type: 'string' },
      seed: { type: 'string' }, out: { type: 'string' }, conc: { type: 'string' }, timeout: { type: 'string' },
      style: { type: 'string', multiple: true }, dry: { type: 'boolean' }, scale: { type: 'string' },
    },
  });
  const fail = msg => { console.error(msg); process.exit(2); };

  const available = { ...CONDITIONS };
  // The picture conditions are written separately. Without their file they are skipped, loudly.
  let picture = null;
  if (existsSync(PICTURE)) picture = await import(pathToFileURL(PICTURE).href);
  if (picture) for (const name of PICTURE_CONDS) available[name] = picture[name];
  // --style name=path/to/text.txt adds a condition that asks with that thinking style.
  for (const spec of v.style ?? []) {
    const [name, path] = spec.split('=');
    if (!name || !path || !existsSync(path)) fail(`bad --style "${spec}": use name=path/to/style.txt`);
    available[name] = styled(readFileSync(path, 'utf8').trim());
  }

  const wanted = list(v.conds) ?? [...Object.keys(CONDITIONS), ...PICTURE_CONDS, ...(v.style ?? []).map(s => s.split('=')[0])];
  const skipped = wanted.filter(c => PICTURE_CONDS.includes(c) && !picture);
  if (skipped.length) console.error(`warning: skipping ${skipped.join(', ')}: bench/picture.mjs does not exist yet`);
  const names = wanted.filter(c => !skipped.includes(c));
  const unknown = names.filter(c => !available[c]);
  if (unknown.length) fail(`unknown condition ${unknown.join(', ')}. Available: ${Object.keys(available).join(', ')}`);

  const families = list(v.families) ?? FAMILIES;
  const badFamily = families.filter(f => !FAMILIES.includes(f));
  if (badFamily.length) fail(`unknown family ${badFamily.join(', ')}. Available: ${FAMILIES.join(', ')}`);

  const seed = Number(v.seed ?? 1), per = Number(v.per ?? 8);
  const scale = Number(v.scale ?? 1);
  const items = makeItems({ seed, perFamily: per, families, scale });
  const models = list(v.models) ?? ['claude:haiku'];
  for (const m of models) backendOf(m);
  const conds = Object.fromEntries(names.map(n => [n, available[n]]));
  const out = v.out ?? 'bench/results/run.jsonl';

  if (v.dry) {
    console.log(`${models.length} models x ${names.length} conditions x ${items.length} items = ${models.length * names.length * items.length} jobs`);
    console.log(`models: ${models.join(', ')}\nconditions: ${names.join(', ')}\nfamilies: ${families.join(', ')} (${per} each, seed ${seed}${scale > 1 ? `, scale ${scale}` : ''})`);
    return;
  }
  const res = await runBench({ models, conds, items, out, conc: parseConc(v.conc), seed, timeoutMs: v.timeout ? Number(v.timeout) * 1000 : undefined });
  console.error(`done: ${res.finished} run, ${res.skipped} skipped, ${res.errors} errors -> ${out}`);
}

// Compared by real path: node resolves symlinks for import.meta.url but not for argv[1].
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
