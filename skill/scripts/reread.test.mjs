import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, syllables, T } from './reread.mjs';

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
  const r = analyze('# Title\n\nThe build passed. Ship it.\n');
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.hard, 0);
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
    'See https://example.com/utilise/facilitate/long for more.',
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
  const para = Array(4).fill('A short plain line of text here.').join('\n');
  const t = [para, para, para].join('\n\n');
  assert.ok(find(t, 'wall-of-text'));
  assert.ok(!rules('# Head\n\n' + para + '\n\n- a\n\n' + para + '\n').includes('wall-of-text'));
});

test('CLI: text output, summary, exit 1 on hard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rr-'));
  const f = join(dir, 'a.md');
  writeFileSync(f, `${wrapped(30)}.\n`);
  const r = spawnSync('node', [CLI, f], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^1:1 long-sentence .+ → .+/m);
  assert.match(r.stdout, /1 hard/);
});

test('CLI: exit 0 with only soft findings', () => {
  const r = spawnSync('node', [CLI], { input: `${wrapped(18)}.\n`, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /long-sentence/);
});

test('CLI: --json from stdin', () => {
  const r = spawnSync('node', [CLI, '--json'], { input: `${wrapped(30)}.\n`, encoding: 'utf8' });
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.summary.hard, 1);
  assert.equal(j.findings[0].rule, 'long-sentence');
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
  assert.equal(find(Array(4).fill(line).join('\n'), 'long-paragraph').severity, 'soft');
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

// Skill-level checks: the docs, the thresholds file and the evals agree.
const skillDir = join(here, '..');
const evalDir = join(skillDir, 'references', 'evals');

test('SKILL.md limits table matches thresholds.json', () => {
  const md = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const want = {
    'Sentence words': [T.sentence_words.soft, T.sentence_words.hard],
    'Paragraph lines': [T.paragraph_lines.soft, T.paragraph_lines.hard],
    'Line characters': [T.line_chars.soft, T.line_chars.hard],
    'Long words per sentence': [T.long_word.words_per_sentence_soft, T.long_word.words_per_sentence_hard],
    'List items': [T.list_items.soft, T.list_items.hard],
    'Bold per reply': [T.bold_per_reply.soft, T.bold_per_reply.hard],
    'Table columns': [T.table_columns.soft, T.table_columns.hard],
  };
  const rows = Object.fromEntries(md.split('\n').filter((l) => /^\|.*\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([k, a, b]) => [k, [Number(a), Number(b)]]));
  for (const [k, v] of Object.entries(want)) assert.deepEqual(rows[k], v, k);
  assert.match(md, new RegExp(`${T.long_word.letters_soft} or more letters, or ${T.long_word.syllables_soft} or more syllables`));
});

test('evals: every bad file has a hard hit, every fixed file has zero issues', () => {
  const files = readdirSync(evalDir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 12);
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

test('SKILL.md passes its own linter', () => {
  const r = analyze(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'));
  assert.deepEqual(r.findings, []);
});
