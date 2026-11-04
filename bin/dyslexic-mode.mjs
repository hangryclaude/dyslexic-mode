#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { ask, toolLine } from '../lib/claude.mjs';
import { askFor, canonicalModel, learnContextWindow, listModels, markStale, openSessionFor, providerOf, refreshModels } from '../lib/models.mjs';
import { reply } from '../lib/filter.mjs';
import { systemPrompt } from '../lib/prompt.mjs';
import { leet, DIVIDER } from '../lib/pliny.mjs';
import { learn } from '../lib/learn.mjs';
import { append, rows, readProfile, readSettings, saveSettings, sessions, saveFile, latestFile, slug, today } from '../lib/store.mjs';
import { summarize, table } from '../lib/stats.mjs';
import { TARGET, questionFor, order, pickOf, PLAIN_SYSTEM, words } from '../lib/readtest.mjs';
import { MENU, GROUPS, resolve } from '../lib/commands.mjs';
import { setPalette, randomPalette, nextPalette, palette, grad } from '../lib/palette.mjs';
import { intro, thinking, brainScreen, menu, secret, promptGlyph, swatch } from '../lib/anim.mjs';
import { ESC, dim, fancy, fg, heading } from '../lib/style.mjs';
import { stream } from '../lib/render.mjs';
import { models, modelLine, findModel, byMaker, makerLine, nameOf, matching } from '../lib/modelmenu.mjs';
import { makerOf } from '../lib/makers.mjs';
import { SERVICES, findService } from '../lib/providers/services.mjs';
import { contextWindow, estimateTokens, usedTokens, hasUsage, breakdown, barCounts, bar, FILL, count, share } from '../lib/context.mjs';
import { openaiKey, keyFor, saveKey } from '../lib/keys.mjs';
import { openVoice, NO_KEY } from '../lib/voicechat.mjs';
import { LEVELS, LEVEL_NAMES, promptThinking, withHistory, exploreTurn } from '../lib/think.mjs';
import { COMPACT_ASK, carryPrompt } from '../lib/compact.mjs';
import { PLAN_SYSTEM, planPrompt, parsePlan, planMarkdown } from '../lib/plan.mjs';
import { chatMarkdown } from '../lib/chatlog.mjs';
import { copy } from '../lib/clip.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = name => (flag(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const saved = readSettings();
const state = {
  pliny: flag('pliny'),
  calm: flag('calm'),
  // Full access skips every permission prompt, so a stranger who installs this must opt in.
  tools: flag('full') && !flag('no-tools'),
  // The model and the thinking level are kept between launches. --model is for one launch. The
  // model is held under the name the registry gives it, so "sonnet" and claude/sonnet are one model.
  model: canonicalModel(opt('model') ?? saved.model),
  thinking: LEVEL_NAMES.includes(saved.thinking) ? saved.thinking : 'off',
  sessionId: undefined,
  last: null,
  // The chat so far, for /export and for explorer, which has no session to remember it.
  history: [],
  // What the last reply said about the context: its usage, and the window if the model told us.
  usage: null,
  window: undefined,
  // Whether the ChatGPT voice chat is running. It is its own chat, beside this one.
  voice: false,
};
// A model nobody takes (a typo in --model, a setting that went stale) would fail the first message,
// and full access is Claude's alone. Both are put right here, and said once the screen is up.
const startup = [];
if (state.model != null && !providerOf(state.model)) {
  startup.push(`no model called "${state.model}", so the default model is used`);
  state.model = undefined;
}
if (state.tools && providerOf(state.model) !== 'claude') {
  startup.push(`full access works with Claude only, so tools are off for ${state.model}`);
  state.tools = false;
}
if (opt('palette')) setPalette(opt('palette'));
else randomPalette();
const out = process.stdout;
let session = null, voice = null, leaving = false;
// The voice chat holds the microphone, so it is let go of on every way out. A closed terminal or a
// kill would skip the handler, so they go through it.
process.on('exit', () => { leaving = true; voice?.stop(); session?.close(); if (out.isTTY) out.write(`${ESC}?25h`); });
for (const [signal, code] of [['SIGHUP', 129], ['SIGTERM', 143]]) process.on(signal, () => process.exit(code));

