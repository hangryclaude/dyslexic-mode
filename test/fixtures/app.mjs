import { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP = fileURLToPath(new URL('../../bin/dyslexic-mode.mjs', import.meta.url));
export const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
export const FAKE_PBCOPY = fileURLToPath(new URL('./fake-pbcopy.mjs', import.meta.url));
export const wait = ms => new Promise(r => setTimeout(r, ms));
// A failed check leaves its app running, and a live child keeps the test file from ending.
const children = new Set();
after(() => { for (const c of children) c.kill(); });

// The fake claude logs a line as it starts, a moment after the app asks for it. This waits for
// `n` lines and returns all of them.
export async function launches(log, n) {
  const read = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  for (let i = 0; i < 300 && read().length < n; i++) await wait(20);
  return read();
}
export const argAfter = (launch, name) => launch.argv[launch.argv.indexOf(name) + 1];
// A launch that kept the chat in one process, as opposed to a one-shot call.
export const isChat = launch => launch.argv.includes('--input-format');

// The whole app with piped input and a fake claude. Lines go in one at a time, each after
// the output it waits for, the way a person would type them. `env` adds to the fake's settings.
export function run(args, home, log, env = {}) {
  const child = spawn(process.execPath, [APP, '--calm', '--no-tools', ...args], {
    env: { ...process.env, DYSLEXIC_CLAUDE_BIN: FAKE, DYSLEXIC_MODE_HOME: home, FAKE_LOG: log, NO_COLOR: '1', ...env },
  });
  children.add(child);
  child.on('close', () => children.delete(child));
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const until = async re => {
    for (let i = 0; i < 300 && !re.test(out); i++) await wait(20);
    assert.match(out, re);
  };
  const closed = new Promise(r => child.on('close', r));
  return { type: line => child.stdin.write(line + '\n'), until, closed, out: () => out };
}
