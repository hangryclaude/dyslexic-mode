#!/usr/bin/env node
// Make a thinking style better for one model, and check the winner on questions the loop never saw.
//   node bench/evolve.mjs --model claude:opus --proposer claude:opus --rounds 4 --variants 3 \
//     --train 4 --holdout 8 --start strong --out bench/results/evolve.jsonl
// Round 0 scores the start style. Each round after it shows the proposer the best style so far and
// some questions it got wrong, keeps the new wordings that stay dyslexic and name no kind of question,
// and scores the best and the new ones together on brand-new questions. It stops after --rounds, or
// after two rounds in a row with no gain. Then base, careful, dyslexic, the start style and the winner
// are scored on questions the loop never used. --train and --holdout are questions per family.
// Next to --out it writes evolved-style.txt and evolve-summary.json. Stop it any time and start it
// again with the same arguments: finished calls are skipped, and a round the proposer already
// answered is not asked again. --dry prints how many calls it would make. --conc and --timeout work as in run.mjs.
// --scale 3 makes walk, dice, arith and letters three times as long, for a model that already gets most right.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { STYLES, STYLE_NAMES } from '../lib/thinking.mjs';
import { styled } from './conditions.mjs';
import { verdict } from './report.mjs';
import { parseConc, runBench } from './run.mjs';
import * as realRunners from './runners.mjs';
import { compare, cost, readRows, rowKey, wilson } from './stats.mjs';
import { FAMILIES, makeItems, seedFrom } from './tasks.mjs';

// "uses" has no key, and a loop that picks winners needs a number it can trust.
export const OBJECTIVE = FAMILIES.filter(f => f !== 'uses');
// Round r draws its questions with seed 1000 + r and the final check uses 9000, so no seed is shared.
export const TRAIN_SEED = 1000;
export const HOLDOUT_SEED = 9000;
export const MAX_STYLE = 1200;
export const MAX_FAILURES = 6;
export const MAX_EXCERPT = 1200;
export const FINAL_CONDS = ['base', 'careful', 'dyslexic', 'start', 'evolved'];
const NO_GAIN_LIMIT = 2;
const PROPOSER_TRIES = 2;

// ---- what counts as a valid new style -------------------------------------------------------------

// A coarse guard, not a judge: it catches a version that wandered off into plain step-by-step advice.
// Exploring wide and narrowing down are counted apart so a version needs both halves of the move.
const PILLARS = [
  ['the whole picture first', /\b(?:big picture|whole|gist|overview|zoom out|full picture|overall)/i],
  ['pictures and spatial sketches', /\b(?:picture|sketch|draw|diagram|map|grid|timeline|spatial|visuali[sz])/i],
  ['patterns and analogies', /\b(?:pattern|analog|another field|different field|other field|metaphor)/i],
  ['exploring wide', /\b(?:explor|wide|broad|several|different ways|different angles|different approaches|many ways)/i],
  ['narrowing down', /\b(?:narrow|pick|choose|settle|converge|commit)/i],
];

// Words that only turn up when a version was written for one kind of question. "pattern", "grid", "map"
// and "picture" are the dyslexic style itself, so they are not on it.
const TASK_WORDS = new RegExp(`\\b(?:${[
  'dice', 'die', 'rolls?', 'rolled', 'rolling', 'tips? over',
  'walk\\w*', 'sidestep\\w*', 'turn(?:s|ed|ing)? (?:left|right|around)', 'north\\w*', 'south\\w*', 'east\\w*', 'west\\w*', 'compass',
  'arithmetic', 'percent\\w*', 'round(?:ing)? (?:down|up)', 'shared equally', 'left ?overs?',
  'count(?:ing)? (?:the )?letters?', 'letter counts?', 'how many times',
  'number sequences?', 'next (?:two )?numbers?', 'digit sums?', 'fibonacci',
  'riddles?', 'trick questions?', 'wolf', 'goat', 'cabbage', 'farmer', 'jugs?', 'bulbs?', 'switches', 'surgeon', 'feathers?', 'steel', 'monty', 'schr[oö]dinger',
  'unusual uses', 'creative uses',
].join('|')})\\b`, 'i');

const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
const words = s => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