const width = () => Math.min((out.columns || 80) - 4, Number(opt('width')) || 72);
const view = write => stream(write, { width: width(), columns: out.columns || 80, styled: fancy(out), transform: state.pliny ? leet : undefined });
const fit = (s, max) => (s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s);
// Quiet text is dimmed on a terminal and plain anywhere else, like a pipe or a log.
const soft = s => (fancy(out) ? dim(s) : s);
const ago = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// The chat's claude process. A running process can't change its system prompt, so a new rule or
// a tools switch drops it, and the next turn resumes the same session in a new one.
const system = (tools = state.tools, level = state.thinking) => systemPrompt({ profile: readProfile(), tools, thinking: promptThinking(level) });
// The one place a chat session is opened, and the one place a side call picks its model. Both go
// to whichever provider the model's id names: Claude, grok or opencode.
const open = opts => openSessionFor(state.model, { system: system(), tools: state.tools, ...opts });
const side = (prompt, opts) => askFor(state.model, prompt, opts);
// A service keeps no chat of its own, so it gets the chat so far. The CLIs keep theirs.
const chatSession = () => (session ??= open({ resume: state.sessionId, history: state.history }));
const dropSession = () => { session?.close(); session = null; };
// Explorer sends every message as one-shot calls, so it has no chat process to start.
const warm = () => { if (state.thinking !== 'explorer') chatSession().warm(); };

// What an old chat said, turn by turn, so /export and explorer have it again.
const chatOf = id => rows('chats.jsonl').filter(c => c.session === id).map(({ q, text }) => ({ q, text }));

// A chat's session id means nothing to a provider that did not begin it, so going back to a chat
// from another provider switches to its model. Within one provider the model in use stays. A chat
// from before models were logged was Claude's. A chat keeps its tools too. Returns what changed.
function backTo(s) {
  const said = [];
  const theirs = s.model == null ? 'claude' : providerOf(s.model);
  if (theirs !== providerOf(state.model)) {
    state.model = s.model == null || !theirs ? undefined : canonicalModel(s.model);
    state.window = undefined;
    said.push(state.model ? `that chat used ${state.model}, so that model is on` : 'that chat used Claude, so its default model is on');
  }
  if (s.tools != null && s.tools !== state.tools) {
    state.tools = s.tools;
    said.push(s.tools ? 'that chat had full access, so full access is on' : 'that chat was chat only, so tools are off');
  }
  return said;
}

const latest = argv.includes('-c') || flag('continue') ? sessions()[0] : null;
if (latest) { state.sessionId = latest.id; state.history = chatOf(latest.id); backTo(latest); }
// Claude starts while the intro plays, so the first reply skips the start-up wait.
warm();

if (!state.calm) await intro(out);
else out.write('\n  DYSLEXIC MODE\n\n  press / then Enter for the menu.\n\n');
const using = [state.tools ? 'full access: files, shell, web, your skills, Claude agents, Codex' : 'chat only: tools are off'];
if (state.model) using.push(`model ${state.model}`);
if (state.thinking !== 'off') using.push(`thinking ${state.thinking}`);
out.write(soft(`  ${using.join(' · ')}`) + '\n');
for (const line of startup) out.write(soft(`  ${line}`) + '\n');
out.write(soft('  esc stops a reply. /help lists every command.') + '\n\n');

const rl = createInterface({ input: process.stdin, output: out, prompt: promptGlyph(out) });
const note = s => out.write(soft(`  ${s}`) + '\n\n');
const clear = () => out.write(`${ESC}2J${ESC}H`);
const show = text => {
  out.write('\n');
  const v = view(l => out.write(l + '\n'));
  v.push(text);
  v.end();
  out.write('\n');
};

// One router owns the keys. Readline gets them at the prompt. While a reply runs they are
// held back, so Esc can stop the reply and keys typed meanwhile wait instead of landing in it.
const lineKeys = process.stdin.listeners('keypress');
process.stdin.removeAllListeners('keypress');
let busy = null, held = [], waiter = null, spinner = null;
process.stdin.on('keypress', (s, key = {}) => {
  if (busy) return busy(s, key);
  for (const l of lineKeys) l(s, key);
});

