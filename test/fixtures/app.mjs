import { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = fileURLToPath(new URL('../../bin/dyslexic-mode.mjs', import.meta.url));
export const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
export const FAKE_GROK = fileURLToPath(new URL('./fake-grok.mjs', import.meta.url));
export const FAKE_OPENCODE = fileURLToPath(new URL('./fake-opencode.mjs', import.meta.url));
export const FAKE_PBCOPY = fileURLToPath(new URL('./fake-pbcopy.mjs', import.meta.url));
export const wait = ms => new Promise(r => setTimeout(r, ms));
// A failed check leaves its app running, and a live child keeps the test file from ending.
const children = new Set();
after(() => { for (const c of children) c.kill(); });

const lines = log => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// The fake claude logs a line as it starts, a moment after the app asks for it. This waits for
// `n` lines and returns all of them. Only claude's own lines count: the fake grok and opencode
// write to the same log, and have their own readers below.
export async function launches(log, n) {
  const read = () => lines(log).filter(l => 'bridge' in l);
  for (let i = 0; i < 300 && read().length < n; i++) await wait(20);
  return read();
}
// One line per reply the fake grok answered, and one per server the fake opencode started.
export const grokLaunches = log => lines(log).filter(l => l.argv?.some(a => a.startsWith('--single=')));
export const opencodeLaunches = log => lines(log).filter(l => l.argv?.[0] === 'serve');
export const argAfter = (launch, name) => launch.argv[launch.argv.indexOf(name) + 1];
// A launch that kept the chat in one process, as opposed to a one-shot call.
export const isChat = launch => launch.argv.includes('--input-format');

// The whole app with piped input and fake claude, grok and opencode CLIs, so nothing real is
// started and nothing real is read: not their lists, not their settings, not the Keychain.
// Lines go in one at a time, each after the output it waits for, the way a person would type them.
// `env` adds to the fakes' settings, and `noTools: false` leaves out the --no-tools that keeps a
// test from starting in full access.
export function run(args, home, log, env = {}, { noTools = true } = {}) {
  const fakes = join(dirname(home), 'fakes');
  mkdirSync(join(fakes, 'grok-state'), { recursive: true });
  mkdirSync(join(fakes, 'grok-home'), { recursive: true });
  writeFileSync(join(fakes, 'grok-home', 'models_cache.json'), JSON.stringify({ models: { 'grok-4.7': { info: { context_window: 256000 } } } }));
  const child = spawn(process.execPath, [APP, '--calm', ...(noTools ? ['--no-tools'] : []), ...args], {
    env: {
      ...process.env,
      DYSLEXIC_CLAUDE_BIN: FAKE,
      DYSLEXIC_GROK_BIN: FAKE_GROK,
      DYSLEXIC_OPENCODE_BIN: FAKE_OPENCODE,
      GROK_HOME: join(fakes, 'grok-home'),
      FAKE_STATE: join(fakes, 'grok-state'),
      FAKE_OC_STATE: join(fakes, 'opencode-state.json'),
      DYSLEXIC_MODE_HOME: home,
      FAKE_LOG: log,
      NO_COLOR: '1',
      ...env,
    },
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
  return { type: line => child.stdin.write(line + '\n'), until, closed, out: () => out, kill: signal => child.kill(signal) };
}