// Six words in a row is a quote, not a coincidence.
const RUN = 6;
function copiesQuestion(text, questions) {
  const seen = new Set();
  for (const q of questions) {
    const w = words(q);
    for (let i = 0; i + RUN <= w.length; i++) seen.add(w.slice(i, i + RUN).join(' '));
  }
  const w = words(text);
  for (let i = 0; i + RUN <= w.length; i++) if (seen.has(w.slice(i, i + RUN).join(' '))) return true;
  return false;
}

// `questions` and `answers` are the ones the proposer was shown; `others` are the styles this one
// must differ from. A version that quotes either has learned the test, not how to think.
export function checkStyle(text, { questions = [], answers = [], others = [] } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reasons: ['it is empty'] };
  const reasons = [];
  if (text.length >= MAX_STYLE) reasons.push(`it is ${text.length} characters and must be under ${MAX_STYLE}`);
  const missing = PILLARS.filter(([, re]) => !re.test(text)).map(([name]) => name);
  if (missing.length) reasons.push(`it is not dyslexic enough: nothing about ${missing.join(', ')}`);
  const task = text.match(TASK_WORDS);
  if (task) reasons.push(`it names a kind of question ("${task[0]}")`);
  // The capitals are the format line the harness adds. "the shape of the answer: what pattern" is just English.
  if (/\bANSWER\s*:/.test(text)) reasons.push('it mentions the answer line');
  const quoted = answers.find(a => a.length >= 4 && text.includes(a));
  if (quoted) reasons.push(`it contains a right answer ("${quoted}")`);
  if (copiesQuestion(text, questions)) reasons.push('it copies a run of words from a question');
  if (others.some(o => norm(o) === norm(text))) reasons.push('it is the same as another version');
  return { ok: !reasons.length, reasons };
}

// ---- the proposer -----------------------------------------------------------------------------------

// A model that writes a style over several lines often puts real newlines inside the JSON string,
// which JSON does not allow. Only the ones inside a string are escaped.
function escapeNewlines(json) {
  const raw = { '\n': '\\n', '\t': '\\t', '\r': '' };
  let inString = false, escaped = false, out = '';
  for (const ch of json) {
    out += inString && !escaped && ch in raw ? raw[ch] : ch;
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') inString = !inString;
  }
  return out;
}

function jsonIn(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const open = text.indexOf('{'), close = text.lastIndexOf('}');
  for (const candidate of [text.trim(), fence?.[1], open >= 0 && close > open ? text.slice(open, close + 1) : null]) {
    if (!candidate) continue;
    for (const attempt of [candidate, escapeNewlines(candidate)]) {
      try { return JSON.parse(attempt); } catch { /* prose around it, or newlines in a string: try the next reading */ }
    }
  }
  return null;
}

// Reads {variants: [{name, text, idea}]}, with or without a code fence or a sentence around it.
export function parseVariants(text) {
  const data = jsonIn(String(text));
  const list = Array.isArray(data) ? data : data?.variants;
  if (!Array.isArray(list)) return [];
  return list.filter(v => v && typeof v.text === 'string').map(v => ({
    name: String(v.name ?? '').trim().slice(0, 60) || 'unnamed',
    text: v.text.trim(),
    idea: String(v.idea ?? '').trim().slice(0, 400),
  }));
}

// The start and the end of a long reply: how it set the problem up and where it landed.
export function excerpt(text, max = MAX_EXCERPT) {
  const t = text.trim();
  if (t.length <= max) return t;
  const gap = '\n[... middle left out ...]\n';
  const head = Math.floor((max - gap.length) * 0.4);
  return t.slice(0, head) + gap + t.slice(t.length - (max - gap.length - head));
}

// Wrong and unreadable answers both count. One from each family in turn, so six failures are not six
// of the same kind of question.
export function pickFailures(items, rows, max = MAX_FAILURES) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const lanes = new Map();
  for (const item of items) {
    const row = byId.get(item.id);
    if (!row || row.error || row.correct !== false) continue;
    if (!lanes.has(item.family)) lanes.set(item.family, []);
    lanes.get(item.family).push({ id: item.id, question: item.prompt, reply: excerpt(row.text), answer: item.answer });
  }
  const picked = [];
  for (let i = 0; picked.length < max && [...lanes.values()].some(lane => lane.length > i); i++) {
    for (const lane of lanes.values()) if (lane[i] && picked.length < max) picked.push(lane[i]);
  }
  return picked;
}