// A test round needs input in the middle of a command, so a line goes to whoever waits for it.
const nextLine = q => new Promise(res => {
  waiter = line => { rl.setPrompt(promptGlyph(out)); res(line); };
  rl.setPrompt(q);
  rl.prompt();
});

// Esc or Ctrl-C asks `stop` to end the work early. A second Ctrl-C quits outright.
async function working(fn, stop = () => false) {
  let stopping = false;
  busy = (s, key) => {
    const quit = key.ctrl && key.name === 'c';
    if (quit && stopping) { out.write('\n'); process.exit(130); }
    if (quit || key.name === 'escape') {
      stopping = true;
      if (stop()) spinner?.status('stopping…');
      return;
    }
    held.push([s, key]);
  };
  spinner = thinking(out, { calm: state.calm });
  try { return await fn(); } finally { spinner(); spinner = null; busy = null; }
}

async function chat(msg) {
  out.write('\n');
  const t0 = Date.now();
  let first = null;
  if (state.pliny) out.write(`  ${DIVIDER}\n\n`);
  const v = view(line => {
    first ??= Date.now() - t0;
    out.write(`${fancy(out) ? `\r${ESC}2K` : ''}${line}\n`);
    spinner?.redraw();
  });
  const onRewrite = hard => spinner?.status(`tidying ${hard.length} trip point${hard.length === 1 ? '' : 's'}`);
  const explorer = state.thinking === 'explorer';
  let run, stop;
  if (explorer) {
    // No tools here: three drafts running the same command at once would run it three times.
    const turn = exploreTurn({ ask: (prompt, o) => side(prompt, { system: system(false), ...o }), onStatus: s => spinner?.status(s) });
    run = () => reply(turn.go, withHistory(msg, state.history), { onRewrite });
    stop = turn.stop;
  } else {
    const s = chatSession();
    run = () => reply((p, o) => s.send(p, o), msg, {
      onText: d => v.push(d),
      onTool: b => { v.mark(); spinner?.status(toolLine(b)); },
      onRewrite,
    });
    stop = () => s.interrupt();
  }
  const r = await working(run, stop);
  // Explorer's answer arrives whole, once its calls are done.
  if (explorer && !r.stopped) v.push(r.text);
  const shown = v.end();
  if (!explorer) state.sessionId = r.sessionId;
  if (r.stopped) {
    // What came in before Esc stays on screen, so ! can flag it.
    out.write('\n' + soft('  stopped') + '\n\n');
    if (r.text.trim()) state.last = r.text;
    return;
  }
  if (r.rewrites && !explorer) swapDraft(shown, r.text);
  state.last = r.text;
  state.history.push({ q: msg, text: r.text });
  state.usage = hasUsage(r.usage) ? r.usage : null;
  rememberWindow(r.contextWindow ?? r.usage?.contextWindow);
  const ms = Date.now() - t0;
  append('chats.jsonl', { ts: Date.now(), session: r.sessionId, q: msg.slice(0, 300), text: r.text, rewrites: r.rewrites, hard: r.hard, words: words(r.text), tools: state.tools, model: state.model ?? null, thinking: state.thinking, ms, first });
  const check = r.hard ? `${r.hard} hard hit left` : r.rewrites ? 'tidied once' : 're-read clean';
  const tail = `${state.pliny ? `\n  ${DIVIDER}\n` : ''}\n` + soft(fit(`  ${(ms / 1000).toFixed(1)}s · ${check}${explorer ? ' · explored 3 ways' : ''} · ! if it tripped you`, (out.columns || 80) - 1)) + '\n\n';
  out.write(tail);
}

// The rewrite takes the draft's place when the whole draft is still on screen. Otherwise it
// goes below, so nothing jumps out of view while it is being read.
function swapDraft(shown, text) {
  const draft = shown.lines.slice(shown.from).reduce((n, l) => n + l.rows, 0);
  if (fancy(out) && draft > 0 && draft + 2 < (out.rows || 24)) out.write(`${ESC}${draft}A\r${ESC}J`);
  else note('tidier version:');
  const v = view(l => out.write(l + '\n'));
  v.push(text);
  v.end();
}

async function flagLast(msg) {
  if (!state.last) return note('nothing to flag yet');
  const typed = msg.slice(1).trim() || (await nextLine(soft('  what tripped you? Enter to skip: '))).trim();
  const rules = await working(() => learn(ask, { reply: state.last, note: typed || undefined }));
  dropSession();
  warm();
  note(`learned. your profile has ${rules.length} rule${rules.length === 1 ? '' : 's'}. /profile to see them`);
}

