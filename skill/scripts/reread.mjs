#!/usr/bin/env node
// Dyslexic-reread linter. Zero dependencies. Reads markdown from a file or stdin and
// flags spots that trip a dyslexic reader. Limits come from ../thresholds.json; most are
// style defaults, not trial results (see references/research.md). Angus's feedback
// overrides them. The SKILL.md limits table is tested against the same file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const T = JSON.parse(readFileSync(new URL('../thresholds.json', import.meta.url), 'utf8'));

// research.md s2: sentence length has weak direct evidence. Soft 15 is a style default
// for working-memory load (s1). Hard 25 matches Dyslexia Scotland.
const SENTENCE_SOFT = T.sentence_words.soft;
const SENTENCE_HARD = T.sentence_words.hard;
// s3: paragraph spacing is the layout lever the AI holds. Hard 5 matches Dyslexia Scotland.
const PARA_LINES_SOFT = T.paragraph_lines.soft;
const PARA_LINES_HARD = T.paragraph_lines.hard;
// s3: one idea per short paragraph.
const PARA_SENTENCES_SOFT = T.paragraph_sentences.soft;
const PARA_SENTENCES_HARD = T.paragraph_sentences.hard;
// s3: WCAG 1.4.8 says 80 characters or fewer. Rendered lines are estimated at the soft
// width, because a long unwrapped line still wraps on screen.
const LINE_CHARS_SOFT = T.line_chars.soft;
const LINE_CHARS_HARD = T.line_chars.hard;
// s1: long, rare words cost the most (strong). Cut points are a judgement call.
// A "long" word hits the soft cut; a word at the hard cut is flagged on its own.
const WORD_LETTERS_SOFT = T.long_word.letters_soft;
const WORD_SYLLABLES_SOFT = T.long_word.syllables_soft;
const WORD_LETTERS_HARD = T.long_word.letters_hard;
const WORD_SYLLABLES_HARD = T.long_word.syllables_hard;
const LONG_WORDS_SOFT = T.long_word.words_per_sentence_soft;
const LONG_WORDS_HARD = T.long_word.words_per_sentence_hard;
// s1: many similar items add multi-item cost (weak).
const LIST_SOFT = T.list_items.soft;
const LIST_HARD = T.list_items.hard;
// s3: avoid wide tables that wrap badly.
const COLS_SOFT = T.table_columns.soft;
const COLS_HARD = T.table_columns.hard;
// s3: real headings aid navigation (weak-moderate, BDA). More than this many lines of
// plain prose with no heading, list or table is a wall.
const HEADING_AFTER_LINES = T.heading_after_lines.value;
// s2: BDA says expand abbreviations on first use. These are common enough to skip.
const ACRONYM_ALLOW = new Set(T.forbid.all_caps_allow);
// Ordinary English words typed in capitals. Shouting, not an abbreviation.
const CAPS_WORDS = new Set(['STOP', 'NOW', 'NOT', 'NEVER', 'ALWAYS', 'ONLY', 'DO', 'NOTE', 'WARNING',
  'IMPORTANT', 'TODO', 'FIXME', 'NEW', 'OLD', 'ALL', 'NO', 'YES', 'AND', 'THE', 'BUT', 'ADD', 'RUN',
  'FAIL', 'PASS', 'DONE', 'HERE', 'THIS', 'THAT', 'FIRST', 'LAST', 'NEXT', 'WAIT', 'MUST', 'NEED',
  'DELETE', 'WARN', 'ERROR', 'BEWARE', 'CAUTION', 'READ', 'SAFE', 'FREE', 'EVERY', 'ANY', 'KEEP']);