export const PROPOSER_OPENING = 'You are improving a "thinking style": a short text placed above a question to change how an AI model thinks before it answers.';

export function proposerPrompt({ best, failures, score, count, rejected = [] }) {
  const lines = [
    PROPOSER_OPENING,
    'It has to be dyslexic thinking, made literal, and every version you write keeps all four parts of it:',
    '- the whole picture first, details last',
    '- pictures and spatial sketches: draw it, map it, reason on the drawing',
    '- patterns and analogies: the hidden rule, or something from another field that works the same way',
    '- explore wide, then narrow: several very different ways in, then pick one and check it',
    '',
    'The best style so far:',
    '<style>', best || '(none)', '</style>',
    '',
    `With it the model got ${score.k} of ${score.n} questions right on its latest test.`,
  ];
  if (failures.length) {
    lines.push(`Here ${failures.length === 1 ? 'is one' : `are ${failures.length}`} it got wrong. Each shows the question, the start and end of the model's reply, and the right answer.`);
    failures.forEach((f, i) => lines.push('', `<failure ${i + 1}>`, 'Question:', f.question, '', 'Reply:', f.reply, '', `Right answer: ${f.answer}`, `</failure ${i + 1}>`));
  } else {
    lines.push('It got none wrong, so look for a shorter, sharper wording that keeps every right answer.');
  }
  lines.push(
    '',
    `Write ${count} new version${count === 1 ? '' : 's'} of the style. Each should try a different idea for how the model could think better in general: change how it thinks, not how it writes.`,
    'Rules:',
    '- Every version keeps all four parts above.',
    '- Make the versions differ from each other and from the current style in what they ask the model to do, not only in wording.',
    `- Under ${MAX_STYLE.toLocaleString('en-US')} characters.`,
    '- Do not mention any kind of question, any answer, or any checklist for one kind of puzzle, and do not quote the questions above.',
    '  The styles are tested on brand-new questions of many kinds, so only ideas that help in general will pay off.',
  );
  if (rejected.length) lines.push('', 'Your last try was thrown out, so fix this:', ...rejected.map(r => `- "${r.name}": ${r.reasons.join('; ')}`));
  lines.push('', 'Reply with JSON only, in exactly this shape:', '{"variants": [{"name": "two or three words", "text": "the whole style", "idea": "one sentence: what is different, and why it should help"}]}');
  return lines.join('\n');
}

// Asks until `count` valid versions are in or the tries run out. A second try is told why the first
// was thrown out, which is cheaper than a round with no new version.
export async function proposeVariants({ proposer, runText, timeoutMs, best, failures, score, count, others = [], tries = PROPOSER_TRIES }) {
  const accepted = [], rejected = [];
  const questions = failures.map(f => f.question), answers = failures.map(f => f.answer);
  let lastRejected = [];
  for (let attempt = 0; attempt < tries && accepted.length < count; attempt++) {
    const prompt = proposerPrompt({ best, failures, score, count: count - accepted.length, rejected: lastRejected });
    const { text } = await runText({ model: proposer, prompt, timeoutMs });
    const fresh = parseVariants(text);
    lastRejected = fresh.length ? [] : [{ name: 'reply', reasons: ['it was not JSON in the shape asked for'] }];
    for (const v of fresh) {
      if (accepted.length >= count) break;
      const { ok, reasons } = checkStyle(v.text, { questions, answers, others: [best, ...others, ...accepted.map(a => a.text)] });
      if (ok) {
        accepted.push(v);
      } else {
        rejected.push({ name: v.name, idea: v.idea, chars: v.text.length, reasons });
        lastRejected.push({ name: v.name, reasons });
      }
    }
  }
  return { accepted, rejected };
}

// ---- questions ----------------------------------------------------------------------------------------

export const trainItems = ({ round, train, scale = 1 }) => makeItems({ seed: TRAIN_SEED + round, perFamily: train, families: OBJECTIVE, scale });