async function resumeChat() {
  const past = sessions().filter(s => s.id !== state.sessionId).slice(0, 9);
  if (!past.length) return note('no old chats yet. they show up here after your first reply');
  out.write('\n');
  const i = await menu(out, process.stdin, past.map(s => [ago(s.ts), (s.first ?? '').replace(/\s+/g, ' ')]));
  if (i < 0) return note('menu closed');
  const s = past[i];
  dropSession();
  state.sessionId = s.id;
  state.history = chatOf(s.id);
  state.usage = null;
  for (const line of backTo(s)) note(line);
  warm();
  showLast(s);
}

// Back in an old chat, its last reply is shown again.
function showLast(s) {
  state.last = s.last.text;
  note(`back in: ${fit((s.first ?? '').replace(/\s+/g, ' '), 50)} (${s.turns} repl${s.turns === 1 ? 'y' : 'ies'}). the last one:`);
  out.write(soft(`  › ${fit(s.last.q.replace(/\s+/g, ' '), width())}`) + '\n\n');
  const v = view(l => out.write(l + '\n'));
  v.push(s.last.text);
  v.end();
  out.write('\n');
}

// Both sides of a test run without tools: a fair race between two plain answers.
// The thinking level stays out of it, because the test is about how the reply reads.
async function readingTest() {
  const round = rows('tests.jsonl').length;
  const q = questionFor(round);
  out.write('\n');
  note(`reading test, round ${round + 1} of ${TARGET}: ${q}`);
  const [plain, reread] = await working(() => Promise.all([
    side(q, { system: PLAIN_SYSTEM }),
    reply(side, q, { system: system(false, 'off') }),
  ]));
  const text = { plain: plain.text, reread: reread.text };
  const seq = order(), ms = {};
  for (const [i, kind] of seq.entries()) {
    clear();
    note(`answer ${i + 1} of 2. press Enter when you are done reading`);
    const v = view(l => out.write(l + '\n'));
    v.push(text[kind]);
    v.end();
    const start = Date.now();
    await nextLine('');
    ms[kind] = Date.now() - start;
  }
  clear();
  let key = '';
  while (!['1', '2', 's'].includes(key)) key = (await nextLine('  which was easier to read? 1, 2, or s for same: ')).trim().toLowerCase();
  append('tests.jsonl', {
    ts: Date.now(), question: q, order: seq, pick: pickOf(key, seq),
    plain: { ms: ms.plain, words: words(plain.text) },
    reread: { ms: ms.reread, words: words(reread.text), rewrites: reread.rewrites },
  });
  out.write('\n');
  note(`saved round ${round + 1}. /test for the next one, /stats for results`);
}

const fresh = msg => {
  dropSession();
  state.sessionId = undefined;
  state.last = null;
  state.history = [];
  state.usage = null;
  warm();
  note(msg);
};

function helpScreen() {
  const cols = (out.columns || 80) - 1, name = Math.max(...MENU.map(([n]) => n.length));
  out.write('\n');
  for (const [title, items] of GROUPS) {
    out.write(`  ${fancy(out) ? heading(title) : title}\n`);
    for (const [cmd, text] of items) out.write(`    ${cmd.padEnd(name)}  ${soft(fit(text, cols - name - 6))}\n`);
    out.write('\n');
  }
  note('typos are fine: /clam runs /calm. press / then Enter for the arrow menu');
}

// The window in play: what the model reported after the last reply, else what the model list knows.
const windowNow = () => contextWindow(state.model, { known: models(), reported: state.window });
// Nothing reported the window, and the list has only Claude's documented 200k or nothing, and the
// id does not say [1m]: then the size is a guess.
function windowIsGuess() {
  const listed = models().find(m => m.id === state.model);
  return !state.window && !/\[1m\]/i.test(state.model ?? '') && (!listed?.contextWindow || listed.contextSource === 'documented default');
}

// A window a model reports replaces any guess. It is kept too, so the next launch starts right.
function rememberWindow(window) {
  if (!window || window === state.window) return;
  state.window = window;
  if (state.model) learnContextWindow(state.model, window);
}