// s2: BDA says explain jargon on first use (weak-moderate). Small list on purpose.
const JARGON = new Set(T.jargon.words);
const LOOK_ALIKES = T.look_alike_pairs.pairs;
// Reply shape: the answer is line 1 in one short sentence, and a bullet is one short idea
// (s1, s4: weak, style defaults). Rules that name "a reply" are skipped for documents.
const FIRST_SOFT = T.first_line_words.soft;
const FIRST_HARD = T.first_line_words.hard;
const BULLET_SOFT = T.bullet_words.soft;
const BULLET_HARD = T.bullet_words.hard;
const QUESTIONS_MAX = T.questions_per_reply.max;
// s3: bold keeps letter shapes. A short label that starts a bullet is free; other bold counts.
const BOLD_SOFT = T.bold_per_reply.soft;
const BOLD_HARD = T.bold_per_reply.hard;
const LABEL_WORDS = T.bold_per_reply.label_words;
const REPEAT_SOFT = T.repeated_label.soft;
const REPEAT_HARD = T.repeated_label.hard;
// s6: study-plan numbers are conventions (time boxes, breaks), not trial results.
const FIRST_STEP_SOFT = T.first_step_minutes.soft;
const FIRST_STEP_HARD = T.first_step_minutes.hard;
const STEP_MAX = T.step_minutes.hard;
const BREAK_SOFT = T.steps_per_break.soft;
const BREAK_HARD = T.steps_per_break.hard;
// Opening pleasantries push the answer out of line 1.
const FILLER = /^(?:sure|certainly|of course|absolutely|great question|good question|happy to help|i'd be happy|i would be happy|no problem|glad you asked)\b/i;
const STEP_RE = /^\s*\d+[.)]\s+/;
const BOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]?\]/;
const wordRe = (words) => new RegExp(`\\b(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const PLAN_WORDS = wordRe(T.plan_triggers.words);
const PLAN_WEAK_WORDS = wordRe(T.plan_triggers.weak_words);
const DEADLINE_CUE = /\b(?:by|before|until|due|on|this|next)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:tomorrow|tonight)\b|\bnext (?:week|month)\b|\b(?:in|within)\s+\d+\s+(?:day|week|hour)s?\b|\bdue\b/i;
// A number right after one of these is a label, not a figure.
const NUMBER_LABELS = new Set(['item', 'step', 'phase', 'line', 'port', 'version', 'section', 'number',
  'no', 'page', 'pass', 'rule', 'unit', 'lesson', 'part', 'chapter', 'v']);
// s2: short common words help (weak-moderate). Rewrite the whole sentence, never patch
// one word (moderate), so suggestions say "consider".
const WORD_SWAPS = {
  utilise: 'use', utilize: 'use', leverage: 'use', remediate: 'fix', commence: 'start',
  terminate: 'end', subsequently: 'then', approximately: 'about', additionally: 'also',
  furthermore: 'also', facilitate: 'help', demonstrate: 'show', implement: 'build',
  functionality: 'feature', methodology: 'method',
  // Local extras: same idea, common plain alternatives.
  ascertain: 'find out', assist: 'help', obtain: 'get', purchase: 'buy', sufficient: 'enough',
  modification: 'change', initiate: 'start', optimal: 'best', regarding: 'about',
  nevertheless: 'but', consequently: 'so', endeavour: 'try', endeavor: 'try',
};

const NEGATORS = /^(not|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|hardly|scarcely)$|n['’]t$/i;
// "not uncommon" style: a negator followed by a negative-prefixed word.
const NEGATIVE_ADJ = new Set(['uncommon', 'unlikely', 'unable', 'unclear', 'unsure', 'unnecessary',
  'unimportant', 'unusual', 'unwilling', 'unhelpful', 'impossible', 'incapable', 'insignificant',
  'infrequent', 'inaccurate', 'irrelevant', 'unexpected', 'untrue', 'unknown']);

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const blank = (m) => m.replace(/[^\n]/g, ' ');
// Blank a path or URL but keep trailing sentence punctuation, so "See ~/a/b.ts." still
// ends its sentence.
const blankKeep = (m) => {
  const core = m.replace(/[.,;:!?]+$/, '');
  return blank(core) + m.slice(core.length);
};
const SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cellCount = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
const indentOf = (raw) => raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;

export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  // Silent endings: -e (but not -le), -es, -ed.
  w = w.replace(/(?:[^aeiouyl]e|[^aeiouytd]ed|[^aeiouy]es)$/, (m) => m[0]);
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Masks non-prose spans (same length as raw) and tags the line type.
function maskLine(raw) {
  let t = raw.replace(/^\s*>+\s?/, blank);
  let type = 'prose';
  if (!t.trim()) type = 'blank';
  else if (/^\s{0,3}#{1,6}\s/.test(t)) type = 'heading';
  else if (/^\s*([-*+]|\d+[.)])\s+/.test(t)) type = 'list';
  t = t.replace(/`[^`]*`/g, blank);
  t = t.replace(/\]\([^)]*\)/g, blank);
  t = t.replace(/(?:https?:\/\/|www\.)\S+/g, blankKeep);
  t = t.replace(/(?<![\w])(?:~\/|\.{1,2}\/|\/)[^\s)\]]+/g, blankKeep);
  t = t.replace(/[\w.-]+(?:\/[\w.-]+){2,}|[\w-]+\/[\w-]*\.\w+/g, blankKeep);
  t = t.replace(/^\s*#{1,6}\s/, blank).replace(/^\s*([-*+]|\d+[.)])\s+/, blank);
  // A task box is not a word.
  if (type === 'list') t = t.replace(/^\s*\[[ xX]?\]/, blank);
  t = t.replace(/[*]/g, ' ').replace(/(?<![\w])_|_(?![\w])/g, ' ');
  return { type, text: t };
}