// Only the riddle family ignores the seed, so its first --train riddles come back every round. They are
// cut from the final check, which keeps the loop's questions out of it by construction.
export function holdoutItems({ rounds, train, holdout, scale = 1 }) {
  const seen = new Set(Array.from({ length: rounds + 1 }, (_, round) => trainItems({ round, train, scale })).flat().map(i => i.id));
  const all = makeItems({ seed: HOLDOUT_SEED, perFamily: holdout, families: OBJECTIVE, scale });
  return { items: all.filter(i => !seen.has(i.id)), dropped: all.filter(i => seen.has(i.id)).map(i => i.id) };
}

const sum = xs => xs.reduce((s, x) => s + x, 0);

// The most model calls a run can make: a proposer that needs both tries every round, and no resume.
export function plan({ rounds, variants, train, holdout, scale = 1 }) {
  const size = round => trainItems({ round, train, scale }).length;
  const loop = size(0) + sum(Array.from({ length: rounds }, (_, i) => (1 + variants) * size(i + 1)));
  const held = holdoutItems({ rounds, train, holdout, scale });
  const final = FINAL_CONDS.length * held.items.length;
  const proposer = rounds * PROPOSER_TRIES;
  return { questions: size(1), loop, proposer, final, finalQuestions: held.items.length, dropped: held.dropped, total: loop + proposer + final };
}

// ---- scoring ------------------------------------------------------------------------------------------

// A call that failed counts as a miss, so a style that makes the model time out pays for it.
function tally(rows, items) {
  const byId = new Map(rows.map(r => [r.id, r]));
  let k = 0, errors = 0;
  for (const item of items) {
    const r = byId.get(item.id);
    if (!r || r.error) errors++;
    else if (r.correct) k++;
  }
  return { k, n: items.length, errors };
}

const asMisses = rows => rows.map(r => (r.error ? { ...r, error: null, correct: false } : r));

// Runs every style on every item once, together, and tries the failed calls a second time. A run that
// loses more than a tenth of its calls is stopped: the rows so far are saved, so the same command
// carries on from there.
async function runPhase({ model, out, conc, timeoutMs, runners, log }, styles, items, seed) {
  const conds = Object.fromEntries(Object.entries(styles).map(([cond, text]) => [cond, styled(text)]));
  const args = { models: [model], conds, items, out, conc, seed, timeoutMs, runners, log: line => log(`  ${line}`) };
  const pairs = Object.keys(conds).flatMap(cond => items.map(item => rowKey({ model, cond, id: item.id })));
  const lost = rows => {
    const ok = new Set(rows.filter(r => !r.error).map(rowKey));
    return pairs.filter(p => !ok.has(p)).length;
  };
  let { rows } = await runBench(args);
  if (lost(rows)) ({ rows } = await runBench(args));
  const missing = lost(rows);
  if (missing > Math.max(1, Math.floor(pairs.length / 10))) {
    // "skipped: ... failed 3 times in a row" is the effect; the first error before it is the cause.
    const errors = rows.filter(r => r.model === model && r.cond in conds && r.error).map(r => r.error);
    const first = errors.find(e => !e.startsWith('skipped')) ?? errors[0];
    throw new Error(`${missing} of ${pairs.length} calls failed (first error: ${first}). The rows so far are saved: run the same command again to carry on.`);
  }
  return rows;
}

// Most right wins. On a tie the shorter text wins, then whoever came first, and the best so far
// always comes first.
export function pickWinner(candidates) {
  return candidates.reduce((w, c) => (c.k > w.k || (c.k === w.k && c.chars < w.chars) ? c : w));
}

// ---- the loop -----------------------------------------------------------------------------------------

export function startStyle(start) {
  if (Object.hasOwn(STYLES, start)) return STYLES[start];
  if (existsSync(start)) return readFileSync(start, 'utf8').trim();
  throw new Error(`--start must be one of ${STYLE_NAMES.join(', ')} or the path of a text file, not "${start}"`);
}

const NOTES = [
  'Each round compares its styles on questions nobody had seen, but the best of several noisy scores is lifted by luck. The final check, on questions the loop never used, is the number to trust.',
  'The riddle family has a fixed set of riddles. The loop reuses the first --train of them every round, and the final check gets only the riddles the loop never used.',
  'The final check runs four sign tests against the same evolved style, so one p under 0.05 can be luck.',
];

