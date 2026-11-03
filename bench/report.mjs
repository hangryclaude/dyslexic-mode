#!/usr/bin/env node
// Turn a results file into tables.
//   node bench/report.mjs --in bench/results/run1.jsonl [--judge bench/results/run1.judge.jsonl] \
//     --md bench/RESULTS.md --html ~/dev/pages/dyslexic-bench.html
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { accuracy, compare, cost, judgeKey, mean, readRows, unique } from './stats.mjs';
import { FAMILIES } from './tasks.mjs';

const COND_ORDER = ['base', 'careful', 'dyslexic', 'strong', 'extreme', 'scrambled', 'explorer', 'vote3', 'picture', 'whiteboard'];
const orderOf = c => (COND_ORDER.includes(c) ? COND_ORDER.indexOf(c) : COND_ORDER.length);
const ALL = 'all';

// A verdict needs at least six pairs where the two conditions disagree: five out of five is still p = 0.06.
export function verdict(t) {
  if (t.aOnly + t.bOnly < 6) return 'too few to tell';
  if (t.p >= 0.05) return 'no clear difference';
  return t.diff > 0 ? 'clearly better' : 'clearly worse';
}

// Everything both renderers need, computed once, so the markdown and the page cannot disagree.
export function analyze(rows, judgeRows = []) {
  const models = unique(rows.map(r => r.model)).sort();
  const conds = unique(rows.map(r => r.cond)).sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
  const families = FAMILIES.filter(f => rows.some(r => r.family === f));
  const scope = [ALL, ...models];
  const slice = (cond, model, family) => rows.filter(r => r.cond === cond && (model === ALL || r.model === model) && (!family || r.family === family));

  const grid = family => Object.fromEntries(conds.map(c => [c, Object.fromEntries(scope.map(m => [m, accuracy(slice(c, m, family))]))]));
  const tests = ref => Object.fromEntries(conds.filter(c => c !== ref && conds.includes(ref)).map(c => [
    c, Object.fromEntries(scope.map(m => [m, compare(rows, c, ref, r => m === ALL || r.model === m)])),
  ]));

  const uses = rows.filter(r => r.family === 'uses' && !r.error);
  const withFormat = list => {
    const ok = list.filter(r => !r.error);
    return { ...cost(list), formatOk: ok.length ? ok.filter(r => r.formatOk).length / ok.length : null };
  };
  return {
    models, conds, families, scope,
    counts: { rows: rows.length, errors: rows.filter(r => r.error).length, items: unique(rows.map(r => r.id)).length },
    errorsBy: Object.fromEntries(models.map(m => [m, rows.filter(r => r.model === m && r.error).length])),
    errorSample: unique(rows.filter(r => r.error).map(r => r.error)).slice(0, 3),
    modelIds: Object.fromEntries(models.map(m => [m, unique(rows.filter(r => r.model === m && r.modelId).map(r => r.modelId))])),
    pooled: grid(null),
    byFamily: Object.fromEntries(families.filter(f => f !== 'uses').map(f => [f, grid(f)])),
    tests: { base: tests('base'), careful: tests('careful') },
    cost: Object.fromEntries(conds.map(c => [c, withFormat(slice(c, ALL, null))])),
    // Waiting time only means something inside one model, so it is also kept per model.
    costBy: Object.fromEntries(conds.map(c => [c, Object.fromEntries(models.map(m => [m, cost(slice(c, m, null))]))])),
    uses: {
      formatOk: Object.fromEntries(conds.map(c => [c, { k: uses.filter(r => r.cond === c && r.formatOk).length, n: uses.filter(r => r.cond === c).length }])),
      ranks: rankTable(judgeRows, conds),
    },
  };
}

