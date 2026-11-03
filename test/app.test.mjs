import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../bin/dyslexic-mode.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
// A failed check leaves its app running, and a live child keeps the test file from ending.
const children = new Set();
after(() => { for (const c of children) c.kill(); });

// The whole app with piped input and a fake claude. Lines go in one at a time, each after
// the output it waits for, the way a person would type them.
function run(args, home, log) {
  const child = spawn(process.execPath, [APP, '--calm', '--no-tools', ...args], {
    env: { ...process.env, DYSLEXIC_CLAUDE_BIN: FAKE, DYSLEXIC_MODE_HOME: home, FAKE_LOG: log, NO_COLOR: '1' },
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

test('a chat streams its reply, logs it, and the numbers show in a table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-app-')), home = join(dir, 'home'), log = join(dir, 'argv');
  const app = run([], home, log);
  app.type('hello there');
  await app.until(/echo: hello there[\s\S]*re-read clean/);
  app.type('/stats');
  await app.until(/│ Replies +│ +1 │/);
  app.type('/exit');
  await app.closed;
  const [row] = readFileSync(join(home, 'chats.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(row.session, 'sess-1');
  assert.equal(row.q, 'hello there');
  assert.equal(row.text, 'echo: hello there');
  assert.ok(row.first >= 0 && row.ms >= row.first);
  const launches = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(launches.length, 1, 'one claude process for the whole chat');
});

test('-c comes back to the last chat: its reply is shown and claude resumes the session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-app-')), home = join(dir, 'home'), log = join(dir, 'argv');
  const first = run([], home, log);
  first.type('remember this');
  await first.until(/re-read clean/);
  first.type('/exit');
  await first.closed;
  const again = run(['-c'], home, log);
  await again.until(/back in: remember this \(1 reply\)[\s\S]*echo: remember this/);
  again.type('and now');
  await again.until(/echo: and now/);
  again.type('/exit');
  await again.closed;
  const launches = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(launches.at(-1).argv[launches.at(-1).argv.indexOf('--resume') + 1], 'sess-1');
});

test('pliny mode wraps the streamed reply in dividers and swaps letters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-app-')), home = join(dir, 'home');
  const app = run(['--pliny'], home, join(dir, 'argv'));
  app.type('hello');
  await app.until(/D Y 5 L 3 X 1 C[\s\S]*3ch0: h3ll0[\s\S]*D Y 5 L 3 X 1 C/);
  app.type('/exit');
  await app.closed;
});

test('a typo runs the command it meant, and an unknown one points at the menu', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-app-')), home = join(dir, 'home');
  const app = run([], home, join(dir, 'argv'));
  app.type('/proflie');
  await app.until(/\/proflie → \/profile[\s\S]*no rules yet/);
  app.type('/zzzz');
  await app.until(/no command "\/zzzz"/);
  app.type('/exit');
  await app.closed;
  assert.ok(!existsSync(join(home, 'chats.jsonl')), 'no chat happened');
});