const keyOf = text => seedFrom(text).toString(16).padStart(8, '0');
const pct = (k, n) => `${String(Math.round((100 * k) / n)).padStart(3)}%`;
const scoreLine = c => `  ${c.cond.padEnd(12)} ${c.role.padEnd(8)} ${String(c.k).padStart(3)}/${c.n}  ${pct(c.k, c.n)}  ${String(c.chars).padStart(5)} chars${c.errors ? `  ${c.errors} failed` : ''}`;

export async function evolve({
  model, proposer = model, rounds = 4, variants = 3, train = 4, holdout = 8, start = 'strong', scale = 1,
  out, conc, timeoutMs, runners = realRunners, log = text => process.stderr.write(`${text}\n`),
}) {
  const startText = startStyle(start);
  const dir = dirname(out), summaryPath = join(dir, 'evolve-summary.json'), stylePath = join(dir, 'evolved-style.txt');
  const settings = { model, proposer, start, startKey: keyOf(startText), rounds, variants, train, holdout, scale };
  mkdirSync(dir, { recursive: true });

  // The summary is also the saved state of the loop, so a restart picks up where this one stopped.
  let state = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  if (state && JSON.stringify(state.settings) !== JSON.stringify(settings)) {
    throw new Error(`${summaryPath} is from a run with other settings. Use another --out folder, or move that file aside.`);
  }
  state ??= { settings, complete: false, stopped: null, stale: 0, best: null, styles: {}, rounds: [], pending: null, final: null, notes: NOTES };
  // Written beside the file and renamed over it, so a kill in the middle never leaves half a summary.
  const save = () => {
    writeFileSync(`${summaryPath}.tmp`, JSON.stringify(state, null, 2) + '\n');
    renameSync(`${summaryPath}.tmp`, summaryPath);
  };
  const ctx = { model, out, conc, timeoutMs, runners, log };

  const register = (text, info) => {
    const key = keyOf(text);
    if (state.styles[key] && state.styles[key].text !== text) throw new Error(`two different styles share the key ${key}`);
    state.styles[key] ??= { text, ...info };
    return key;
  };

  // A style is scored under a name made from the round and its text. A new round never reuses an old
  // sample of the same style, and a restart never mistakes one wording for another.
  async function scoreRound(round, picks, items) {
    const conds = picks.map(p => ({ ...p, cond: `r${round}-${p.key}` }));
    const rows = await runPhase(ctx, Object.fromEntries(conds.map(p => [p.cond, state.styles[p.key].text])), items, TRAIN_SEED + round);
    return conds.map(p => {
      const info = state.styles[p.key];
      const t = tally(rows.filter(r => r.model === model && r.cond === p.cond), items);
      return { style: p.key, cond: p.cond, role: p.role, name: info.name, idea: info.idea, chars: info.text.length, ...t };
    });
  }

  if (!state.rounds.length) {
    const t0 = Date.now(), items = trainItems({ round: 0, train, scale });
    log(`round 0: the start style (${start}) on ${items.length} new questions`);
    const key = register(startText, { name: start, idea: 'the start style', round: 0 });
    const candidates = await scoreRound(0, [{ key, role: 'start' }], items);
    state.best = key;
    state.rounds.push({ round: 0, seed: TRAIN_SEED, questions: items.length, proposed: [], candidates, winner: key, gain: null, ms: Date.now() - t0 });
    candidates.forEach(c => log(scoreLine(c)));
    save();
  }

  for (let round = state.rounds.length; round <= rounds && !state.stopped; round++) {
    const t0 = Date.now(), items = trainItems({ round, train, scale });
    if (state.pending?.round !== round) {
      // The failures are the best style's own, from the last round it was scored in.
      const last = state.rounds.findLast(r => r.candidates.some(c => c.style === state.best));
      const mine = last.candidates.find(c => c.style === state.best);
      const rows = readRows(out).filter(r => r.model === model && r.cond === mine.cond);
      const failures = pickFailures(trainItems({ round: last.round, train, scale }), rows);
      const { accepted, rejected } = await proposeVariants({
        proposer, runText: runners.runText, timeoutMs, best: state.styles[state.best].text, failures,
        score: { k: mine.k, n: mine.n }, count: variants,
      });
      state.pending = { round, shown: failures.map(f => f.id), accepted, rejected };
      save();
    }
    const { accepted, rejected } = state.pending;
    log(`round ${round}: the proposer wrote ${accepted.length + rejected.length}, ${accepted.length} kept, on ${items.length} new questions`);
    accepted.forEach(v => log(`  kept "${v.name}": ${v.idea}`));
    rejected.forEach(r => log(`  thrown out "${r.name}": ${r.reasons.join('; ')}`));

    const keys = accepted.map(v => register(v.text, { name: v.name, idea: v.idea, round }));
    const proposed = [
      ...accepted.map((v, i) => ({ style: keys[i], name: v.name, idea: v.idea, chars: v.text.length, accepted: true })),
      ...rejected.map(r => ({ ...r, accepted: false })),
    ];
    let candidates = [], winner = state.best, gain = false;
    if (keys.length) {
      candidates = await scoreRound(round, [{ key: state.best, role: 'best' }, ...keys.map(key => ({ key, role: 'variant' }))], items);
      const top = pickWinner(candidates);
      // Only more right answers than the best's own score on these same questions is a gain; a
      // tie won on length changes the style but proves nothing.
      gain = top.k > candidates[0].k;
      winner = top.style;
      candidates.forEach(c => log(scoreLine(c)));
    } else {
      log('  nothing to score this round');
    }
    state.best = winner;
    state.stale = gain ? 0 : state.stale + 1;
    state.rounds.push({ round, seed: TRAIN_SEED + round, questions: items.length, proposed, candidates, winner, gain, ms: Date.now() - t0 });
    state.pending = null;
    if (state.stale >= NO_GAIN_LIMIT) state.stopped = `no gain in ${NO_GAIN_LIMIT} rounds in a row`;
    else if (round === rounds) state.stopped = 'all rounds done';
    log(`  best now: ${state.best}${gain ? ' (a gain)' : ''}`);
    save();
  }
  state.stopped ??= 'all rounds done';

  const t0 = Date.now(), evolvedText = state.styles[state.best].text;
  const held = holdoutItems({ rounds, train, holdout, scale });
  log(`final check: ${FINAL_CONDS.length} styles on ${held.items.length} questions the loop never used`);
  const texts = { base: STYLES.base, careful: STYLES.careful, dyslexic: STYLES.dyslexic, start: startText, evolved: evolvedText };
  const rows = await runPhase(ctx, texts, held.items, HOLDOUT_SEED);
  state.final = { ...finalReport({ rows, model, items: held.items, dropped: held.dropped, texts }), ms: Date.now() - t0 };
  state.modelIds = [...new Set(rows.filter(r => r.model === model && r.modelId).map(r => r.modelId))];
  state.complete = true;
  writeFileSync(stylePath, evolvedText + '\n');
  save();
  return { ...state, paths: { rows: out, summary: summaryPath, style: stylePath } };
}

