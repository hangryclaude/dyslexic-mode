#!/usr/bin/env node
// Six real calls to see what the reply layout does to a model: four prompts with thinking off,
// the exam prompt again with the "strong" style, and once more with private thinking switched off.
// Each reply is run through the linter. A reply with a hard hit also gets the one rewrite the app
// would send, so the report shows whether the rewrite fixes it. The replies go to
// bench/results/replies-pilot.json and the report to bench/results/replies-pilot.md.
// Costs six small haiku calls on the logged-in `claude` CLI, no API key. It does nothing without
// a flag, so a test run or a stray import never spends them:
//   node bench/replies-pilot.mjs --run
// `--relint` makes no calls. It lints the saved replies again, so a linter change can be checked
// against the same six replies.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { systemPrompt, rewritePrompt } from '../lib/prompt.mjs';
import { analyze, wantsPlan } from '../skill/scripts/reread.mjs';

const DIR = fileURLToPath(new URL('./results/', import.meta.url));
const MD = `${DIR}replies-pilot.md`;
const SAVED = `${DIR}replies-pilot.json`;
const EXAM = 'I have a history exam on Friday on the Cold War';
const RUNS = [
  { prompt: 'explain photosynthesis', thinking: 'off' },
  { prompt: EXAM, thinking: 'off' },
  { prompt: 'how do I set up a budget', thinking: 'off' },
  { prompt: 'what is the difference between RAM and storage', thinking: 'off' },
  { prompt: EXAM, thinking: 'strong' },
  // Haiku thinks privately by default, which hides what a style does. With that off, the style has
  // to show on the page, as the fenced `thinking` block the prompt asks for.
  { prompt: EXAM, thinking: 'strong', env: { CLAUDE_CODE_DISABLE_THINKING: '1' }, note: 'private thinking off' },
];

