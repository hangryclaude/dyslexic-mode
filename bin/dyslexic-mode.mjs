#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { ask, toolLine } from '../lib/claude.mjs';
import { openSession } from '../lib/session.mjs';
import { reply } from '../lib/filter.mjs';
import { systemPrompt } from '../lib/prompt.mjs';
import { leet, DIVIDER } from '../lib/pliny.mjs';
import { learn } from '../lib/learn.mjs';
import { append, rows, readProfile, readSettings, saveSettings, sessions } from '../lib/store.mjs';
import { summarize, table } from '../lib/stats.mjs';
import { TARGET, questionFor, order, pickOf, PLAIN_SYSTEM, words } from '../lib/readtest.mjs';
import { MENU, resolve } from '../lib/commands.mjs';
import { setPalette, randomPalette, nextPalette, palette } from '../lib/palette.mjs';
import { intro, thinking, brainScreen, menu, promptGlyph, swatch } from '../lib/anim.mjs';
import { ESC, dim, fancy } from '../lib/style.mjs';
import { stream } from '../lib/render.mjs';
import { readInPlace, readerView } from '../lib/reader.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = name => (flag(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const saved = readSettings();
const state = {
  pliny: flag('pliny'),
  calm: flag('calm'),
  // Full access skips every permission prompt, so a stranger who installs this must opt in.
  tools: flag('full') && !flag('no-tools'),
  model: opt('model'),
  // Read every reply aloud. It and the speed are kept between launches.
  aloud: saved.aloud ?? false,
  rate: Number(opt('rate')) || saved.rate || 180,
  voice: opt('voice') ?? saved.voice,
  sessionId: undefined,
  last: null,
  // Where the last reply sits on screen, so Tab can light up its words in place.
  shown: null,
};
if (opt('palette')) setPalette(opt('palette'));
else randomPalette();
const out = process.stdout;
let speech = null, session = null;
process.on('exit', () => { speech?.stop(); session?.close(); if (out.isTTY) out.write(`${ESC}?25h`); });

const width = () => Math.min((out.columns || 80) - 4, Number(opt('width')) || 72);
const view = write => stream(write, { width: width(), columns: out.columns || 80, styled: fancy(out), transform: state.pliny ? leet : undefined });
const fit = (s, max) => (s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s);
const newlines = s => (s.match(/\n/g) || []).length;
// Quiet text is dimmed on a terminal and plain anywhere else, like a pipe or a log.
const soft = s => (fancy(out) ? dim(s) : s);
const ago = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// The chat's claude process. A running process can't change its system prompt, so a new
// rule or a tools switch drops it, and the next turn resumes the same session in a new one.
const system = (tools = state.tools) => systemPrompt({ profile: readProfile(), tools });
const chatSession = () => (session ??= openSession({ system: system(), model: state.model, tools: state.tools, resume: state.sessionId }));
const dropSession = () => { session?.close(); session = null; };

const latest = argv.includes('-c') || flag('continue') ? sessions()[0] : null;
if (latest) { state.sessionId = latest.id; state.tools = latest.tools ?? state.tools; }
// Claude starts while the intro plays, so the first reply skips the start-up wait.
chatSession().warm();

if (!state.calm) await intro(out);
else out.write('\n  DYSLEXIC MODE\n\n  press / then Enter for the menu.\n\n');
out.write(soft(state.tools ? '  full access: files, shell, web, your skills, Claude agents, Codex' : '  chat only: tools are off') + '\n');
out.write(soft(`  tab reads a reply aloud. esc stops a reply.${state.aloud ? ' voice is on.' : ''}`) + '\n\n');

