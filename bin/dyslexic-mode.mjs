#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { ask, toolLine } from '../lib/claude.mjs';
import { reply } from '../lib/filter.mjs';
import { systemPrompt } from '../lib/prompt.mjs';
import { plinyfy } from '../lib/pliny.mjs';
import { learn } from '../lib/learn.mjs';
import { append, rows, readProfile } from '../lib/store.mjs';
import { summarize, table } from '../lib/stats.mjs';
import { TARGET, questionFor, order, pickOf, PLAIN_SYSTEM, words } from '../lib/readtest.mjs';
import { MENU, resolve } from '../lib/commands.mjs';
import { setPalette, randomPalette, nextPalette, palette } from '../lib/palette.mjs';
import { intro, thinking, render, dim, fancy, brainScreen, menu, promptGlyph, swatch } from '../lib/anim.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = name => (flag(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const state = {
  pliny: flag('pliny'),
  calm: flag('calm'),
  tools: !flag('no-tools'),
  model: opt('model'),
  sessionId: undefined,
  last: null,
};
if (opt('palette')) setPalette(opt('palette'));
else randomPalette();
// Built per turn, so a rule learned a moment ago shapes the very next reply.
const system = (tools = state.tools) => systemPrompt({ profile: readProfile(), tools });
const out = process.stdout;
process.on('exit', () => out.write('\x1b[?25h'));

if (!state.calm) await intro(out);
else out.write('\n  DYSLEXIC MODE\n\n  press / then Enter for the menu.\n\n');
out.write(dim(state.tools ? '  full access: files, shell, web, your skills, Claude agents, Codex' : '  chat only: tools are off') + '\n\n');

const rl = createInterface({ input: process.stdin, output: out, prompt: promptGlyph(out) });
const note = s => out.write(dim(`  ${s}`) + '\n\n');
const clear = () => out.write('\x1b[2J\x1b[H');
const show = async text => { out.write('\n'); await render(out, text, { calm: true }); out.write('\n'); };

// A test round needs input in the middle of a command, so a line goes to whoever waits for it.
let waiter = null, spinner = null;
const nextLine = q => new Promise(res => { waiter = res; out.write(q); rl.resume(); });
const onTool = block => spinner?.status(toolLine(block));

async function working(fn) {
  rl.pause();
  spinner = thinking(out, { calm: state.calm });
  try { return await fn(); } finally { spinner(); spinner = null; }
}

async function chat(msg) {
  out.write('\n');
  const r = await working(() => reply(ask, msg, { system: system(), sessionId: state.sessionId, model: state.model, tools: state.tools, onTool }));
  state.sessionId = r.sessionId;
  state.last = r.text;
  append('chats.jsonl', { ts: Date.now(), rewrites: r.rewrites, hard: r.hard, words: words(r.text), tools: state.tools });
  await render(out, state.pliny ? plinyfy(r.text) : r.text, { calm: state.calm });
  out.write('\n');
  note(`re-read: ${r.rewrites ? '1 rewrite, ' : ''}${r.hard ? `${r.hard} hard hit left` : 'clean'}    ! if it tripped you`);
}

async function flagLast(msg) {
  if (!state.last) return note('nothing to flag yet');
  const typed = msg.slice(1).trim() || (await nextLine(dim('  what tripped you? Enter to skip: '))).trim();
  const rules = await working(() => learn(ask, { reply: state.last, note: typed || undefined }));
  note(`learned. your profile has ${rules.length} rule${rules.length === 1 ? '' : 's'}. /profile to see them`);
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
    // No motion here: the settle animation would add time to one answer and not the other.
    await render(out, text[kind], { calm: true });
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

const commands = {
  '!': () => flagLast('!'),
  '/brain': () => brainScreen(out, nextLine(''), 'press Enter to go back'),
  '/color': () => { nextPalette(); rl.setPrompt(promptGlyph(out)); out.write('\n' + swatch(palette()) + '\n\n'); },
  '/test': readingTest,
  '/stats': () => show(table(summarize({ chats: rows('chats.jsonl'), tests: rows('tests.jsonl'), flags: rows('flags.jsonl') }))),
  '/profile': () => (readProfile() ? show(readProfile()) : note('no rules yet. type ! after a reply that tripped you')),
  // A session that used tools can't carry on without them, so switching starts a fresh chat.
  '/tools': () => {
    state.tools = !state.tools;
    state.sessionId = undefined;
    state.last = null;
    note(state.tools ? 'full access on. fresh chat' : 'tools off, chat only. fresh chat');
  },
  '/new': () => { state.sessionId = undefined; state.last = null; note('fresh chat'); },
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
// command. Lines typed while a turn runs wait in the queue for their turn instead of vanishing.
// A paste can land in several chunks, so lines within 40 ms of each other count as one burst:
// no one types two lines that fast.
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
  if (!rl.closed) { rl.resume(); rl.prompt(); }
}
rl.on('close', () => { out.write('\n'); process.exit(0); });
rl.prompt();