// Line types: blank, prose, heading, list, table, tablesep, code (fences, indented code,
// YAML front matter).
function classifyAll(lines) {
  const info = [];
  let fence = false;
  let metaEnd = -1;
  if (lines[0] && lines[0].trim() === '---') {
    metaEnd = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  }
  let prevType = 'blank';
  let lastContent = 'none';
  lines.forEach((raw, i) => {
    const code = () => ({ type: 'code', text: blank(raw), indent: 0 });
    let c;
    if (i <= metaEnd) c = code();
    else if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; c = code(); }
    else if (fence) c = code();
    else if (raw.trim() && indentOf(raw) >= 4 &&
      ((prevType === 'blank' && lastContent !== 'list') || (prevType === 'code' && info[i - 1].indented))) {
      // Indented code block: after a blank line, and not a list item's continuation.
      c = code();
      c.indented = true;
    } else {
      c = { ...maskLine(raw), indent: indentOf(raw) };
    }
    info.push(c);
    prevType = c.type;
    if (c.type !== 'blank' && !c.indented && c.type !== 'code') lastContent = c.type;
  });

  // Pipe tables: a run of pipe lines is a table only if it has a separator row.
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (info[i].type === 'code' || !/^\s*\|/.test(lines[i])) continue;
    let j = i;
    while (j + 1 < lines.length && info[j + 1].type !== 'code' && /^\s*\|/.test(lines[j + 1])) j++;
    const sepAt = lines.slice(i, j + 1).findIndex((l) => SEP_RE.test(l) && l.includes('|'));
    if (sepAt >= 0) {
      tables.push({ line: i + 1, cols: cellCount(lines[i]) });
      for (let k = i; k <= j; k++) {
        const sep = SEP_RE.test(lines[k]) && lines[k].includes('|');
        info[k] = sep
          ? { type: 'tablesep', text: blank(lines[k]), indent: 0 }
          : { type: 'table', text: maskLine(lines[k]).text.replace(/\|/g, '.'), indent: 0 };
      }
    }
    i = j;
  }
  return { info, tables };
}

function splitSentences(text) {
  // Returns [{start, end}] offsets into text. Ends at . ! ? followed by space or end.
  const safe = text.replace(/\b(?:e\.g|i\.e|etc|vs)\./gi, (m) => m.replace(/\./g, '_'));
  const out = [];
  let start = -1;
  for (let i = 0; i < safe.length; i++) {
    const c = safe[i];
    if (start < 0 && /\S/.test(c)) start = i;
    if (start >= 0 && /[.!?]/.test(c)) {
      let j = i;
      while (j + 1 < safe.length && /[.!?]/.test(safe[j + 1])) j++;
      if (j + 1 >= safe.length || /\s/.test(safe[j + 1])) {
        out.push({ start, end: j + 1 });
        start = -1;
        i = j;
      }
    }
  }
  if (start >= 0) out.push({ start, end: safe.trimEnd().length });
  return out.filter((s) => s.end > s.start);
}

const isNumberToken = (tok) => {
  const t = tok.replace(/^[^\w]+|[^\w%]+$/g, '');
  if (/@|:/.test(tok)) return false; // names and ports like postgresql@16, host:5432
  if (/^\d+(\.\d+){2,}$/.test(t)) return false; // version strings
  return /^\d[\d,._]*(%|[a-zA-Z]{1,3})?$/.test(t);
};

const wordCount = (s) => [...s.matchAll(/\S+/g)].filter((m) => /[A-Za-z0-9]/.test(m[0])).length;

// True when the user's message should get a study plan, not an explanation. The weak words
// ("test", "project") also name code, so they need a deadline cue.
export function wantsPlan(message) {
  return PLAN_WORDS.test(message) || (PLAN_WEAK_WORDS.test(message) && DEADLINE_CUE.test(message));
}

// Minutes in a step's time box, like "(20 min)", "1 hr" or "10-15 minutes". A range counts
// at its top end.
export function timeBox(text) {
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(h(?:ou)?rs?|min(?:ute)?s?)\b/i);
  if (!m) return null;
  return Number(m[2] ?? m[1]) * (/^h/i.test(m[3]) ? 60 : 1);
}