// Mean rank per condition (1 is best), first places, and the same per judge.
export function rankTable(judgeRows, conds) {
  const ok = judgeRows.filter(r => !r.error && r.ranks);
  if (!ok.length) return null;
  const judges = unique(ok.map(r => r.judge)).sort();
  const stat = list => ({ n: list.length, mean: mean(list.map(r => r.rank)), firsts: list.filter(r => r.rank === 1).length });
  const flat = ok.flatMap(r => Object.entries(r.ranks).map(([cond, rank]) => ({ cond, rank, judge: r.judge })));
  return {
    judges, calls: ok.length,
    byCond: Object.fromEntries(conds.map(c => [c, {
      ...stat(flat.filter(f => f.cond === c)),
      byJudge: Object.fromEntries(judges.map(j => [j, stat(flat.filter(f => f.cond === c && f.judge === j))])),
    }])),
  };
}

// ---- markdown -----------------------------------------------------------------------------------

const pct = x => (x == null ? '-' : `${Math.round(100 * x)}%`);
const frac = a => (a.n ? `${a.k}/${a.n}` : '0/0');
const full = a => (a.n ? `${a.k}/${a.n} (${pct(a.p)})` : '0/0');
const pText = p => (p < 0.001 ? '<0.001' : p.toFixed(3));
const secs = ms => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const num = (x, d = 1) => (x == null ? '-' : x.toFixed(d));
const testText = t => (t.n ? `+${t.aOnly} / -${t.bOnly}, p ${pText(t.p)}` : '-');
const rankings = n => `${n} ranking${n === 1 ? '' : 's'}`;

function mdTable(head, rows, right = []) {
  const all = [head, ...rows].map(r => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map(r => r[i].length), 3));
  const line = r => `| ${r.map((c, i) => (right.includes(i) ? c.padStart(w[i]) : c.padEnd(w[i]))).join(' | ')} |`;
  const rule = `|${w.map((x, i) => (right.includes(i) ? `${'-'.repeat(x + 1)}:` : '-'.repeat(x + 2))).join('|')}|`;
  return [line(all[0]), rule, ...all.slice(1).map(line)].join('\n');
}