function showContext() {
  const window = windowNow();
  const b = breakdown({ window, usage: state.usage, system: estimateTokens(system()) });
  const paint = (i, s) => (fancy(out) ? [fg(grad(0.15), s), fg(grad(0.75), s), dim(s)][i] : s);
  out.write(`\n  ${bar(barCounts(b.parts, window), paint)}  ${share(b.used, window)} used\n`);
  const label = ['System prompt, about', 'Conversation', 'Free'];
  show(table(b.parts.map(([, n], i) => [`${FILL[i]} ${label[i]}`, `${i === 0 ? '~' : ''}${count(n)}`, share(n, window)]), ['Part', 'Tokens', 'Share']));
  note(`${count(b.used)} of ${count(window)} tokens. the system prompt is a guess: characters / 4.`);
  if (!b.measured) note(state.history.length ? 'no token counts for this chat yet, so only the system prompt is counted.' : 'no reply yet, so only the system prompt is counted.');
  if (windowIsGuess()) note(`the window size is a guess: ${count(window)}. a model that reports its window corrects it after a reply.`);
  if (state.thinking === 'explorer') note('explorer: this is its last call, not a running chat.');
  else if (state.tools) note("full access: Claude's own tools and prompt count under Conversation.");
}

function showStatus() {
  const window = windowNow();
  show(table([
    ['Model', state.model ?? 'default'],
    ['Thinking', state.thinking],
    ['Tools', state.tools ? 'on' : 'off'],
    ['Context', state.usage ? `${share(usedTokens(state.usage), window)} of ${count(window)}` : state.history.length ? 'not counted' : 'no reply yet'],
    ['Session', state.sessionId ?? 'none yet'],
    ['Voice', state.voice ? 'on' : 'off'],
  ], ['Setting', 'Value'], { left: [1] }));
}

// A line of model ids that fits the screen. opencode alone can offer a hundred.
const someModels = list => list.slice(0, 12).map(m => m.id).join(', ') + (list.length > 12 ? `, and ${list.length - 12} more` : '');

// The picker, or a typed name, over every model the CLIs and your services offer. It asks for the
// company first, then the model, so a few hundred models are two short lists. A word that names a
// family, like gemini, offers that family. The list is a day old at most, and `/model refresh` asks
// everyone again and says who could not be asked. A different model starts a fresh session,
// because a session belongs to the model that began it. The chat stays on screen. Full access is
// Claude's alone, so a model from anywhere else turns it off.
async function pickModel(arg = '') {
  const again = arg.toLowerCase() === 'refresh';
  const { models: list, errors } = await working(async () => {
    spinner?.status('asking every AI you can reach what it offers');
    return again ? refreshModels() : { models: await listModels(), errors: {} };
  });
  for (const [who, why] of Object.entries(errors)) note(`${who} could not be asked: ${fit(why.replace(/\s+/g, ' '), width() - 24)}`);
  if (again) return note(`${list.length} models from ${byMaker(list).length} companies. /model lists them`);
  let chosen;
  if (arg) {
    chosen = findModel(arg, list);
    const family = chosen ? [] : matching(arg, list);
    if (!chosen && !family.length) return note(`no model "${arg}". these are the models: ${someModels(list)}`);
    if (family.length === 1) [chosen] = family;
    else if (family.length && !fancy(out)) return note(`${family.length} models have "${arg}" in their name: ${someModels(family)}`);
    else if (family.length && !(chosen = await pickFrom(family))) return note('menu closed');
    if (chosen.id.toLowerCase() !== arg.toLowerCase()) note(`${arg} → ${chosen.id}`);
  } else if (!fancy(out)) {
    return note(`models: ${someModels(list)}. type /model and a name`);
  } else {
    const groups = byMaker(list);
    out.write('\n');
    const rows = [...groups.map(g => [g.maker.name, makerLine(g, state.model), g.maker.color]), ['+ more AIs', 'add a key for Poe, OpenRouter, Gemini, Groq…']];
    const i = await menu(out, process.stdin, rows, { at: groups.findIndex(g => g.models.some(m => m.id === state.model)) });
    if (i < 0) return note('menu closed');
    if (i === groups.length) return setKey('');
    if (!(chosen = await pickFrom(groups[i].models))) return note('menu closed');
  }
  if (chosen.id === state.model) return note(`already on ${chosen.id}`);
  state.model = chosen.id;
  state.window = undefined;
  saveSettings({ model: chosen.id });
  if (state.tools && chosen.provider !== 'claude') {
    state.tools = false;
    note('full access works with Claude only, so tools are off');
  }
  fresh(`model: ${chosen.id}. fresh chat`);
}