// The reply proper starts after any front matter and after a leading `thinking` block. A model
// with no private thinking writes its thinking there (see lib/prompt.mjs); it is not the reply.
function replyStart(lines) {
  let i = lines[0]?.trim() === '---' ? lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l)) + 1 : 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (!/^\s*(?:```|~~~)\s*thinking\b/i.test(lines[i] ?? '')) return i;
  const fence = lines[i].trim().slice(0, 3);
  let j = i + 1;
  while (j < lines.length && !lines[j].trim().startsWith(fence)) j++;
  return j + 1;
}

// Line 1 must be the answer: one short plain sentence, not a heading, a list, a table or filler.
function checkFirstLine(lines, info, start, add) {
  let f = start;
  while (f < lines.length && info[f].type === 'blank') f++;
  if (f >= lines.length) return;
  const { type } = info[f];
  if (type === 'heading' || type === 'list' || type === 'table') {
    add(f + 1, 1, 'first-line', 'hard', `line 1 is a ${type}, not the answer`, 'open with the answer in one short sentence');
    return;
  }
  if (type === 'code') {
    add(f + 1, 1, 'first-line', 'soft', 'line 1 is code, not the answer', 'say the answer in one short sentence, then show the code');
    return;
  }
  // A sentence that wraps onto line 2 still counts as the first line.
  let end = f;
  while (end + 1 < lines.length && info[end + 1].type === 'prose') end++;
  const block = info.slice(f, end + 1).map((l) => l.text).join('\n');
  const [first] = splitSentences(block);
  const n = Math.max(wordCount(info[f].text), first ? wordCount(block.slice(first.start, first.end)) : 0);
  if (n > FIRST_HARD) add(f + 1, 1, 'first-line', 'hard', `${n} words (max ${FIRST_HARD})`, 'open with the answer in one short sentence, then give detail below');
  else if (n > FIRST_SOFT) add(f + 1, 1, 'first-line', 'soft', `${n} words (aim for ${FIRST_SOFT} or fewer)`, 'cut line 1 to the answer alone');
  if (FILLER.test(lines[f].trim())) add(f + 1, 1, 'first-line', 'soft', 'opens with filler, not the answer', 'start with the answer itself');
}

// Bold spans, split into short bullet labels and the rest. Code is skipped, and `**` inside it
// is not emphasis. Bold in a table is a header or a row name, so it is skipped too.
function boldSpans(lines, info) {
  const loose = [], labels = [];
  lines.forEach((raw, i) => {
    if (['code', 'table', 'tablesep'].includes(info[i].type)) return;
    const t = raw.replace(/`[^`]*`/g, blank);
    for (const m of t.matchAll(/\*\*([^*\n]+)\*\*/g)) {
      const label = /^\s*(?:[-*+]|\d+[.)])\s+$/.test(t.slice(0, m.index)) && wordCount(m[1]) <= LABEL_WORDS;
      (label ? labels : loose).push({ line: i + 1, col: m.index + 1, name: m[1].trim().replace(/[:.]+$/, '').toLowerCase() });
    }
  });
  return { loose, labels };
}

