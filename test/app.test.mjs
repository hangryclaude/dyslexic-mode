import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './fixtures/app.mjs';

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
  assert.equal(row.thinking, 'off');
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

test('reading aloud is gone: /read is not a command and nothing on screen mentions it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-app-')), home = join(dir, 'home');
  const app = run([], home, join(dir, 'argv'));
  app.type('/read');
  await app.until(/no command "\/read"/);
  app.type('/exit');
  await app.closed;
  assert.doesNotMatch(app.out(), /aloud|\btab\b/i);
});
