#!/usr/bin/env node
// The creative-uses family has no key, so it is judged: for each (model, object) the lists from every
// condition are shuffled, labelled A, B, C..., and ranked by two judges who never see a condition name.
//   node bench/judge.mjs --in bench/results/run1.jsonl --out bench/results/run1.judge.jsonl [--limit 1]
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runText as realRunText } from './runners.mjs';
import { judgeKey, readRows, unique } from './stats.mjs';
import { seedFrom, shuffled, usesObject } from './tasks.mjs';

// Two judges from different families, so neither can simply prefer its own kind of list.
export const JUDGES = ['claude:sonnet', 'opencode:opencode-go/gpt-6-luna'];

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function judgePrompt(object, lists) {
  return [
    `Below are ${lists.length} lists of unusual uses for ${object}. Each list was written by a different writer.`,
    'Rank the lists from best to worst. A better list has uses that are more original (surprising, not the first thing',
    'everyone thinks of) and more useful (someone could really do it, and would want to).',
    'Judge the ideas, not the length, the wording or the layout.',
    '',
    ...lists.flatMap(l => [`List ${l.label}`, ...l.lines.map((u, i) => `${i + 1}. ${u}`), '']),
    'Reply with one short sentence about each list, then end with one line in exactly this form, best list first:',
    `RANKING: ${lists.map(l => l.label).join(' > ')}`,
  ].join('\n');
}

// The labels after the last "RANKING:", best first. Anything but each label exactly once is no ranking.
export function parseRanking(text, labels) {
  let at = -1, len = 0;
  for (const m of text.matchAll(/ranking\s*:/gi)) { at = m.index; len = m[0].length; }
  if (at < 0) return null;
  const line = text.slice(at + len).split('\n').find(l => l.trim()) ?? '';
  const got = (line.replace(/[*`_]/g, '').match(/\b[A-Za-z]\b/g) ?? []).map(c => c.toUpperCase());
  const ok = got.length === labels.length && unique(got).length === labels.length && labels.every(l => got.includes(l));
  return ok ? got : null;
}

// Every (model, object) that has at least two well-formed lists, with the lists from each condition.
export function groups(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.family !== 'uses' || r.error || !r.formatOk) continue;
    const key = `${r.model}|${r.id}`;
    if (!by.has(key)) by.set(key, { model: r.model, id: r.id, lists: [] });
    by.get(key).lists.push({ cond: r.cond, lines: r.got.split('\n') });
  }
  return [...by.values()].filter(g => g.lists.length >= 2).sort((a, b) => (a.model + a.id).localeCompare(b.model + b.id));
}

// One judge looks at one group. The order is shuffled per judge, so a liking for the first list
// shows up as noise instead of favouring one condition.
export async function judgeGroup({ group, judge, runText, seed = 1 }) {
  const order = shuffled(group.lists, seedFrom(`${seed}|${judge}|${group.model}|${group.id}`));
  const lists = order.map((l, i) => ({ ...l, label: LABELS[i] }));
  const object = usesObject(group.id);
  const t0 = Date.now();
  const { text } = await runText({ model: judge, prompt: judgePrompt(object, lists) });
  const labels = lists.map(l => l.label);
  const ranking = parseRanking(text, labels);
  if (!ranking) throw new Error(`no usable ranking from ${judge}: ${text.slice(-200).replace(/\s+/g, ' ')}`);
  const byLabel = Object.fromEntries(lists.map(l => [l.label, l.cond]));
  return {
    model: group.model, id: group.id, object, judge,
    labels: byLabel, ranking,
    ranks: Object.fromEntries(ranking.map((label, i) => [byLabel[label], i + 1])),
    ms: Date.now() - t0, error: null,
  };
}

export async function judgeAll({ rows, judges = JUDGES, runText = realRunText, out, limit, seed = 1, conc = 4, log = line => process.stderr.write(`${line}\n`) }) {
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set(readRows(out, judgeKey).filter(r => !r.error).map(judgeKey));
  const picked = groups(rows).slice(0, limit ?? Infinity);
  const todo = picked
    .flatMap(group => judges.map(judge => ({ group, judge })))
    .filter(j => !done.has(judgeKey({ model: j.group.model, id: j.group.id, judge: j.judge })));
  log(`${picked.length} lists to rank, ${todo.length} judge calls to make`);
  let errors = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(conc, queue.length) }, async () => {
    for (let job; (job = queue.shift());) {
      let row;
      try {
        row = await judgeGroup({ ...job, runText, seed });
      } catch (err) {
        errors++;
        row = { model: job.group.model, id: job.group.id, judge: job.judge, ranks: null, error: err.message };
      }
      appendFileSync(out, JSON.stringify(row) + '\n');
    }
  }));
  return { groups: picked.length, calls: todo.length, errors, rows: readRows(out, judgeKey) };
}

async function main() {
  const { values: v } = parseArgs({
    options: { in: { type: 'string' }, out: { type: 'string' }, judges: { type: 'string' }, limit: { type: 'string' }, seed: { type: 'string' }, conc: { type: 'string' } },
  });
  if (!v.in) { console.error('usage: node bench/judge.mjs --in results.jsonl [--out results.judge.jsonl] [--judges a,b] [--limit 1]'); process.exit(2); }
  const out = v.out ?? v.in.replace(/\.jsonl$/, '') + '.judge.jsonl';
  const res = await judgeAll({
    rows: readRows(v.in), out, judges: v.judges ? v.judges.split(',') : JUDGES,
    limit: v.limit ? Number(v.limit) : undefined, seed: Number(v.seed ?? 1), conc: Number(v.conc ?? 4),
  });
  console.error(`done: ${res.calls} judge calls, ${res.errors} errors -> ${out}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
