#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { ask } from '../lib/claude.mjs';
import { reply } from '../lib/filter.mjs';
import { systemPrompt } from '../lib/prompt.mjs';
import { plinyfy } from '../lib/pliny.mjs';
import { intro, thinking, render, dim, fancy } from '../lib/anim.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const state = {
  pliny: flag('pliny'),
  calm: flag('calm'),
  model: argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : undefined,
  sessionId: undefined,
};
const system = systemPrompt();
const out = process.stdout;
process.on('exit', () => out.write('\x1b[?25h'));

if (!state.calm) await intro(out);
else out.write('\n  DYSLEXIC MODE\n\n');

const rl = createInterface({ input: process.stdin, output: out, prompt: fancy(out) ? '\x1b[35m›\x1b[0m ' : '> ' });

const commands = {
  '/pliny': () => { state.pliny = !state.pliny; return `pliny mode ${state.pliny ? 'on: 7h3 0n3 7ru3 l33t' : 'off'}`; },
  '/calm': () => { state.calm = !state.calm; return `motion ${state.calm ? 'off' : 'on'}`; },
  '/new': () => { state.sessionId = undefined; return 'fresh chat'; },
  '/exit': () => { rl.close(); },
};

rl.on('line', async line => {
  const msg = line.trim();
  if (!msg) return rl.prompt();
  if (msg.startsWith('/')) {
    const run = commands[msg.split(/\s+/)[0]];
    const note = run ? run() : `unknown command: ${msg}`;
    if (note) out.write(dim(`  ${note}`) + '\n\n');
    return rl.closed || rl.prompt();
  }
  rl.pause();
  out.write('\n');
  const stop = thinking(out);
  try {
    const r = await reply(ask, msg, { system, sessionId: state.sessionId, model: state.model });
    stop();
    state.sessionId = r.sessionId;
    await render(out, state.pliny ? plinyfy(r.text) : r.text, { calm: state.calm });
    const check = r.hard ? `${r.hard} hard hit left` : 'clean';
    out.write('\n' + dim(`  re-read: ${r.rewrites ? '1 rewrite, ' : ''}${check}`) + '\n\n');
  } catch (err) {
    stop();
    out.write(`  \x1b[31m${err.message}\x1b[0m\n\n`);
  }
  rl.resume();
  rl.prompt();
});
rl.on('close', () => { out.write('\n'); process.exit(0); });
rl.prompt();