// One company's models, or a family's, each in its company's colour. Null when it is closed.
async function pickFrom(list) {
  out.write('\n');
  const i = await menu(out, process.stdin, list.map(m => [nameOf(m), modelLine(m, state.model), makerOf(m).color]), { at: list.findIndex(m => m.id === state.model), nameMax: 34 });
  return i < 0 ? null : list[i];
}

async function pickThinking(arg) {
  let level;
  if (arg) {
    level = resolve(arg.toLowerCase(), LEVEL_NAMES);
    if (!level) return note(`no thinking level "${arg}". choose from: ${LEVEL_NAMES.join(', ')}`);
    if (level !== arg.toLowerCase()) note(`${arg} → ${level}`);
  } else if (!fancy(out)) {
    return note(`thinking is ${state.thinking}. choose from: ${LEVEL_NAMES.join(', ')}`);
  } else {
    out.write('\n');
    const i = await menu(out, process.stdin, LEVELS.map(([name, help]) => [name, name === state.thinking ? `${help} (now)` : help]), { at: LEVEL_NAMES.indexOf(state.thinking) });
    if (i < 0) return note('menu closed');
    level = LEVEL_NAMES[i];
  }
  if (level === state.thinking) return note(`thinking is already ${level}`);
  state.thinking = level;
  saveSettings({ thinking: level });
  fresh(`thinking: ${level}. fresh chat`);
  if (level === 'explorer' && state.tools) note('explorer works without tools, so it ignores full access');
}

// Summarizes the chat in the chat itself, which holds everything said, then moves to a fresh
// session whose first turn is that summary. The old session stays as it was until the new one
// has answered, so a failure on the way loses nothing.
async function compact() {
  if (state.thinking === 'explorer') return note('explorer only sends the last few turns, so there is nothing to compact');
  if (!state.history.length) return note('nothing to compact yet. send a message first');
  const before = state.usage ? usedTokens(state.usage) : null, old = chatSession();
  let summarizing = true;
  const done = await working(async () => {
    spinner?.status('summarizing the chat');
    const summary = await old.send(COMPACT_ASK);
    if (summary.stopped) return null;
    summarizing = false;
    spinner?.status('starting fresh');
    const next = open();
    try {
      return { summary: summary.text, next, turn: await next.send(carryPrompt(summary.text)) };
    } catch (err) {
      next.close();
      throw err;
    }
  }, () => summarizing && old.interrupt());
  if (!done) return note('stopped. the chat is as it was');
  dropSession();
  session = done.next;
  state.sessionId = done.turn.sessionId;
  state.usage = hasUsage(done.turn.usage) ? done.turn.usage : null;
  rememberWindow(done.turn.contextWindow ?? done.turn.usage?.contextWindow);
  note('kept in the summary:');
  show(done.summary);
  show(table([['Before', before == null ? 'unknown' : count(before)], ['After', state.usage ? count(usedTokens(state.usage)) : 'unknown']], ['Context', 'Tokens']));
}

// A goal becomes a short plan: one tiny first action, then steps of at most 25 minutes.
// Alone, /plan shows the newest saved plan, and only makes one from the last message when
// there is none yet. `/plan last` makes one from the last message.
async function studyPlan(arg = '') {
  let goal = /^(this|last)$/i.test(arg) ? state.history.at(-1)?.q : arg;
  if (!goal) {
    const newest = latestFile('plans');
    if (newest) { show(newest.text); return note(`saved: ${newest.path}`); }
    goal = state.history.at(-1)?.q;
    if (!goal) return note('no plan yet. type /plan and what you want to learn');
  }
  const ctl = new AbortController();
  let made;
  try {
    made = await working(() => side(planPrompt(goal), { system: PLAN_SYSTEM, signal: ctl.signal }), () => { ctl.abort(); return true; });
  } catch (err) {
    if (err.name === 'AbortError') return note('stopped');
    throw err;
  }
  const plan = parsePlan(made.text, goal.slice(0, 80));
  const text = planMarkdown(plan, today());
  const path = saveFile('plans', `${today()}-${slug(plan.goal)}`, text);
  show(text);
  note(`saved: ${path}`);
}