const rl = createInterface({ input: process.stdin, output: out, prompt: promptGlyph(out) });
const note = s => out.write(soft(`  ${s}`) + '\n\n');
// A note while the prompt is up goes above it, and what is typed so far stays.
const tell = s => {
  out.write(`\r${ESC}2K`);
  note(s);
  if (state.shown) state.shown.below += 2;
  rl.prompt(true);
};
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
  if (key.name === 'escape' && speech) return stopSpeech();
  if (key.name === 'tab' && !rl.line && !waiter) return readTab();
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
  const s = chatSession();
  const r = await working(() => reply((p, o) => s.send(p, o), msg, {
    onText: d => v.push(d),
    onTool: b => { v.mark(); spinner?.status(toolLine(b)); },
    onRewrite: hard => spinner?.status(`tidying ${hard.length} trip point${hard.length === 1 ? '' : 's'}`),
  }), () => s.interrupt());
  let shown = v.end();
  state.sessionId = r.sessionId;
  if (r.stopped) {
    // What came in before Esc stays on screen, so Tab reads it and ! flags it.
    const tail = '\n' + soft('  stopped') + '\n\n';
    out.write(tail);
    if (r.text.trim()) { state.last = r.text; state.shown = { ...shown, below: 1 + newlines(tail) }; }
    return;
  }
  if (r.rewrites) shown = swapDraft(shown, r.text);
  state.last = r.text;
  const ms = Date.now() - t0;
  append('chats.jsonl', { ts: Date.now(), session: r.sessionId, q: msg.slice(0, 300), text: r.text, rewrites: r.rewrites, hard: r.hard, words: words(r.text), tools: state.tools, ms, first });
  const check = r.hard ? `${r.hard} hard hit left` : r.rewrites ? 'tidied once' : 're-read clean';
  const tail = `${state.pliny ? `\n  ${DIVIDER}\n` : ''}\n` + soft(fit(`  ${(ms / 1000).toFixed(1)}s · ${check} · ! if it tripped you · tab reads it aloud`, (out.columns || 80) - 1)) + '\n\n';
  out.write(tail);
  state.shown = { ...shown, below: 1 + newlines(tail) };
  if (state.aloud) startSpeech();
}

// The rewrite takes the draft's place when the whole draft is still on screen. Otherwise it
// goes below, so nothing jumps out of view while it is being read.
function swapDraft(shown, text) {
  const draft = shown.lines.slice(shown.from).reduce((n, l) => n + l.rows, 0);
  if (fancy(out) && draft > 0 && draft + 2 < (out.rows || 24)) out.write(`${ESC}${draft}A\r${ESC}J`);
  else note('tidier version:');
  const v = view(l => out.write(l + '\n'));
  v.push(text);
  return v.end();
}

function startSpeech() {
  if (!state.shown?.units.length) return false;
  stopSpeech();
  const sp = readInPlace(out, state.shown, { cursorRows: () => rl.getCursorPos().rows, rate: state.rate, voice: state.voice });
  speech = sp;
  sp.done.then(() => { if (speech === sp) speech = null; }, err => { if (speech === sp) { speech = null; tell(err.message); } });
  return true;
}
const stopSpeech = () => { speech?.stop(); speech = null; };

// Tab reads the last reply where it stands, or full screen once other output has moved it.
function readTab() {
  if (speech) return stopSpeech();
  if (startSpeech()) return;
  if (state.last) return readFull();
  tell('nothing to read aloud yet');
}

async function readFull() {
  if (!state.last) return note('nothing to read aloud yet');
  stopSpeech();
  const { rate } = await readerView(out, process.stdin, state.last, { rate: state.rate, voice: state.voice, width: width() });
  if (rate !== state.rate) saveSettings({ rate: (state.rate = rate) });
}

async function flagLast(msg) {
  if (!state.last) return note('nothing to flag yet');
  const typed = msg.slice(1).trim() || (await nextLine(soft('  what tripped you? Enter to skip: '))).trim();
  const rules = await working(() => learn(ask, { reply: state.last, note: typed || undefined }));
  dropSession();
  chatSession().warm();
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
  // A session keeps the tools it started with, so going back can switch them.
  if (s.tools != null && s.tools !== state.tools) {
    state.tools = s.tools;
    note(s.tools ? 'that chat had full access, so full access is on' : 'that chat was chat only, so tools are off');
  }
  chatSession().warm();
  showLast(s);
}

