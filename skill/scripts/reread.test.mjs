import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, syllables, timeBox, wantsPlan, T } from './reread.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'reread.mjs');
const words = (n, w = 'word') => Array(n).fill(w).join(' ');
// n words wrapped at 8 per line, so the long-line rule stays out of the way.
const wrapped = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 8) out.push(words(Math.min(8, n - i)));
  return out.join('\n');
};
const flat = (n) => wrapped(n).replace(/\n/g, ' ');
const FENCE = '```';
const rules = (t) => analyze(t).findings.map((f) => f.rule);
const find = (t, rule) => analyze(t).findings.find((f) => f.rule === rule);

test('clean short text has no findings', () => {
  const r = analyze('The build passed. Ship it.\n');
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.hard, 0);
  // A page keeps its title. Only a reply must open with the answer.
  assert.deepEqual(analyze('# Title\n\nThe build passed. Ship it.\n', { reply: false }).findings, []);
});

test('sentence of 18 words is soft, 30 is hard', () => {
  const soft = find(`${wrapped(18)}.`, 'long-sentence');
  assert.equal(soft.severity, 'soft');
  const hard = find(`${wrapped(30)}.`, 'long-sentence');
  assert.equal(hard.severity, 'hard');
  assert.equal(hard.line, 1);
  assert.equal(hard.col, 1);
});

test('15-word sentence is fine', () => {
  assert.ok(!rules(`${wrapped(15)}.`).includes('long-sentence'));
});

test('skips fenced code, inline code, urls and paths', () => {
  const t = [
    'Short line.',
    FENCE + 'js',
    `const x = "${words(40)}";`,
    FENCE,
    'Run `utilise the internationalization thing` now.',
    '',
    'See https://example.com/utilise/facilitate/long for more.',
    '',
    'Open ~/dev/utilise/facilitate/internationalization.md next.',
  ].join('\n');
  assert.deepEqual(analyze(t).findings, []);
});

test('swap table flags rare word with plain suggestion', () => {
  const f = find('We utilise the cache.', 'rare-word');
  assert.ok(f);
  assert.equal(f.line, 1);
  assert.equal(f.col, 4);
  assert.match(f.suggestion, /use/);
});

test('very long word is flagged', () => {
  const f = find('This needs internationalization today.', 'long-word');
  assert.ok(f);
  assert.equal(f.col, 12);
});

test('short common words are not flagged as long', () => {
  assert.ok(!rules('The cat sat on the warm mat.').includes('long-word'));
});

test('double negatives are hard', () => {
  const f = find('It is not uncommon to fail.', 'double-negative');
  assert.ok(f);
  assert.equal(f.severity, 'hard');
  assert.ok(find("You can't not see it.", 'double-negative'));
  assert.ok(!rules('It is not ready.').includes('double-negative'));
});

test('acronym needs expansion at first use', () => {
  assert.ok(find('The SSR step is slow.', 'acronym'));
  assert.ok(!rules('Server-side rendering (SSR) is slow. Then SSR runs.').includes('acronym'));
  assert.ok(!rules('SSR (server-side rendering) is slow.').includes('acronym'));
  assert.ok(!rules('Call the API from the CLI.').includes('acronym'));
});

test('acronym flags only the first use', () => {
  const n = analyze('The SSR step is slow. The SSR step is slow.').findings.filter((f) => f.rule === 'acronym').length;
  assert.equal(n, 1);
});

test('number buried in a long sentence', () => {
  const t = `${wrapped(12)} and the total of 4821 items came to a stop here.`;
  assert.ok(find(t, 'buried-number'));
  assert.ok(!rules('We shipped 4821 items.').includes('buried-number'));
});

test('long paragraph is hard', () => {
  const para = Array(8).fill('This is a short plain sentence here.').join(' ');
  const f = find(para, 'long-paragraph');
  assert.ok(f);
  assert.equal(f.severity, 'hard');
});

test('wall of text with no list, table or heading', () => {
  const para = Array(5).fill('A short plain line of text here.').join('\n');
  const t = [para, para, para].join('\n\n');
  assert.ok(find(t, 'wall-of-text'));
  assert.ok(!rules('# Head\n\n' + para + '\n\n- a\n\n' + para + '\n').includes('wall-of-text'));
  // Twelve lines is the limit: a short reply needs no heading.
  assert.ok(!rules([para, para, 'A short plain line of text here.\nAnother short plain line.'].join('\n\n')).includes('wall-of-text'));
});