// A study plan: a goal line, numbered steps with time boxes, a break after every 2, a checklist.
// With `force` the reply must be one. Without it, the checks run only on a reply that carries
// a plan's marks: time-boxed steps plus a goal line or task boxes. A recipe has timed steps too,
// and "bake for 45 minutes" must not read as a plan with a step that is too long.
function checkPlan({ lines, info, blocks, questions, start, force }, add) {
  if (!lines.some((l) => l.trim())) return;
  const steps = blocks
    .filter((b) => b.kind === 'list' && info[b.lines[0]].indent < 2 && STEP_RE.test(lines[b.lines[0]]))
    .map((b) => {
      const text = b.lines.map((i) => lines[i]).join(' ');
      // A break step is short, so a long step that merely mentions a break is still work.
      return { line: b.lines[0] + 1, box: timeBox(text), pause: /\bbreak\b/i.test(text) && wordCount(text) <= 8 };
    });
  const boxes = lines.filter((l, i) => info[i].type === 'list' && BOX_RE.test(l)).length;
  let g = start;
  while (g < lines.length && info[g].type === 'blank') g++;
  const goal = /\bgoal\b/i.test(lines[g] ?? '');
  if (!force && !(steps.filter((s) => s.box != null).length >= 2 && (boxes || goal))) return;

  if (force && steps.length < 2) {
    add(g + 1, 1, 'plan-missing', 'hard', 'this message needs a study plan, but the reply has no numbered steps',
      'write a goal line, numbered steps with time boxes, and a [ ] checklist');
  }
  if (!goal) add(g + 1, 1, 'plan-goal', 'soft', 'line 1 is not a goal line', 'start with "Goal:" and one sentence');

  // Not asking is part of the rule: guess the deadline or the amount and say so.
  const ask = questions.find((q) => !steps.length || q.line < steps[0].line);
  if (ask) add(ask.line, ask.col, 'plan-asks-first', 'soft', 'asks a question before the plan', 'guess a sensible answer, say it in one line, and give the plan');

  const work = steps.filter((s) => !s.pause);
  const head = steps[0];
  if (head && !head.pause && head.box != null) {
    if (head.box > FIRST_STEP_HARD) add(head.line, 1, 'plan-first-step', 'hard', `first step is ${head.box} minutes (max ${FIRST_STEP_HARD})`, 'make step 1 a tiny start that takes under 2 minutes');
    else if (head.box > FIRST_STEP_SOFT) add(head.line, 1, 'plan-first-step', 'soft', `first step is ${head.box} minutes (aim for ${FIRST_STEP_SOFT} or fewer)`, 'make step 1 a tiny start that takes under 2 minutes');
  }
  for (const s of work) {
    if (s.box > STEP_MAX) add(s.line, 1, 'plan-time-box', 'hard', `${s.box} minutes (max ${STEP_MAX})`, `split it into steps of ${STEP_MAX} minutes or less, with a break between`);
  }
  const bare = work.filter((s) => s.box == null);
  if (bare.length) add(bare[0].line, 1, 'plan-time-box', 'soft', `${bare.length} of ${work.length} steps have no time box`, 'add a time box like "(20 min)" to every step');

  // A break can be a step or a loose line between steps.
  const stepLines = new Set(steps.map((s) => s.line));
  const stops = blocks.filter((b) => !stepLines.has(b.lines[0] + 1) && /\bbreak\b/i.test(b.lines.map((i) => lines[i]).join(' '))).map((b) => b.lines[0] + 1);
  let run = 0, prev = 0;
  for (const s of steps) {
    if (s.pause || stops.some((l) => l > prev && l < s.line)) run = 0;
    prev = s.line;
    if (s.pause) continue;
    run++;
    if (run === BREAK_SOFT + 1 || run === BREAK_HARD + 1) {
      add(s.line, 1, 'plan-break', run > BREAK_HARD ? 'hard' : 'soft', `${run} steps in a row with no break`, `put a short break step after every ${BREAK_SOFT} steps`);
    }
  }

  if (!boxes) add(lines.findLastIndex((l) => l.trim()) + 1, 1, 'plan-checklist', 'soft', 'no checklist with [ ] boxes', 'end with one "- [ ]" line per step');
}