export function renderMarkdown(a) {
  const cols = a.models.length > 1 ? [...a.models, 'all models'] : a.models;
  const scopeOf = i => (i < a.models.length ? a.models[i] : ALL);
  const right = cols.map((_, i) => i + 1);
  const accTable = (g, fmt) => mdTable(['Condition', ...cols], a.conds.map(c => [c, ...cols.map((_, i) => fmt(g[c][scopeOf(i)]))]), right);

  const out = [
    '# Does thinking like a dyslexic reader help a model?',
    '',
    `${a.counts.rows} jobs (${a.counts.errors} failed) over ${a.counts.items} questions, ${a.models.length} model${a.models.length === 1 ? '' : 's'} and ${a.conds.length} conditions.`,
    `Models: ${a.models.map(m => (a.modelIds[m].length ? `${m} (${a.modelIds[m].join(', ')})` : m)).join(', ')}.`,
    'Cells are right/total. Jobs that failed are left out of the totals. The creative-uses family has no key and is covered at the end.',
  ];
  if (a.counts.errors) out.push('', `Failed jobs by model: ${a.models.map(m => `${m} ${a.errorsBy[m]}`).join(', ')}. For example: ${a.errorSample.map(e => `"${e.slice(0, 120)}"`).join('; ')}`);

  out.push('', '## All families together', '', accTable(a.pooled, full), '', 'Wilson 95% interval, all models together:', '',
    mdTable(['Condition', 'Right', 'Interval'], a.conds.map(c => [c, full(a.pooled[c][ALL]), a.pooled[c][ALL].n ? `${pct(a.pooled[c][ALL].lo)} to ${pct(a.pooled[c][ALL].hi)}` : '-']), [1, 2]));

  for (const [family, g] of Object.entries(a.byFamily)) out.push('', `## ${family}`, '', accTable(g, frac));

  for (const ref of ['base', 'careful']) {
    if (!a.conds.includes(ref)) continue;
    out.push('', `## Against ${ref}`, '',
      `Paired sign test on the same (model, question) pairs. "+x / -y" is x pairs where the condition was right and ${ref} wrong, against y the other way round.`, '',
      mdTable(['Condition', ...cols], Object.entries(a.tests[ref]).map(([c, t]) => [c, ...cols.map((_, i) => testText(t[scopeOf(i)]))]), right),
      '', mdTable(['Condition', 'Verdict, all models'], Object.entries(a.tests[ref]).map(([c, t]) => [c, verdict(t[ALL])])));
  }

  out.push('', '## Time and length', '', 'Time is the wall time of one job, the way a person waiting would feel it. Calls is the mean number of model calls per job. All models together:', '',
    mdTable(['Condition', 'Jobs', 'Calls', 'Time (median)', 'Length (median chars)', 'Output tokens (mean)', 'Reply in format'],
      a.conds.map(c => { const k = a.cost[c]; return [c, k.n, num(k.calls), secs(k.ms), k.chars == null ? '-' : Math.round(k.chars), k.outTokens == null ? '-' : Math.round(k.outTokens), pct(k.formatOk)]; }), [1, 2, 3, 4, 5, 6]));
  if (a.models.length > 1) {
    out.push('', 'Median time per job, by model (models differ a lot in speed, so compare down a column):', '',
      mdTable(['Condition', ...a.models], a.conds.map(c => [c, ...a.models.map(m => secs(a.costBy[c][m].ms))]), a.models.map((_, i) => i + 1)));
  }

  if (a.families.includes('uses')) {
    out.push('', '## Creative uses', '', 'Lists with exactly 8 uses:', '',
      mdTable(['Condition', '8 uses'], a.conds.map(c => [c, frac(a.uses.formatOk[c])]), [1]));
    const r = a.uses.ranks;
    if (r) {
      out.push('', `Blind ranks from ${r.judges.join(' and ')} (${rankings(r.calls)}). Rank 1 is best, so a lower mean is better.`, '',
        mdTable(['Condition', 'Lists ranked', 'Mean rank', 'First places', ...r.judges.map(j => `Mean rank, ${j}`)],
          a.conds.filter(c => r.byCond[c].n).map(c => { const s = r.byCond[c]; return [c, s.n, num(s.mean, 2), s.firsts, ...r.judges.map(j => num(s.byJudge[j].mean, 2))]; }),
          Array.from({ length: 4 + r.judges.length }, (_, i) => i + 1)));
    } else out.push('', 'No judge file was given, so the lists are not ranked.');
  }

  out.push('', '## Read this carefully', '',
    '- Each cell is one model reply at its default temperature. Small totals mean wide intervals: look at the interval, not the point.',
    '- The pooled sign test treats each (model, question) pair as independent. The same question asked of several models is not, so it is a little too keen.',
    '- Many conditions are compared against the same baseline. With seven comparisons, one p under 0.05 can be luck; p under 0.007 is the safer bar.',
    '- Every condition ends with the same answer-format line, so a difference is a difference in thinking, not in what was asked for.');
  return out.join('\n') + '\n';
}

// ---- html ---------------------------------------------------------------------------------------

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A column header has to fit on a phone: "gemini-4-argon" instead of "opencode:opencode-go/gemini-4-argon".
const shortName = m => {
  const at = m.indexOf(':');
  const backend = at < 0 ? m : m.slice(0, at), rest = at < 0 ? '' : m.slice(at + 1);
  return backend === 'opencode' ? rest.split('/').pop() : rest || backend;
};
function shortNames(models) {
  const names = Object.fromEntries(models.map(m => [m, shortName(m)]));
  const seen = {};
  for (const n of Object.values(names)) seen[n] = (seen[n] ?? 0) + 1;
  return Object.fromEntries(models.map(m => [m, seen[names[m]] > 1 ? m : names[m]]));
}