function exportChat() {
  if (!state.history.length) return note('nothing to export yet');
  const text = chatMarkdown(state.history, { date: today(), model: state.model, thinking: state.thinking, session: state.sessionId });
  note(`saved: ${saveFile('exports', `${today()}-${slug(state.history[0].q)}`, text)}`);
}

async function copyLast() {
  if (!state.last) return note('nothing to copy yet');
  await copy(state.last);
  note(`copied the last reply (${words(state.last)} words)`);
}

// The voice chat's text can arrive at any moment, so it is written over the prompt line and the
// prompt is drawn again under it, with whatever was being typed. While a typed reply is being
// written, it is the waiting line that goes back under the text, as it does for the reply itself.
const aside = write => {
  if (rl.closed) return;
  out.write(`\r${ESC}2K`);
  write();
  if (busy) spinner?.redraw();
  else rl.prompt(true);
};

// ChatGPT voice is its own chat, beside the typed one: the microphone goes to OpenAI, the reply is
// spoken and shown here, and each exchange joins the chat for /export and /copy. Typed messages
// still go to the model chosen with /model.
function voiceChat() {
  // Stopping reports through onEnd below, which says it is off.
  if (voice) return voice.stop();
  const key = openaiKey();
  if (!key) return note(NO_KEY);
  let reply = null;
  voice = openVoice({
    key,
    screen: {
      user: text => aside(() => out.write(soft(`  you said: ${fit(text.replace(/\s+/g, ' '), width())}`) + '\n\n')),
      reply: (delta, done) => {
        if (delta) {
          if (!reply) {
            aside(() => out.write('\n'));
            reply = view(line => aside(() => out.write(line + '\n')));
          }
          reply.push(delta);
        }
        if (done && reply) {
          reply.end();
          reply = null;
          aside(() => out.write('\n'));
        }
      },
      note: text => aside(() => out.write(soft(`  ${text}`) + '\n\n')),
      problem: text => aside(() => out.write(`  \x1b[31m${text}\x1b[0m\n\n`)),
    },
    onTurn: turn => {
      state.history.push(turn);
      state.last = turn.text;
    },
    onEnd: () => {
      voice = null;
      state.voice = false;
      if (!leaving) aside(() => out.write(soft('  voice off') + '\n\n'));
    },
  });
  state.voice = true;
}

// Reads a line with the letters hidden on a terminal. A pipe shows nothing anyway.
const readSecret = q => (process.stdin.isTTY ? secret(out, process.stdin, soft(q)) : nextLine(q));

// A key for any service. It is asked for with the letters hidden, so it never shows on the screen
// or in the scroll-back, and it goes straight to the Keychain, never to a file of ours. A key typed
// after the command would be on screen, so a long word that names no service is refused.
async function setKey(arg) {
  const keyed = SERVICES.filter(s => !s.local);
  let service;
  if (arg) {
    service = findService(arg, keyed);
    if (!service) {
      return note(/^\S{20,}$/.test(arg)
        ? 'type /key and a service, like /key poe. it asks for the key with the letters hidden, so the key never shows on the screen'
        : `no service "${arg}". these take a key: ${keyed.map(s => s.id).join(', ')}`);
    }
  } else if (!fancy(out)) {
    return note(`which service? type /key and one of: ${keyed.map(s => s.id).join(', ')}`);
  } else {
    out.write('\n');
    const i = await menu(out, process.stdin, keyed.map(s => [s.name, `${s.note}${keyFor(s) ? ' · connected' : ''}`]));
    if (i < 0) return note('menu closed');
    service = keyed[i];
  }
  const a = /^[aeiox]/i.test(service.name) ? 'an' : 'a';
  const typed = ((await readSecret(`  ${service.name} key from ${service.site} (hidden. Enter saves, Esc cancels): `)) ?? '').trim();
  if (!typed) return note('no key saved');
  if (/\s/.test(typed) || typed.length < 20) return note(`that does not look like ${a} ${service.name} key, so nothing was saved. a key is one long word`);
  saveKey(service.id, typed);
  // Its models join the list on the next /model.
  markStale();
  const what = service.id === 'openai' ? '/voice starts ChatGPT voice, and /model has GPT' : `/model has ${service.name}'s models`;
  note(`saved in your Mac's Keychain. ${what}${process.env[service.env]?.trim() ? `. ${service.env} is set in this shell and is used first` : ''}`);
}