export function analyze(source, { reply = true, plan = 'auto' } = {}) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const { info, tables } = classifyAll(lines);

  const findings = [];
  const add = (line, col, rule, severity, message, suggestion) =>
    findings.push({ line, col, rule, severity, message, suggestion });
  const questions = [];

  // Build blocks of consecutive lines. Prose joins prose; a list item opens a block and
  // swallows indented continuation lines; table rows form one block.
  const blocks = [];
  let cur = null;
  info.forEach((l, i) => {
    const continues = cur && (
      (cur.kind === 'prose' && l.type === 'prose') ||
      (cur.kind === 'table' && (l.type === 'table' || l.type === 'tablesep')) ||
      (cur.kind === 'list' && l.type === 'prose' && l.indent >= 2));
    if (continues) { cur.lines.push(i); return; }
    cur = null;
    if (l.type === 'prose' || l.type === 'list' || l.type === 'table') {
      cur = { kind: l.type, lines: [i] };
      blocks.push(cur);
    }
  });

  // Acronyms spelled out in a heading count as introduced for the whole doc.
  const seenAcronyms = new Set();
  const seenJargon = new Set();
  info.forEach((l) => {
    if (l.type !== 'heading') return;
    for (const m of l.text.matchAll(/\b[A-Z]{2,6}\b/g)) {
      const before = l.text[m.index - 1];
      const after = l.text.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (before === '(' || /^\s?\(/.test(after)) seenAcronyms.add(m[0]);
    }
  });

  for (const b of blocks) {
    const starts = [];
    let text = '';
    for (const li of b.lines) { starts.push(text.length); text += info[li].text + '\n'; }
    const pos = (idx) => {
      let k = starts.length - 1;
      while (starts[k] > idx) k--;
      return [b.lines[k] + 1, idx - starts[k] + 1];
    };

    const sentences = splitSentences(text);

    // A bullet is one idea, so the whole item (with its wrapped lines) is short.
    if (b.kind === 'list') {
      const n = wordCount(text);
      const [l, c] = pos(Math.max(0, text.search(/\S/)));
      if (n > BULLET_HARD) add(l, c, 'long-bullet', 'hard', `${n} words (max ${BULLET_HARD})`, 'one idea per bullet: cut it, or split it into two bullets');
      else if (n > BULLET_SOFT) add(l, c, 'long-bullet', 'soft', `${n} words (aim for ${BULLET_SOFT} or fewer)`, 'one idea per bullet: cut it, or split it');
    }

    for (const s of sentences) {
      const st = text.slice(s.start, s.end);
      const toks = [...st.matchAll(/\S+/g)].filter((m) => /[A-Za-z0-9]/.test(m[0]));
      const n = toks.length;
      const [sl, sc] = pos(s.start);
      // Questions in a list are content (a quiz), so only prose counts as asking.
      if (b.kind === 'prose' && /\?[.!?]*$/.test(st)) questions.push({ line: sl, col: sc });

      if (n > SENTENCE_HARD) {
        add(sl, sc, 'long-sentence', 'hard', `${n} words (max ${SENTENCE_HARD})`, 'split into two or three short sentences');
      } else if (n > SENTENCE_SOFT) {
        add(sl, sc, 'long-sentence', 'soft', `${n} words (aim for ${SENTENCE_SOFT} or fewer)`, 'split at the first "and", "but" or comma');
      }

      // Words.
      const ws = [...st.matchAll(WORD_RE)].map((m) => ({ w: m[0], at: s.start + m.index }));
      let longCount = 0;
      let overAt = null;
      for (const { w, at } of ws) {
        const [l, c] = pos(at);
        const low = w.toLowerCase();
        if (WORD_SWAPS[low]) {
          add(l, c, 'rare-word', 'soft', `"${w}" is a rare word`, `consider "${WORD_SWAPS[low]}" (rewrite the whole sentence)`);
        } else if (JARGON.has(low)) {
          const after = st.slice(at - s.start + w.length, at - s.start + w.length + 12);
          if (!seenJargon.has(low) && !/^\s?\(|^,?\s*(meaning|which means)/.test(after)) {
            add(l, c, 'jargon', 'soft', `"${w}" is jargon`, 'say it in plain words once, then use the term');
          }
          seenJargon.add(low);
        } else if (!/^[A-Z]{2,}$/.test(w) && !/[a-z][A-Z]/.test(w)) {
          const syl = syllables(w);
          if (w.length >= WORD_LETTERS_HARD || syl >= WORD_SYLLABLES_HARD) {
            add(l, c, 'long-word', 'soft', `"${w}" is long (${w.length} letters, ${syl} syllables)`, 'use a shorter word or explain it');
          }
          if (w.length >= WORD_LETTERS_SOFT || syl >= WORD_SYLLABLES_SOFT) {
            longCount++;
            if (longCount === LONG_WORDS_SOFT + 1) overAt = at;
          }
        }
      }
      if (longCount > LONG_WORDS_SOFT) {
        const [l, c] = pos(overAt);
        add(l, c, 'long-words', longCount > LONG_WORDS_HARD ? 'hard' : 'soft',
          `${longCount} long words in one sentence (aim for ${LONG_WORDS_SOFT} or fewer)`,
          'use shorter words, or split the sentence');
      }

      // Double negatives. Quoted example text is not scanned. The second negator must
      // follow at once (or after a/an/the), or come after "unless".
      const quotes = [...st.matchAll(/"[^"\n]*"|“[^”\n]*”/g)].map((m) => [m.index, m.index + m[0].length]);
      const nq = ws.filter((x) => !quotes.some(([a, z]) => x.at - s.start >= a && x.at - s.start < z));
      const wl = nq.map((x) => x.w.toLowerCase());
      for (let i = 0; i < wl.length; i++) {
        let hit = -1;
        if (NEGATORS.test(wl[i])) {
          let j = i + 1;
          if (['a', 'an', 'the'].includes(wl[j])) j++;
          if (j < wl.length && (NEGATIVE_ADJ.has(wl[j]) || (NEGATORS.test(wl[j]) && !(wl[i] === 'neither' && wl[j] === 'nor')))) hit = j;
        } else if (wl[i] === 'unless') {
          for (let j = i + 1; j < wl.length && j <= i + 6; j++) if (NEGATORS.test(wl[j])) { hit = j; break; }
        }
        if (hit >= 0) {
          const [l, c] = pos(nq[i].at);
          add(l, c, 'double-negative', 'hard', `"${wl[i]} ... ${wl[hit]}" stacks two negatives`, 'say it as a plain positive');
          break;
        }
      }

      // Look-alike pairs in one sentence.
      const wset = new Set(ws.map((x) => x.w.toLowerCase()));
      for (const [a, z] of LOOK_ALIKES) {
        if (wset.has(a) && wset.has(z)) {
          const first = ws.find((x) => x.w.toLowerCase() === a || x.w.toLowerCase() === z);
          const [l, c] = pos(first.at);
          add(l, c, 'look-alike', 'soft', `"${a}" and "${z}" look alike in one sentence`, 'reword so only one of them appears');
        }
      }

      // A figure buried mid-way through a long sentence. Labels, versions and ports are skipped.
      if (n > SENTENCE_SOFT) {
        const idx = toks.findIndex((m, k) => k >= 2 && k < n - 2 && isNumberToken(m[0]) &&
          !NUMBER_LABELS.has(toks[k - 1][0].replace(/[^A-Za-z]/g, '').toLowerCase()));
        if (idx >= 0) {
          const [l, c] = pos(s.start + toks[idx].index);
          add(l, c, 'buried-number', 'soft', `number "${toks[idx][0].replace(/[.,;:]+$/, '')}" sits in a ${n}-word sentence`, 'give the number its own short sentence or a list item');
        }
      }

      // Acronyms: first use needs an expansion next to it.
      for (const m of st.matchAll(/\b[A-Z]{2,6}\b/g)) {
        const a = m[0];
        if (ACRONYM_ALLOW.has(a) || CAPS_WORDS.has(a) || seenAcronyms.has(a)) continue;
        seenAcronyms.add(a);
        const before = st.slice(0, m.index);
        const after = st.slice(m.index + a.length, m.index + a.length + 2);
        if (/\($/.test(before) || /^\s?\(/.test(after) || /(,\s*or|also called|known as|aka)\s+$/i.test(before)) continue;
        const [l, c] = pos(s.start + m.index);
        add(l, c, 'acronym', 'soft', `"${a}" is not spelled out at first use`, `write the full name, then "(${a})"`);
      }
    }

    if (b.kind === 'prose') {
      const rendered = b.lines.reduce((n, li) => n + Math.ceil(info[li].text.trim().replace(/\s+/g, ' ').length / LINE_CHARS_SOFT), 0);
      const sc = sentences.length;
      // Hard at the cap itself for both counts, so 5 one-sentence lines and 5 sentences agree.
      const hard = rendered >= PARA_LINES_HARD || sc >= PARA_SENTENCES_HARD + 1;
      const soft = rendered > PARA_LINES_SOFT || sc > PARA_SENTENCES_SOFT;
      if (hard || soft) {
        const [l, c] = pos(sentences.length ? sentences[0].start : 0);
        add(l, c, 'long-paragraph', hard ? 'hard' : 'soft',
          `${rendered} lines, ${sc} sentences (aim for ${PARA_LINES_SOFT} lines, ${PARA_SENTENCES_SOFT} sentences)`,
          'split into shorter paragraphs, one idea each');
      }
    }
  }

  // Long source lines. Code, tables and lines that are only a path or URL are skipped.
  info.forEach((l, i) => {
    if (!['prose', 'list', 'heading'].includes(l.type) || !l.text.trim()) return;
    const len = lines[i].trimEnd().length;
    if (len > LINE_CHARS_HARD) add(i + 1, LINE_CHARS_SOFT + 1, 'long-line', 'hard', `${len} characters (max ${LINE_CHARS_HARD})`, 'break the line');
    else if (len > LINE_CHARS_SOFT) add(i + 1, LINE_CHARS_SOFT + 1, 'long-line', 'soft', `${len} characters (aim for ${LINE_CHARS_SOFT} or fewer)`, 'break the line');
  });

  // Wide tables.
  for (const t of tables) {
    if (t.cols > COLS_SOFT) {
      add(t.line, 1, 'wide-table', t.cols > COLS_HARD ? 'hard' : 'soft', `${t.cols} columns (aim for ${COLS_SOFT} or fewer)`, 'drop a column or split the table');
    }
  }

  // Long lists. A blank line or any non-list line ends the list; top-level items count.
  let run = null;
  const flush = () => {
    if (run && run.n > LIST_SOFT) {
      add(run.line, 1, 'long-list', run.n > LIST_HARD ? 'hard' : 'soft', `${run.n} items (aim for ${LIST_SOFT} or fewer)`, 'keep the key items, or group them under headings');
    }
    run = null;
  };
  info.forEach((l, i) => {
    if (l.type === 'list') {
      if (!run) run = { line: i + 1, n: 0 };
      if (l.indent < 2) run.n++;
    } else if (!(l.type === 'prose' && run && l.indent >= 2)) flush();
  });
  flush();

  // Wall of text: a long run of plain prose with no heading, list or table. Blank lines
  // do not break it (many short paragraphs under no heading is the problem); code does.
  let wrun = 0, runStart = -1, flagged = false;
  info.forEach((l, i) => {
    if (l.type === 'blank') return;
    if (l.type !== 'prose') { wrun = 0; flagged = false; return; }
    if (wrun === 0) runStart = i;
    wrun += Math.ceil(l.text.trim().replace(/\s+/g, ' ').length / LINE_CHARS_SOFT);
    if (wrun > HEADING_AFTER_LINES && !flagged) {
      flagged = true;
      add(runStart + 1, 1, 'wall-of-text', 'soft', `${wrun}+ lines of prose with no heading, list or table`, 'add a heading, or turn parallel items into a list or table');
    }
  });

  // Rules about the shape of a reply. A document (a page, SKILL.md) has its own title and headings.
  const start = replyStart(lines);
  if (reply) {
    checkFirstLine(lines, info, start, add);

    const body = info.slice(start).filter((l) => l.type !== 'blank');
    const heading = info.findIndex((l, i) => i >= start && l.type === 'heading');
    if (heading >= 0 && body.length <= HEADING_AFTER_LINES) {
      add(heading + 1, 1, 'early-heading', 'soft', `heading in a ${body.length}-line reply (headings start past ${HEADING_AFTER_LINES} lines)`, 'drop the heading and let line 1 lead');
    }

    if (questions.length > QUESTIONS_MAX) {
      const q = questions[QUESTIONS_MAX];
      add(q.line, q.col, 'many-questions', 'soft', `${questions.length} questions (aim for ${QUESTIONS_MAX} at most, at the end)`, 'keep the one that matters most');
    }

    const { loose, labels } = boldSpans(lines, info);
    if (loose.length > BOLD_SOFT) {
      const over = loose[BOLD_SOFT];
      add(over.line, over.col, 'too-much-bold', loose.length > BOLD_HARD ? 'hard' : 'soft', `${loose.length} bold phrases outside bullet labels (aim for ${BOLD_SOFT} or fewer)`, 'keep one key phrase bold, or use short bullet labels');
    }

    // One label over and over is a table written as bullets. Two labels that both repeat make a
    // grid (RAM, RAM, Storage, Storage), so that is hard even at two uses each.
    const uses = new Map();
    for (const l of labels) uses.set(l.name, [...(uses.get(l.name) ?? []), l]);
    const repeated = [...uses].filter(([, at]) => at.length > REPEAT_SOFT);
    for (const [name, at] of repeated) {
      add(at[REPEAT_SOFT].line, at[REPEAT_SOFT].col, 'repeated-label', at.length > REPEAT_HARD || repeated.length > 1 ? 'hard' : 'soft',
        `"${name}" starts ${at.length} bullets${repeated.length > 1 ? ', like a grid' : ''}`, 'put the rows in a table, or nest the bullets under one label');
    }
  }
  if (plan === true || (reply && plan !== false)) {
    checkPlan({ lines, info, blocks, questions, start, force: plan === true }, add);
  }

  findings.sort((a, b) => a.line - b.line || a.col - b.col);
  const hard = findings.filter((f) => f.severity === 'hard').length;
  return { findings, summary: { total: findings.length, hard, soft: findings.length - hard } };
}

function main(argv) {
  const json = argv.includes('--json');
  const file = argv.find((a) => !a.startsWith('--'));
  let src;
  try {
    src = readFileSync(file ?? 0, 'utf8');
  } catch (e) {
    process.stderr.write(`reread: cannot read ${file ?? 'stdin'}: ${e.code ?? e.message}\n`);
    return 2;
  }
  // --doc: a page or doc, which has a title and headings. --plan: the message asked for a study plan.
  const r = analyze(src, { reply: !argv.includes('--doc'), plan: argv.includes('--plan') ? true : 'auto' });
  if (json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    for (const f of r.findings) {
      process.stdout.write(`${f.line}:${f.col} ${f.rule} (${f.severity}) ${f.message} → ${f.suggestion}\n`);
    }
    process.stdout.write(`${r.summary.total} issues: ${r.summary.hard} hard, ${r.summary.soft} soft\n`);
  }
  return r.summary.hard > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