const CSS = `
:root { --bg:#fbf7ee; --ink:#1d1c1a; --soft:#5d594f; --card:#fffdf8; --line:#e2dccb; --good:#dff0dc; --bad:#f7dcd6; --bar:#6f8f9a; --bar-bg:#ece6d6; --head:#f1ebdb; --ok:#5b9a62; --no:#c0594a; --flat:#a39c8a; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1b19; --ink:#efe9dc; --soft:#b3ac9c; --card:#252320; --line:#3b3832; --good:#26402a; --bad:#4a2923; --bar:#8db0bb; --bar-bg:#34312b; --head:#2c2a26; --ok:#7bc084; --no:#e07b6c; --flat:#7d7767; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:"Atkinson Hyperlegible","Lexend",Verdana,Tahoma,"Trebuchet MS",system-ui,sans-serif; font-size:1.25rem; line-height:1.75; letter-spacing:0.02em; word-spacing:0.1em; }
main { max-width:56rem; margin:0 auto; padding:2rem 16px 5rem; }
h1 { font-size:2.2rem; line-height:1.25; margin:0 0 .5rem; }
h2 { font-size:1.6rem; line-height:1.3; margin:0 0 .25rem; }
p { max-width:36rem; margin:.4rem 0; }
.lede { color:var(--soft); }
.block { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:1.4rem 1.4rem 1.6rem; margin:1.5rem 0; }
.say { font-weight:700; font-size:1.35rem; line-height:1.5; max-width:34rem; margin:.5rem 0 1rem; }
.verdict { border-left:.5rem solid var(--flat); padding-left:1rem; margin:1.1rem 0; }
.verdict .say { margin:0; }
.verdict p { margin:0; }
.verdict.good { border-color:var(--ok); } .verdict.bad { border-color:var(--no); }
.tablewrap { overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
th, td { padding:.45rem .8rem; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
th { white-space:normal; vertical-align:bottom; }
th:first-child, td:first-child { text-align:left; font-weight:700; }
thead th { background:var(--head); font-size:1rem; line-height:1.3; }
td.good { background:var(--good); } td.bad { background:var(--bad); }
.small { font-size:1rem; color:var(--soft); }
.bars { display:grid; gap:.7rem; }
.barrow { display:grid; grid-template-columns:8rem 1fr 9rem; align-items:center; gap:.8rem; }
.barrow .name { font-weight:700; }
.bar { height:1.5rem; background:var(--bar-bg); border-radius:7px; position:relative; }
.bar > span { display:block; height:100%; background:var(--bar); border-radius:7px; }
.bar > i { position:absolute; }
.bar > .tick { top:-3px; bottom:-3px; width:3px; margin-left:-1px; background:var(--ink); }
.bar > .ci { top:calc(50% - 1.5px); height:3px; background:var(--ink); opacity:.7; }
.bar > .ci::before, .bar > .ci::after { content:""; position:absolute; top:-5px; width:3px; height:13px; background:inherit; }
.bar > .ci::before { left:0; } .bar > .ci::after { right:0; }
.barrow .num { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
.barrow .num small { font-weight:400; color:var(--soft); font-size:1rem; margin-left:.4rem; }
@media (max-width:640px) { .barrow { grid-template-columns:1fr; gap:.15rem; } .barrow .num { text-align:left; } body { font-size:1.15rem; } .block { padding:1.1rem 1rem 1.3rem; } }
ul { padding-left:1.2rem; max-width:36rem; } li { margin:.5rem 0; }
`;

const sym = t => (verdict(t) === 'clearly better' ? '▲' : verdict(t) === 'clearly worse' ? '▼' : '●');
const tone = t => (verdict(t) === 'clearly better' ? 'good' : verdict(t) === 'clearly worse' ? 'bad' : 'flat');