function finalReport({ rows, model, items, dropped, texts }) {
  const mine = cond => rows.filter(r => r.model === model && r.cond === cond);
  const table = FINAL_CONDS.map(cond => {
    const t = tally(mine(cond), items), { p: rate, lo, hi } = wilson(t.k, t.n), c = cost(mine(cond));
    return {
      cond, chars: texts[cond].length, ...t, rate, lo, hi,
      byFamily: Object.fromEntries(OBJECTIVE.map(f => [f, tally(mine(cond), items.filter(i => i.family === f))])),
      replyChars: c.chars, ms: c.ms, outTokens: c.outTokens,
    };
  });
  const scored = asMisses(rows.filter(r => r.model === model));
  const tests = Object.fromEntries(['base', 'careful', 'start', 'dyslexic'].map(other => {
    const t = compare(scored, 'evolved', other);
    return [other, { ...t, verdict: verdict(t) }];
  }));
  // When no version ever won, "evolved" is the start text asked a second time. Those two rows then
  // measure the model's own noise, and a gap between them is not an effect.
  return { seed: HOLDOUT_SEED, questions: items.length, dropped, evolvedIsStart: texts.evolved === texts.start, table, tests };
}

// ---- command line ---------------------------------------------------------------------------------------

export function parseOptions(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' }, proposer: { type: 'string' }, rounds: { type: 'string' }, variants: { type: 'string' },
      train: { type: 'string' }, holdout: { type: 'string' }, start: { type: 'string' }, out: { type: 'string' },
      scale: { type: 'string' }, conc: { type: 'string' }, timeout: { type: 'string' }, dry: { type: 'boolean' },
    },
  });
  const whole = (name, fallback) => {
    const n = Number(v[name] ?? fallback);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number of at least 1, not "${v[name]}"`);
    return n;
  };
  const model = v.model ?? 'claude:haiku', proposer = v.proposer ?? model, start = v.start ?? 'strong';
  realRunners.backendOf(model);
  realRunners.backendOf(proposer);
  startStyle(start);
  return {
    model, proposer, start, rounds: whole('rounds', 4), variants: whole('variants', 3), train: whole('train', 4), holdout: whole('holdout', 8),
    scale: whole('scale', 1), out: v.out ?? 'bench/results/evolve.jsonl', conc: parseConc(v.conc),
    timeoutMs: v.timeout ? Number(v.timeout) * 1000 : undefined, dry: !!v.dry,
  };
}

// Short lines and numbers in columns.
export function describe(s) {
  const out = ['round  seed  right  of  chars  winner'];
  for (const r of s.rounds) {
    const w = r.candidates.find(c => c.style === r.winner);
    const gain = r.gain === null ? '' : r.gain ? '  (a gain)' : '  (no gain)';
    out.push(w
      ? `${String(r.round).padEnd(5)}  ${r.seed}  ${String(w.k).padStart(5)}  ${String(w.n).padStart(2)}  ${String(w.chars).padStart(5)}  ${w.name}${gain}`
      : `${String(r.round).padEnd(5)}  ${r.seed}      -   -      -  nothing to score`);
  }
  const f = s.final;
  out.push('', `final check: seed ${f.seed}, ${f.questions} questions the loop never used${f.dropped.length ? ` (${f.dropped.length} cut: ${f.dropped.join(' ')})` : ''}`);
  out.push('style     right   of  rate  range     chars');
  for (const t of f.table) {
    out.push(`${t.cond.padEnd(8)}  ${String(t.k).padStart(5)}  ${String(t.n).padStart(3)}  ${pct(t.k, t.n)}  ${`${Math.round(100 * t.lo)}-${Math.round(100 * t.hi)}%`.padEnd(8)}  ${String(t.chars).padStart(5)}${t.errors ? `  ${t.errors} failed` : ''}`);
  }
  out.push('', 'evolved against   evolved only  other only        p  verdict');
  for (const [other, t] of Object.entries(f.tests)) {
    out.push(`${other.padEnd(16)}  ${String(t.aOnly).padStart(12)}  ${String(t.bOnly).padStart(10)}  ${t.p.toFixed(3).padStart(7)}  ${t.verdict}`);
  }
  if (f.evolvedIsStart) out.push('', 'no version beat the start style, so "evolved" and "start" are the same text run twice: a gap between them is noise.');
  out.push('', `stopped: ${s.stopped}`);
  return out.join('\n');
}

async function main() {
  let o;
  try {
    o = parseOptions(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (o.dry) {
    const p = plan(o);
    console.log(`${o.rounds} rounds, ${o.variants} versions each, ${o.train} questions per family (${p.questions} a round), ${o.holdout} in the final check (${p.finalQuestions} after cuts)`);
    console.log(`model ${o.model}, proposer ${o.proposer}, start ${o.start}`);
    console.log(`most calls: ${p.loop} loop + ${p.proposer} proposer + ${p.final} final = ${p.total}`);
    if (p.dropped.length) console.log(`cut from the final check, because the loop used them: ${p.dropped.join(' ')}`);
    return;
  }
  const res = await evolve(o);
  console.log(describe(res));
  console.log(`\nthe evolved style:\n${res.styles[res.best].text}`);
  console.error(`rows ${res.paths.rows}\nsummary ${res.paths.summary}\nstyle ${res.paths.style}`);
}

// Compared by real path: node resolves symlinks for import.meta.url but not for argv[1].
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