// Back in an old chat, its last reply is shown again, ready for Tab.
function showLast(s) {
  state.last = s.last.text;
  note(`back in: ${fit((s.first ?? '').replace(/\s+/g, ' '), 50)} (${s.turns} repl${s.turns === 1 ? 'y' : 'ies'}). the last one:`);
  out.write(soft(`  › ${fit(s.last.q.replace(/\s+/g, ' '), width())}`) + '\n\n');
  const v = view(l => out.write(l + '\n'));
  v.push(s.last.text);
  const shown = v.end();
  const tail = '\n' + soft('  tab reads it aloud') + '\n\n';
  out.write(tail);
  state.shown = { ...shown, below: 1 + newlines(tail) };
}

// Both sides of a test run without tools: a fair race between two plain answers.
async function readingTest() {
  const round = rows('tests.jsonl').length;
  const q = questionFor(round);
  out.write('\n');
  note(`reading test, round ${round + 1} of ${TARGET}: ${q}`);
  const [plain, reread] = await working(() => Promise.all([
    ask(q, { system: PLAIN_SYSTEM, model: state.model }),
    reply(ask, q, { system: system(false), model: state.model }),
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
  chatSession().warm();
  note(msg);
};

const commands = {
  '!': () => flagLast('!'),
  '/read': readFull,
  '/voice': () => {
    saveSettings({ aloud: (state.aloud = !state.aloud) });
    note(state.aloud ? 'voice on: every reply is read aloud. esc stops it' : 'voice off. tab still reads one reply');
  },
  '/resume': resumeChat,
  '/new': () => fresh('fresh chat'),
  '/test': readingTest,
  '/stats': () => show(table(summarize({ chats: rows('chats.jsonl'), tests: rows('tests.jsonl'), flags: rows('flags.jsonl') }))),
  '/profile': () => (readProfile() ? show(readProfile()) : note('no rules yet. type ! after a reply that tripped you')),
  // A session that used tools can't carry on without them, so switching starts a fresh chat.
  '/tools': () => {
    state.tools = !state.tools;
    fresh(state.tools ? 'full access on. fresh chat' : 'tools off, chat only. fresh chat');
  },
  '/color': () => { nextPalette(); rl.setPrompt(promptGlyph(out)); out.write('\n' + swatch(palette()) + '\n\n'); },
  '/brain': () => brainScreen(out, nextLine(''), 'press Enter to go back'),
  '/calm': () => note(`motion ${(state.calm = !state.calm) ? 'off' : 'on'}`),
  '/pliny': () => note(`pliny mode ${(state.pliny = !state.pliny) ? 'on: 7h3 0n3 7ru3 l33t' : 'off'}`),
  '/exit': () => rl.close(),
};

async function command(msg) {
  if (msg === '/') {
    out.write('\n');
    const i = await menu(out, process.stdin, MENU);
    return i < 0 ? note('menu closed') : commands[MENU[i][0]]();
  }
  const typed = msg.split(/\s+/)[0].toLowerCase();
  const name = resolve(typed, Object.keys(commands).filter(n => n !== '!'));
  if (!name) return note(`no command "${typed}". press / then Enter for the menu`);
  if (name !== typed) note(`${typed} → ${name}`);
  return commands[name]();
}

// Lines that arrive in one burst (a paste) become one message, unless the burst starts with a
// command. A paste can land in several chunks, so lines within 40 ms of each other count as
// one burst: no one types two lines that fast.
let queue = [], draining = false, burstTimer = null;
rl.on('line', line => {
  // Enter moves the prompt down a row, and the last reply up one with it.
  if (state.shown) state.shown.below += 1;
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
      // Anything written now moves the last reply, so in-place reading stops and Tab falls
      // back to the full-screen reader.
      stopSpeech();
      state.shown = null;
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