test('CLI: text output, summary, exit 1 on hard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rr-'));
  const f = join(dir, 'a.md');
  writeFileSync(f, `Short start.\n\n${wrapped(30)}.\n`);
  const r = spawnSync('node', [CLI, f], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^3:1 long-sentence .+ → .+/m);
  assert.match(r.stdout, /1 hard/);
});

test('CLI: exit 0 with only soft findings', () => {
  const r = spawnSync('node', [CLI], { input: `${wrapped(18)}.\n`, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /long-sentence/);
});

test('CLI: --json from stdin', () => {
  const r = spawnSync('node', [CLI, '--json'], { input: `Short start.\n\n${wrapped(30)}.\n`, encoding: 'utf8' });
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.summary.hard, 1);
  assert.equal(j.findings.find((f) => f.severity === 'hard').rule, 'long-sentence');
});

test('CLI: clean input exits 0', () => {
  const r = spawnSync('node', [CLI], { input: 'All good.\n', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 issues/);
});

test('CLI: missing file exits 2', () => {
  const r = spawnSync('node', [CLI, '/nonexistent/x.md'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('list length: 7 ok, 8 soft, 11 hard, a blank line ends the list', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => `- item ${i + 1}`).join('\n');
  assert.ok(!rules(list(7)).includes('long-list'));
  assert.equal(find(list(8), 'long-list').severity, 'soft');
  assert.equal(find(list(12), 'long-list').severity, 'hard');
  assert.ok(!rules(`${list(6)}\n\n${list(6)}`).includes('long-list'));
});

test('tables: wide header is flagged, cell text is linted, pipe prose is not skipped', () => {
  const tbl = (cols) => `|${' a |'.repeat(cols)}\n|${'---|'.repeat(cols)}\n|${' 1 |'.repeat(cols)}\n`;
  assert.ok(!rules(tbl(3)).includes('wide-table'));
  assert.equal(find(tbl(4), 'wide-table').severity, 'soft');
  assert.equal(find(tbl(5), 'wide-table').severity, 'hard');
  assert.ok(find(`| Name | Note |\n|---|---|\n| x | ${flat(30)} |\n`, 'long-sentence'));
  assert.ok(find(`| ${flat(30)}\n`, 'long-sentence'));
});

test('indented code blocks are not linted as prose', () => {
  assert.deepEqual(analyze('Intro line.\n\n    const internationalization = 1;\n    const x = 2;\n').findings, []);
  // An indented line inside a list item is a continuation, not code.
  assert.ok(find('- first item\n\n    We utilise the cache.\n', 'rare-word'));
});

test('YAML front matter is skipped', () => {
  const fm = `---\nname: x\ndescription: ${words(40)}\n---\n\nShort line.\n`;
  assert.deepEqual(analyze(fm).findings, []);
});

test('long words: 9 letters or 3 syllables count, more than 2 per sentence flags', () => {
  assert.equal(syllables('category'), 4);
  assert.ok(!rules('The beautiful paragraph is here.').includes('long-words'));
  assert.equal(find('A beautiful scheduled paragraph something.', 'long-words').severity, 'hard');
  assert.equal(find('A beautiful paragraph something is here.', 'long-words').severity, 'soft');
  assert.ok(!rules('Check the fetchUser handler.').includes('long-words'));
});

test('paragraph: 5 one-sentence lines and 5 sentences are both hard, 4 lines is soft', () => {
  assert.equal(find(Array(5).fill('Hi.').join('\n'), 'long-paragraph').severity, 'hard');
  assert.equal(find(Array(5).fill('Hi.').join(' '), 'long-paragraph').severity, 'hard');
  const line = 'This line is plain and short.';
  assert.equal(find(Array(5).fill(line).join('\n'), 'long-paragraph').severity, 'hard');
  // One sentence over four lines: soft on lines alone.
  assert.equal(find(`${Array(4).fill('one two three four five').join('\n')}.`, 'long-paragraph').severity, 'soft');
});

test('paragraph sentences: 2 are fine, 3 are soft, 4 are hard', () => {
  const para = (n) => Array(n).fill('This line is plain and short.').join(' ');
  assert.ok(!rules(para(2)).includes('long-paragraph'));
  assert.equal(find(para(3), 'long-paragraph').severity, 'soft');
  assert.equal(find(para(4), 'long-paragraph').severity, 'hard');
});

test('wall of text: a code block breaks the run', () => {
  const six = Array(6).fill('A short plain line of text here.').join('\n');
  assert.ok(!rules(`${six}\n\n${FENCE}\ncode\n${FENCE}\n\n${six}\n`).includes('wall-of-text'));
});

test('acronyms: shouting words, ", or X," and heading expansions are fine', () => {
  assert.ok(!rules('STOP NOW.').includes('acronym'));
  assert.ok(!rules('We use server-side rendering, or SSR, here.').includes('acronym'));
  assert.ok(!rules('# Server-side rendering (SSR)\n\nThe SSR step is slow.\n').includes('acronym'));
  assert.ok(find('The ORM step is slow.', 'acronym'));
});

test('double negatives: only close pairs, "unless ... not", and quotes are ignored', () => {
  assert.ok(!rules("Please don't say no to the cache.").includes('double-negative'));
  assert.ok(!rules('Nothing is impossible here.').includes('double-negative'));
  assert.ok(!rules('No italics, no underline, no all caps.').includes('double-negative'));
  assert.ok(!rules('Say "do not remove X" when it helps.').includes('double-negative'));
  assert.ok(find('It is not an unlikely result.', 'double-negative'));
  assert.equal(find('Do not remove the loop unless the timeout is not set.', 'double-negative').severity, 'hard');
});

test('a path ending a sentence keeps its full stop', () => {
  assert.ok(!rules(`See ~/dev/app/session.ts. ${wrapped(15)}.`).includes('long-sentence'));
});

test('buried number: labels, ports, names and edge positions are skipped', () => {
  const pad = words(14);
  assert.ok(!rules(`Please check the item 4 in the logs ${pad} extra words.`).includes('buried-number'));
  assert.ok(!rules(`The host is ${pad} postgresql@16 on localhost:5432 for now ok yes.`).includes('buried-number'));
  assert.ok(!rules(`4821 ${pad} and some more words here today ok then.`).includes('buried-number'));
  assert.ok(find(`The team shipped ${pad} 4821 items to the shared build today ok yes.`, 'buried-number'));
});

test('long lines: 71 soft, 81 hard, not in code or tables', () => {
  assert.equal(find(`${'a '.repeat(35)}b`, 'long-line').severity, 'soft');
  assert.equal(find(`${'a '.repeat(40)}b`, 'long-line').severity, 'hard');
  assert.ok(!rules(`${FENCE}\n${'a '.repeat(50)}\n${FENCE}\n`).includes('long-line'));
  assert.ok(!rules(`| a | b |\n|---|---|\n| ${'x '.repeat(50)} | y |\n`).includes('long-line'));
});

test('look-alike pair in one sentence, and jargon on first use only', () => {
  assert.ok(find('I saw what was there.', 'look-alike'));
  assert.ok(!rules('I saw it. It was there.').includes('look-alike'));
  const n = analyze('The handler is idempotent. The handler is idempotent.').findings.filter((f) => f.rule === 'jargon').length;
  assert.equal(n, 1);
});

// Reply shape: the answer in line 1, short bullets, few questions, a little bold.
test('first line: a heading, list or table is hard, code is soft, a short sentence passes', () => {
  assert.ok(!rules('RAM is short-term memory.\n\n- one\n').includes('first-line'));
  assert.equal(find('# Title\n\nShort line.\n', 'first-line').severity, 'hard');
  assert.equal(find('- first\n- second\n', 'first-line').severity, 'hard');
  assert.equal(find('| a | b |\n|---|---|\n| 1 | 2 |\n', 'first-line').severity, 'hard');
  assert.equal(find(`${FENCE}sh\nls\n${FENCE}\n\nThen read it.\n`, 'first-line').severity, 'soft');
  assert.ok(!analyze('# Title\n\nShort line.\n', { reply: false }).findings.some((f) => f.rule === 'first-line'));
});

test('first line length: 12 words pass, 13 are soft, 21 are hard, a wrapped sentence counts whole', () => {
  assert.ok(!rules(`${words(12)}.`).includes('first-line'));
  assert.equal(find(`${words(13)}.`, 'first-line').severity, 'soft');
  assert.equal(find(`${words(21)}.`, 'first-line').severity, 'hard');
  assert.equal(find(`${words(11)}\n${words(11)}.`, 'first-line').severity, 'hard');
  // Two short sentences on one line are still a short line.
  assert.ok(!rules('Staging works. Production is not proven yet.').includes('first-line'));
});

test('first line filler is soft', () => {
  assert.equal(find('Sure! The build passed.', 'first-line').severity, 'soft');
  assert.match(find('Great question! It passed.', 'first-line').message, /filler/);
  assert.ok(!rules('The build passed. Sure of it.').includes('first-line'));
});

test('a leading thinking block and front matter are not the reply', () => {
  const think = `${FENCE}thinking\nBIG PICTURE: ${words(40)}\n${FENCE}\n\n`;
  assert.deepEqual(analyze(`${think}The build passed.\n`).findings, []);
  assert.equal(find(`${think}# Title\n\nShort.\n`, 'first-line').severity, 'hard');
  assert.deepEqual(analyze('---\nname: x\n---\n\nShort line.\n').findings, []);
  // A block that never closes swallows the rest, so nothing is left to judge.
  assert.deepEqual(analyze(`${FENCE}thinking\n${words(40)}\n`).findings, []);
});

test('bullet length: 12 words pass, 13 are soft, 26 are hard, and each bullet counts alone', () => {
  const t = (n) => `Intro.\n\n- ${words(n)}\n`;
  assert.ok(!rules(t(12)).includes('long-bullet'));
  assert.equal(find(t(13), 'long-bullet').severity, 'soft');
  assert.equal(find(t(26), 'long-bullet').severity, 'hard');
  // A wrapped bullet is still one bullet.
  assert.equal(find(`Intro.\n\n- ${words(8)}\n  ${words(8)}\n`, 'long-bullet').severity, 'soft');
  assert.ok(!rules(`Intro.\n\n- ${words(8)}\n  - ${words(8)}\n`).includes('long-bullet'));
  // A task box is not a word. Documents get the same bullet limit.
  assert.ok(!rules(`Intro.\n\n- [ ] ${words(12)}\n- [x] ${words(12)}\n`).includes('long-bullet'));
  assert.ok(analyze(t(13), { reply: false }).findings.some((f) => f.rule === 'long-bullet'));
});

test('a heading in a short reply is soft, in a long reply it is fine', () => {
  assert.equal(find('Short answer.\n\n## Why\n\nBecause.\n', 'early-heading').severity, 'soft');
  const body = Array.from({ length: 14 }, (_, i) => `- item ${i + 1}`).join('\n');
  assert.ok(!rules(`Short answer.\n\n## Why\n\n${body}\n`).includes('early-heading'));
  assert.ok(!rules('Short answer.\n\nNo heading here.\n').includes('early-heading'));
});

test('more than one question in prose is soft, and questions in a list are content', () => {
  assert.ok(!rules('Want the steps?').includes('many-questions'));
  assert.equal(find('Want the steps? Or the short version?', 'many-questions').severity, 'soft');
  assert.ok(!rules('Quiz yourself:\n\n- Who built it?\n- Why did it fall?\n').includes('many-questions'));
  assert.ok(!rules('Is it ready? Yes.\n').includes('many-questions'));
});

test('bold: short bullet labels are free, other bold is capped', () => {
  const lead = 'Answer.\n\n';
  assert.ok(!rules(`${lead}- **Heat:** hot.\n- **Dust:** dusty.\n- **Soft surfaces:** trapped.\n`).includes('too-much-bold'));
  assert.ok(!rules(`${lead}Take a **key phrase** here.\n`).includes('too-much-bold'));
  assert.equal(find(`${lead}A **one** and a **two**.\n`, 'too-much-bold').severity, 'soft');
  assert.equal(find(`${lead}A **one** **two** **three** **four**.\n`, 'too-much-bold').severity, 'hard');
  // A label of more than 3 words is ordinary bold. Bold inside code is not bold.
  assert.equal(find(`${lead}- **one two three four:** x.\n- **five six seven eight:** y.\n`, 'too-much-bold').severity, 'soft');
  assert.ok(!rules(`${lead}Use \`**x**\` and \`**y**\` here.\n`).includes('too-much-bold'));
  // Bold header and row names in a table are structure, not emphasis.
  assert.ok(!rules(`${lead}| | **A** | **B** |\n|---|---|---|\n| **Speed** | fast | slow |\n| **Size** | big | small |\n`).includes('too-much-bold'));
  assert.ok(!analyze(`${lead}A **one** and a **two**.\n`, { reply: false }).findings.some((f) => f.rule === 'too-much-bold'));
});

test('a label that starts several bullets wants a table: twice is soft, three times or a grid is hard', () => {
  const list = (names) => `Answer.\n\n${names.map((n) => `- **${n}:** ok.`).join('\n')}\n`;
  assert.ok(!rules(list(['Heat', 'Dust', 'Soft'])).includes('repeated-label'));
  const twice = find(list(['RAM', 'Storage', 'RAM']), 'repeated-label');
  assert.equal(twice.severity, 'soft');
  assert.match(twice.message, /"ram" starts 2 bullets$/);
  assert.equal(find(list(['RAM', 'RAM', 'RAM']), 'repeated-label').severity, 'hard');
  // Two labels that each repeat are rows and columns written as a list.
  const grid = analyze(list(['RAM', 'RAM', 'Storage', 'Storage'])).findings.filter((f) => f.rule === 'repeated-label');
  assert.deepEqual(grid.map((f) => f.severity), ['hard', 'hard']);
  assert.match(grid[0].message, /like a grid/);
  // The colon and the case do not make a new label. Documents are left alone.
  assert.equal(find('Answer.\n\n- **RAM:** a.\n- **Ram** b.\n', 'repeated-label').severity, 'soft');
  assert.ok(!analyze(list(['RAM', 'RAM', 'RAM']), { reply: false }).findings.some((f) => f.rule === 'repeated-label'));
});

// Study plans.
const PLAN = [
  'Goal: pass the quiz by Friday.',
  '',
  '1. Open the notes (1 min)',
  '2. Read one page (20 min)',
  '3. Break (5 min)',
  '4. Write a summary (25 min)',
  '5. Quiz yourself (20 min)',
  '6. Break (5 min)',
  '',
  'Checklist:',
  '',
  '- [ ] Notes open',
  '- [ ] Page read',
  '- [ ] Summary written',
  '- [ ] Quiz done',
  '',
  'Next: do step 1.',
].join('\n');
const planFrom = (steps, tail = '- [ ] done\n') => `Goal: pass.\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n${tail}`;

test('a good study plan has no findings, auto or forced', () => {
  assert.deepEqual(analyze(PLAN).findings, []);
  assert.deepEqual(analyze(PLAN, { plan: true }).findings, []);
});

test('plan: forced mode needs numbered steps, auto mode leaves other replies alone', () => {
  const prose = 'Study the chapter twice. Then sleep well.';
  assert.ok(!rules(prose).includes('plan-missing'));
  assert.equal(analyze(prose, { plan: true }).findings.find((f) => f.rule === 'plan-missing').severity, 'hard');
  assert.deepEqual(analyze(prose, { plan: false }).findings, []);
  assert.deepEqual(analyze('', { plan: true }).findings, []);
  // A recipe has timed steps but no goal line or task boxes, so it is not a plan.
  const recipe = 'Bake the bread.\n\n1. Mix the dough (10 min)\n2. Let it rise (60 min)\n3. Bake it (45 min)\n';
  assert.ok(!rules(recipe).some((r) => r.startsWith('plan-')));
});

test('plan: a step is capped at 25 minutes, and a missing time box is soft', () => {
  const tooLong = find(planFrom(['Start (1 min)', 'Read all notes (30 min)', 'Break (5 min)']), 'plan-time-box');
  assert.equal(tooLong.severity, 'hard');
  assert.match(tooLong.message, /30 minutes/);
  assert.equal(find(planFrom(['Start (1 min)', 'Read (25 min)', 'Break (5 min)']), 'plan-time-box'), undefined);
  const bare = find(planFrom(['Start (1 min)', 'Read the notes', 'Break (5 min)', 'Write (20 min)']), 'plan-time-box');
  assert.equal(bare.severity, 'soft');
  assert.match(bare.message, /1 of 3 steps/);
});

test('plan: the first step is tiny', () => {
  const first = (s) => find(planFrom([s, 'Read (20 min)', 'Break (5 min)']), 'plan-first-step');
  assert.equal(first('Open the notes (1 min)'), undefined);
  assert.equal(first('Open the notes (2 min)'), undefined);
  assert.equal(first('Open the notes (3 min)').severity, 'soft');
  assert.equal(first('Gather everything (10 min)').severity, 'hard');
});

test('plan: a break after every 2 steps, soft at the third in a row and hard at the fifth', () => {
  const breaks = (kinds) => analyze(planFrom(kinds.map((k, i) => (k === 'b' ? 'Break (5 min)' : `Step ${i + 1} (10 min)`))))
    .findings.filter((f) => f.rule === 'plan-break').map((f) => f.severity);
  assert.deepEqual(breaks(['w', 'w', 'b', 'w', 'w', 'b']), []);
  assert.deepEqual(breaks(['w', 'w', 'w', 'b']), ['soft']);
  assert.deepEqual(breaks(['w', 'w', 'w', 'w', 'w']), ['soft', 'hard']);
  // A loose line that mentions a break counts too.
  const loose = 'Goal: pass.\n\n1. Open (1 min)\n2. Read (20 min)\nBreak for 5 minutes.\n3. Write (20 min)\n\n- [ ] done\n';
  assert.deepEqual(analyze(loose).findings.filter((f) => f.rule === 'plan-break'), []);
});

test('plan: a goal line and a checklist are expected, and a question before the plan is soft', () => {
  assert.equal(find(planFrom(['Open (1 min)', 'Read (20 min)', 'Break (5 min)'], ''), 'plan-checklist').severity, 'soft');
  const noGoal = 'Here is a plan.\n\n1. Open (1 min)\n2. Read (20 min)\n3. Break (5 min)\n\n- [ ] done\n';
  assert.equal(find(noGoal, 'plan-goal').severity, 'soft');
  const asks = 'Goal: pass.\n\nWhen is the quiz?\n\n1. Open (1 min)\n2. Read (20 min)\n3. Break (5 min)\n\n- [ ] done\n';
  assert.equal(find(asks, 'plan-asks-first').severity, 'soft');
  assert.ok(!rules(PLAN.replace('Next: do step 1.', 'Ready to start?')).includes('plan-asks-first'));
});

test('wantsPlan: study words make a plan, code words need a deadline', () => {
  for (const yes of ['I have a history exam on Friday on the Cold War', 'help me study for bio', 'I am studying tonight',
    'my homework is due tomorrow', 'I need to write an essay', 'revision plan please', 'my project is due Friday',
    'the report is due in 3 days', 'quiz on Monday', 'I have a deadline']) assert.ok(wantsPlan(yes), yes);
  for (const no of ['explain photosynthesis', 'how do I set up a budget', 'what is the difference between RAM and storage',
    'run the test suite for this project', 'what does this study show', 'why is my project slow', 'fix the failing test']) assert.ok(!wantsPlan(no), no);
});

test('timeBox reads minutes, hours and ranges', () => {
  assert.equal(timeBox('Read chapter 3 (20 min)'), 20);
  assert.equal(timeBox('Read 5min'), 5);
  assert.equal(timeBox('Work 1 hour'), 60);
  assert.equal(timeBox('Work 1.5 hours'), 90);
  assert.equal(timeBox('Read 10-15 minutes'), 15);
  assert.equal(timeBox('Read 10 to 15 minutes'), 15);
  assert.equal(timeBox('Read the chapter'), null);
  assert.equal(timeBox('Wait 10 seconds'), null);
});

test('CLI: --plan forces the plan checks and --doc skips the reply rules', () => {
  const run = (args, input) => spawnSync('node', [CLI, ...args], { input, encoding: 'utf8' });
  const prose = 'Study the chapter twice.\n';
  assert.equal(run([], prose).status, 0);
  const forced = run(['--plan'], prose);
  assert.equal(forced.status, 1);
  assert.match(forced.stdout, /plan-missing \(hard\)/);
  const page = '# Title\n\nShort line.\n';
  assert.equal(run([], page).status, 1);
  assert.equal(run(['--doc'], page).status, 0);
});

// Skill-level checks: the docs, the thresholds file and the evals agree.
const skillDir = join(here, '..');
const evalDir = join(skillDir, 'references', 'evals');

test('SKILL.md limits table matches thresholds.json', () => {
  const md = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const want = {
    'Sentence words': [T.sentence_words.soft, T.sentence_words.hard],
    'First line words': [T.first_line_words.soft, T.first_line_words.hard],
    'Bullet words': [T.bullet_words.soft, T.bullet_words.hard],
    'Paragraph sentences': [T.paragraph_sentences.soft, T.paragraph_sentences.hard],
    'Paragraph lines': [T.paragraph_lines.soft, T.paragraph_lines.hard],
    'Line characters': [T.line_chars.soft, T.line_chars.hard],
    'Long words per sentence': [T.long_word.words_per_sentence_soft, T.long_word.words_per_sentence_hard],
    'List items': [T.list_items.soft, T.list_items.hard],
    'Bold per reply': [T.bold_per_reply.soft, T.bold_per_reply.hard],
    'Uses of one bullet label': [T.repeated_label.soft, T.repeated_label.hard],
    'Table columns': [T.table_columns.soft, T.table_columns.hard],
    'First step minutes': [T.first_step_minutes.soft, T.first_step_minutes.hard],
    'Step minutes': [T.step_minutes.soft, T.step_minutes.hard],
    'Steps before a break': [T.steps_per_break.soft, T.steps_per_break.hard],
  };
  const rows = Object.fromEntries(md.split('\n').filter((l) => /^\|.*\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([k, a, b]) => [k, [Number(a), Number(b)]]));
  for (const [k, v] of Object.entries(want)) assert.deepEqual(rows[k], v, k);
  assert.match(md, new RegExp(`${T.long_word.letters_soft} or more letters, or ${T.long_word.syllables_soft} or more syllables`));
});

test('SKILL.md study plan text matches the plan numbers', () => {
  const md = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(md, new RegExp(`first step takes under ${T.first_step_minutes.soft} minutes`));
  assert.match(md, new RegExp(`time box of ${T.step_minutes.hard} minutes or less`));
  assert.match(md, new RegExp(`break step after every ${T.steps_per_break.soft} steps`));
});

test('evals: every bad file has a hard hit, every fixed file has zero issues', () => {
  const files = readdirSync(evalDir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 22);
  for (const f of files) {
    const r = analyze(readFileSync(join(evalDir, f), 'utf8'));
    if (f.endsWith('-bad.md')) assert.ok(r.summary.hard > 0, `${f} should flag`);
    else assert.deepEqual(r.findings, [], `${f} should be clean`);
  }
});

test('nested negation eval is caught', () => {
  const r = analyze(readFileSync(join(evalDir, '06-bad.md'), 'utf8'));
  assert.ok(r.findings.some((f) => f.rule === 'double-negative'));
});

test('new-rule evals trip the rules they were written for', () => {
  const got = (name) => analyze(readFileSync(join(evalDir, name), 'utf8')).findings.map((f) => `${f.rule}:${f.severity}`);
  for (const want of ['first-line:hard', 'early-heading:soft', 'long-bullet:hard', 'many-questions:soft']) assert.ok(got('07-bad.md').includes(want), `07-bad ${want}`);
  for (const want of ['first-line:hard', 'long-paragraph:hard', 'too-much-bold:hard']) assert.ok(got('08-bad.md').includes(want), `08-bad ${want}`);
  for (const want of ['plan-first-step:hard', 'plan-time-box:hard', 'plan-break:hard', 'plan-checklist:soft', 'many-questions:soft']) assert.ok(got('09-bad.md').includes(want), `09-bad ${want}`);
  for (const want of ['first-line:hard', 'long-bullet:soft']) assert.ok(got('10-bad.md').includes(want), `10-bad ${want}`);
  assert.ok(got('11-bad.md').includes('repeated-label:hard'));
});

test('SKILL.md passes its own linter', () => {
  const r = analyze(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'), { reply: false });
  assert.deepEqual(r.findings, []);
});