const commands = {
  '!': () => flagLast('!'),
  '/help': helpScreen,
  '/new': () => fresh('fresh chat'),
  '/clear': () => fresh('fresh chat'),
  '/resume': resumeChat,
  '/compact': compact,
  '/plan': studyPlan,
  '/export': exportChat,
  '/copy': copyLast,
  '/model': pickModel,
  '/think': pickThinking,
  '/context': showContext,
  '/status': showStatus,
  // A session that used tools can't carry on without them, so switching starts a fresh chat.
  // Full access is Claude's alone.
  '/tools': () => {
    if (!state.tools && providerOf(state.model) !== 'claude') return note(`full access works with Claude only, not ${state.model}. /model picks a Claude model first`);
    state.tools = !state.tools;
    fresh(state.tools ? 'full access on. fresh chat' : 'tools off, chat only. fresh chat');
  },
  '/test': readingTest,
  '/stats': () => show(table(summarize({ chats: rows('chats.jsonl'), tests: rows('tests.jsonl'), flags: rows('flags.jsonl') }))),
  '/profile': () => (readProfile() ? show(readProfile()) : note('no rules yet. type ! after a reply that tripped you')),
  '/color': () => { nextPalette(); rl.setPrompt(promptGlyph(out)); out.write('\n' + swatch(palette()) + '\n\n'); },
  '/brain': () => brainScreen(out, nextLine(''), 'press Enter to go back'),
  '/calm': () => note(`motion ${(state.calm = !state.calm) ? 'off' : 'on'}`),
  '/pliny': () => note(`pliny mode ${(state.pliny = !state.pliny) ? 'on: 7h3 0n3 7ru3 l33t' : 'off'}`),
  '/voice': voiceChat,
  '/key': setKey,
  '/exit': () => rl.close(),
};

async function command(msg) {
  if (msg === '/') {
    out.write('\n');
    const i = await menu(out, process.stdin, MENU);
    return i < 0 ? note('menu closed') : commands[MENU[i][0]]();
  }
  const word = msg.split(/\s+/)[0], typed = word.toLowerCase();
  const name = resolve(typed, Object.keys(commands).filter(n => n !== '!'));
  if (!name) return note(`no command "${typed}". press / then Enter for the menu`);
  if (name !== typed) note(`${typed} → ${name}`);
  return commands[name](msg.slice(word.length).trim());
}

// Lines that arrive in one burst (a paste) become one message, unless the burst starts with a
// command. A paste can land in several chunks, so lines within 40 ms of each other count as
// one burst: no one types two lines that fast.
let queue = [], draining = false, burstTimer = null;
rl.on('line', line => {
  if (waiter) { const w = waiter; waiter = null; return w(line); }
  queue.push(line);
  if (draining) return;
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => { draining = true; drain(); }, 40);
});

async function drain() {
  while (queue.length) {
    const burst = queue;
    queue = [];
    const first = burst[0].trim();
    const msgs = /^[/!]/.test(first) ? burst.map(l => l.trim()) : [burst.join('\n').trim()];
    for (const msg of msgs) {
      if (!msg) continue;
      try {
        if (msg.startsWith('!')) await flagLast(msg);
        else if (msg.startsWith('/')) await command(msg);
        else await chat(msg);
      } catch (err) {
        out.write(`  \x1b[31m${err.message}\x1b[0m\n\n`);
      }
    }
  }
  draining = false;
  if (rl.closed) return;
  rl.prompt();
  // Keys typed while a reply ran go in now, as if typed at this prompt.
  const keys = held;
  held = [];
  for (const [s, k] of keys) for (const l of lineKeys) l(s, k);
}
rl.on('close', () => { out.write('\n'); process.exit(0); });
if (latest) showLast(latest);
rl.prompt();