function ask({ prompt, thinking, env = {} }) {
  const args = ['-p', '--model', 'haiku', '--tools', '', '--setting-sources', '', '--system-prompt', systemPrompt({ thinking }),
    '--output-format', 'json', '--no-session-persistence'];
  const t0 = Date.now();
  // The prompt goes on stdin, as in lib/claude.mjs. CODEX_BRIDGE keeps the user's Stop hook out.
  const r = spawnSync(process.env.DYSLEXIC_CLAUDE_BIN || 'claude', args, {
    input: prompt, encoding: 'utf8', cwd: tmpdir(), timeout: 150_000, maxBuffer: 20e6, env: { ...process.env, CODEX_BRIDGE: '1', ...env },
  });
  const ms = Date.now() - t0;
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${(r.stderr || r.error?.message || '').slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  if (j.is_error) throw new Error(`claude returned an error: ${String(j.result).slice(0, 300)}`);
  return {
    text: j.result.trim(), ms, cost: j.total_cost_usd,
    model: Object.keys(j.modelUsage ?? {}).join(', '), tokensOut: j.usage?.output_tokens,
  };
}

// A fence longer than any backtick run inside, so a reply with its own code blocks nests cleanly.
const fenced = text => {
  const fence = '`'.repeat(Math.max(4, ...(text.match(/`+/g) ?? []).map(s => s.length + 1)));
  return `${fence}markdown\n${text}\n${fence}`;
};
// filter.mjs leaves long-line to the renderer, which wraps at 80, so the app never rewrites for it.
const SCREEN_HANDLED = new Set(['long-line']);
const hard = r => r.findings.filter(f => f.severity === 'hard' && !SCREEN_HANDLED.has(f.rule));
const wrapped = r => r.findings.filter(f => f.severity === 'hard' && SCREEN_HANDLED.has(f.rule));
const line = f => `- ${f.line}:${f.col} ${f.rule}: ${f.message}`;
const words = text => text.split(/\s+/).filter(Boolean).length;
const secs = ms => (ms / 1000).toFixed(1);

const relint = process.argv.includes('--relint');
if (!relint && !process.argv.includes('--run')) {
  console.log('Six real haiku calls. Pass --run to make them, or --relint to lint the saved replies again.');
  process.exit(0);
}
const calls = [];
if (relint) calls.push(...JSON.parse(readFileSync(SAVED, 'utf8')));
else {
  for (const run of RUNS) {
    process.stdout.write(`${run.thinking.padEnd(6)} ${run.prompt}${run.note ? ` (${run.note})` : ''} ... `);
    const got = ask(run);
    const hits = hard(analyze(got.text));
    // The app's one rewrite, as lib/filter.mjs sends it.
    const rewrite = hits.length ? { hits: hits.map(f => `${f.rule}: ${f.message}`), ...ask({ ...run, prompt: rewritePrompt(got.text, hits) }) } : undefined;
    calls.push({ ...run, ...got, rewrite });
    process.stdout.write(`${secs(got.ms)}s${rewrite ? `, rewritten in ${secs(rewrite.ms)}s` : ''}\n`);
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(SAVED, JSON.stringify(calls, null, 2) + '\n');
}

const results = calls.map(c => {
  const plan = wantsPlan(c.prompt);
  // "app" is what filter.mjs checks today. "planned" adds the study-plan checks the message calls for.
  const app = analyze(c.text);
  return { ...c, plan, app, planned: plan ? analyze(c.text, { plan: true }) : app };
});

const md = [
  '# Replies pilot',
  '',
  `${results.length + results.filter(r => r.rewrite).length} real calls to \`claude -p --model haiku\` (${[...new Set(results.map(r => r.model))].join(', ')}), tools off, user settings off.`,
  'The system prompt is `systemPrompt({ thinking })` with the skill in `skill/SKILL.md`.',
  'Each reply is linted by `skill/scripts/reread.mjs`.',
  '',
  '- "Hard (app)" is what `lib/filter.mjs` counts: hard hits except `long-line`, which the renderer wraps.',
  '- "Hard (plan)" adds the study-plan checks when `wantsPlan(prompt)` is true.',
  '- "Out tokens" counts private thinking too, so it is far above the words shown when the model thinks first.',
  '',
  '| # | Prompt | Thinking | Words | Seconds | Out tokens | Hard (app) | Hard (plan) | Soft | Long lines ignored |',
  '|---|--------|----------|------:|--------:|-----------:|-----------:|------------:|-----:|-------------------:|',
  ...results.map((r, i) => `| ${i + 1} | ${r.prompt} | ${r.thinking}${r.note ? ` (${r.note})` : ''} | ${words(r.text)} | ${secs(r.ms)} | ${r.tokensOut} | ${hard(r.app).length} | ${r.plan ? hard(r.planned).length : 'n/a'} | ${r.planned.summary.soft} | ${wrapped(r.planned).length} |`),
  '',
  ...results.flatMap((r, i) => [
    `## ${i + 1}. ${r.prompt} (thinking: ${r.thinking}${r.note ? `, ${r.note}` : ''})`,
    '',
    `${secs(r.ms)} s, ${r.tokensOut} tokens out, $${r.cost?.toFixed(4)}. Study-plan prompt: ${r.plan ? 'yes' : 'no'}.`,
    '',
    hard(r.planned).length ? `Hard hits:\n\n${hard(r.planned).map(line).join('\n')}` : 'No hard hits.',
    '',
    r.planned.summary.soft ? `Soft hits:\n\n${r.planned.findings.filter(f => f.severity === 'soft').map(line).join('\n')}` : 'No soft hits.',
    '',
    'Reply:',
    '',
    fenced(r.text),
    '',
    ...(r.rewrite ? [
      `Rewrite, as the app sends it after these hard hits:\n\n${r.rewrite.hits.map(h => `- ${h}`).join('\n')}`,
      '',
      `${secs(r.rewrite.ms)} s. Hard hits left: ${hard(analyze(r.rewrite.text)).length}.`,
      '',
      fenced(r.rewrite.text),
      '',
    ] : []),
  ]),
].join('\n');

mkdirSync(DIR, { recursive: true });
writeFileSync(MD, md);
for (const r of results) console.log(`${String(hard(r.planned).length).padStart(2)} hard  ${r.thinking.padEnd(6)} ${r.prompt}`);
console.log(`wrote ${MD}`);