function htmlTable(head, rows, cellClass = () => '') {
  const th = h => (Array.isArray(h) ? `<th title="${esc(h[1])}">${esc(h[0])}</th>` : `<th>${esc(h)}</th>`);
  return `<div class="tablewrap"><table><thead><tr>${head.map(th).join('')}</tr></thead><tbody>${rows
    .map((r, ri) => `<tr>${r.map((c, ci) => `<td class="${cellClass(ri, ci)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function renderHtml(a) {
  const names = shortNames(a.models);
  const scopeCols = a.models.length > 1 ? [...a.models, ALL] : [ALL];
  const colHead = s => (s === ALL ? (a.models.length > 1 ? 'All models' : names[a.models[0]] ?? 'All') : [names[s], s]);
  const head = first => [first, ...scopeCols.map(colHead)];
  const pooled = c => a.pooled[c][ALL];
  const ranked = a.conds.filter(c => pooled(c).n).sort((x, y) => pooled(y).p - pooled(x).p);
  const best = ranked[0];
  const base = a.conds.includes('base') && pooled('base').n ? pooled('base') : null;
  const sections = [];

  // The short answer: the verdict first, in words, with the counts under it.
  const lines = [];
  if (best) lines.push(`<div class="verdict flat"><p class="say">Best score: ${esc(best)}, ${pct(pooled(best).p)} right.</p>${base && best !== 'base' ? `<p class="small">base scored ${pct(base.p)}.</p>` : ''}</div>`);
  for (const [cond, ref] of [['dyslexic', 'base'], ['dyslexic', 'careful']]) {
    const t = a.tests[ref]?.[cond]?.[ALL];
    if (!t) continue;
    lines.push(`<div class="verdict ${tone(t)}"><p class="say">${sym(t)} ${esc(cond)} against ${esc(ref)}: ${esc(verdict(t))}.</p><p class="small">${t.n ? `${t.aOnly} question${t.aOnly === 1 ? '' : 's'} better, ${t.bOnly} worse (p = ${pText(t.p)}).` : 'No matching questions yet.'}</p></div>`);
  }
  if (!lines.length) lines.push('<p class="say">Not enough finished jobs yet to say anything.</p>');
  sections.push(`<section class="block"><h2>The short answer</h2>${lines.join('')}<p class="small">${a.counts.rows} jobs, ${a.counts.items} questions, ${a.models.length} model${a.models.length === 1 ? '' : 's'}, ${a.conds.length} ways of thinking. ${a.counts.errors ? `${a.counts.errors} jobs failed and are left out.` : 'No job failed.'}</p></section>`);

  // Bars: the fill is the score, the thin line is where the true score probably is, the dark tick is base.
  const bars = ranked.map(c => {
    const s = pooled(c);
    const tick = base && c !== 'base' ? `<i class="tick" style="left:${(100 * base.p).toFixed(1)}%"></i>` : '';
    const ci = `<i class="ci" style="left:${(100 * s.lo).toFixed(1)}%;width:${(100 * (s.hi - s.lo)).toFixed(1)}%"></i>`;
    return `<div class="barrow"><span class="name">${esc(c)}</span><div class="bar"><span style="width:${(100 * s.p).toFixed(1)}%"></span>${tick}${ci}</div><span class="num">${pct(s.p)}<small>${s.k}/${s.n}</small></span></div>`;
  }).join('');
  sections.push(`<section class="block"><h2>Score for each way of thinking</h2><p class="say">Longer bar = more answers right.</p><div class="bars">${bars}</div><p class="small">Dark tick: the base score. Thin line: where the true score probably is (95%). If a line is long, there are too few questions to be sure.</p></section>`);

  // Where it helps: one number per way of thinking and kind of question, tinted against base.
  const kinds = a.families.filter(f => f !== 'uses');
  if (kinds.length) {
    const cell = (c, f) => a.byFamily[f][c][ALL], ref = f => a.byFamily[f].base?.[ALL];
    const mark = (c, f) => {
      const x = cell(c, f), r = ref(f);
      return !r || c === 'base' || !x.n || !r.n || x.p === r.p ? '' : x.p > r.p ? 'good' : 'bad';
    };
    const text = (c, f) => `${mark(c, f) === 'good' ? '▲ ' : mark(c, f) === 'bad' ? '▼ ' : ''}${frac(cell(c, f))}`;
    sections.push(`<section class="block"><h2>Where it helps</h2><p class="say">Right out of total, for each kind of question. All models together.</p>${htmlTable(
      ['Way of thinking', ...kinds, 'All'],
      a.conds.map(c => [c, ...kinds.map(f => text(c, f)), frac(pooled(c))]),
      (ri, ci) => (ci >= 1 && ci <= kinds.length ? mark(a.conds[ri], kinds[ci - 1]) : ''),
    )}<p class="small">▲ green: more right than base. ▼ red: fewer right than base. The arrow is there even if you cannot see the colour.</p></section>`);
  }

  sections.push(`<section class="block"><h2>Each model</h2><p class="say">The same score, one column per model.</p>${htmlTable(head('Way of thinking'), a.conds.map(c => [c, ...scopeCols.map(s => full(a.pooled[c][s]))]))}</section>`);

  for (const ref of ['base', 'careful']) {
    if (!a.conds.includes(ref)) continue;
    const entries = Object.entries(a.tests[ref]);
    sections.push(`<section class="block"><h2>Better than ${esc(ref)}, or luck?</h2><p class="say">Same questions, two ways of thinking. Count the questions where only one got it right.</p>${htmlTable(
      ['Way of thinking', 'Better', 'Worse', 'p', 'Verdict'],
      entries.map(([c, t]) => [`${sym(t[ALL])} ${c}`, t[ALL].aOnly, t[ALL].bOnly, pText(t[ALL].p), verdict(t[ALL])]),
      (ri, ci) => (ci === 4 ? { good: 'good', bad: 'bad', flat: '' }[tone(entries[ri][1][ALL])] : ''),
    )}<p class="small">▲ clearly better, ▼ clearly worse, ● no clear difference or too few to tell. The words are printed too.</p></section>`);
  }

  const costRows = a.conds.map(c => { const k = a.cost[c]; return [c, num(k.calls), secs(k.ms), k.chars == null ? '-' : Math.round(k.chars), pct(k.formatOk)]; });
  const perModel = a.models.length > 1 ? `<p class="say">Time per job, by model. Compare down a column.</p>${htmlTable(['Way of thinking', ...a.models.map(m => [names[m], m])], a.conds.map(c => [c, ...a.models.map(m => secs(a.costBy[c][m].ms))]))}` : '';
  sections.push(`<section class="block"><h2>What it costs</h2><p class="say">More thinking can mean more calls, more time and longer answers.</p>${htmlTable(['Way of thinking', 'Calls', 'Time', 'Chars', 'In format'], costRows)}${perModel}</section>`);

  const r = a.uses.ranks;
  if (a.families.includes('uses')) {
    sections.push(`<section class="block"><h2>Creative lists</h2>${r ? `<p class="say">Judges ranked the lists without seeing the way of thinking. Rank 1 is best.</p>${htmlTable(
      ['Way of thinking', 'Lists', 'Mean rank', 'First places'],
      a.conds.filter(c => r.byCond[c].n).map(c => [c, r.byCond[c].n, num(r.byCond[c].mean, 2), r.byCond[c].firsts]),
    )}<p class="small">${esc(r.judges.join(' and '))}: ${rankings(r.calls)}.</p>` : '<p class="say">No judge file was given, so the lists are not ranked.</p>'}</section>`);
  }

  sections.push('<section class="block"><h2>Read this carefully</h2><ul><li>Each cell is one reply per question. Few questions means a wide interval.</li><li>The same question asked of several models is not independent, so the test is a little too keen.</li><li>Seven comparisons against one baseline: one p under 0.05 can be luck. Under 0.007 is safer.</li></ul></section>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dyslexic thinking benchmark</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Does thinking like a dyslexic reader help?</h1>
<p class="lede">The same questions, asked in different ways of thinking.</p>
${sections.join('\n')}
</main>
</body>
</html>
`;
}

function main() {
  const { values: v } = parseArgs({
    options: { in: { type: 'string' }, judge: { type: 'string' }, md: { type: 'string' }, html: { type: 'string' } },
  });
  if (!v.in) { console.error('usage: node bench/report.mjs --in results.jsonl [--judge results.judge.jsonl] [--md bench/RESULTS.md] [--html page.html]'); process.exit(2); }
  const rows = readRows(v.in);
  if (!rows.length) { console.error(`no rows in ${v.in}`); process.exit(1); }
  const a = analyze(rows, v.judge ? readRows(v.judge, judgeKey) : []);
  const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); console.error(`wrote ${path}`); };
  const md = v.md ?? 'bench/RESULTS.md';
  write(md, renderMarkdown(a));
  if (v.html) write(v.html, renderHtml(a));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
