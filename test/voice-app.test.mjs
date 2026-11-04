import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, wait } from './fixtures/app.mjs';
import { NO_KEY } from '../lib/voicechat.mjs';

// The app against a fake Keychain, a fake microphone and a fake OpenAI socket: nothing here reaches
// the real Keychain, opens a microphone, makes a sound or touches the network.
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
// Not a credential. The tests only check where it goes and that it never shows.
const KEY = 'FAKE-KEY-FOR-TESTS-0123456789';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-voice-app-'));
  // The fake tools sit first on the app's PATH under the names the app looks for.
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const name of ['security', 'ffmpeg', 'ffplay']) symlinkSync(fixture(`fake-${name}.mjs`), join(bin, name));
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    OPENAI_API_KEY: '',
    FAKE_KEYCHAIN: join(dir, 'keychain.json'),
    FAKE_SECURITY_LOG: join(dir, 'security.log'),
    FAKE_MIC_PID: join(dir, 'mic.pid'),
    NODE_OPTIONS: `--import=${fixture('fake-websocket.mjs')}`,
  };
  return { dir, home: join(dir, 'home'), log: join(dir, 'argv'), env, keychain: env.FAKE_KEYCHAIN, mic: env.FAKE_MIC_PID };
}
const withKey = t => writeFileSync(t.keychain, JSON.stringify({ 'dyslexic-mode/openai': KEY }));
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sockets = log => lines(log).filter(l => 'ws' in l);

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// The fake microphone is a process that takes a moment to start.
async function micPid(file) {
  for (let i = 0; i < 100 && !existsSync(file); i++) await wait(20);
  return Number(readFileSync(file, 'utf8'));
}
async function gone(pid) {
  for (let i = 0; i < 100 && alive(pid); i++) await wait(20);
  return !alive(pid);
}
const filesUnder = dir => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)])) : []);

test('with no key, /voice says how to add one in one line and starts nothing', async () => {
  const t = setup();
  const app = run([], t.home, t.log, t.env);
  app.type('/voice');
  await app.until(/ChatGPT voice needs an OpenAI key\. Type \/key openai to add it\. It is saved in your Mac's Keychain, never in a file\.\n/);
  assert.equal(NO_KEY, "ChatGPT voice needs an OpenAI key. Type /key openai to add it. It is saved in your Mac's Keychain, never in a file.");
  app.type('/status');
  await app.until(/Voice +│ +off/);
  app.type('/exit');
  await app.closed;
  assert.deepEqual(sockets(t.log), [], 'no connection was made');
  assert.ok(!existsSync(t.mic), 'no microphone was started');
});

test('/key openai takes the key without showing it, saves it to the Keychain once, and writes it to no file of ours', async () => {
  const t = setup();
  const app = run([], t.home, t.log, t.env);
  app.type('/key openai');
  await app.until(/OpenAI key from platform\.openai\.com\/api-keys \(hidden\. Enter saves, Esc cancels\): /);
  app.type(KEY);
  await app.until(/saved in your Mac's Keychain\. \/voice starts ChatGPT voice, and \/model has GPT\n/);
  app.type('/exit');
  await app.closed;
  assert.ok(!app.out().includes(KEY), 'the key is never printed');
  assert.deepEqual(JSON.parse(readFileSync(t.keychain, 'utf8')), { 'dyslexic-mode/openai': KEY });
  const calls = lines(t.env.FAKE_SECURITY_LOG);
  assert.deepEqual(calls.filter(c => c[0] === 'add-generic-password'), [['add-generic-password', '-U', '-s', 'dyslexic-mode', '-a', 'openai', '-w', KEY]]);
  for (const file of filesUnder(t.home)) assert.ok(!readFileSync(file, 'utf8').includes(KEY), file);
});

test('/key with a service name saves that service\'s key under its own name', async () => {
  const t = setup();
  const app = run([], t.home, t.log, t.env);
  app.type('/key');
  await app.until(/which service\? type \/key and one of: poe, openrouter, openai, gemini, xai/);
  app.type('/key open router');
  await app.until(/OpenRouter key from openrouter\.ai\/keys \(hidden/);
  app.type(KEY);
  await app.until(/saved in your Mac's Keychain\. \/model has OpenRouter's models\n/);
  app.type('/exit');
  await app.closed;
  assert.deepEqual(JSON.parse(readFileSync(t.keychain, 'utf8')), { 'dyslexic-mode/openrouter': KEY });
  assert.ok(!app.out().includes(KEY));
});

test('/key refuses a key typed after the command, an empty line and something that is not a key, and saves nothing', async () => {
  const t = setup();
  const app = run([], t.home, t.log, t.env);
  app.type(`/key ${KEY}`);
  await app.until(/type \/key and a service, like \/key poe\. it asks for the key with the letters hidden, so the key never shows on the screen/);
  app.type('/key nowhere');
  await app.until(/no service "nowhere"\. these take a key: poe, openrouter/);
  app.type('/key openai');
  await app.until(/OpenAI key from [^ ]+ \(hidden/);
  app.type('');
  await app.until(/no key saved/);
  app.type('/key openai');
  await app.until(/(OpenAI key from [^ ]+ \(hidden[\s\S]*){2}/);
  app.type('too short');
  await app.until(/that does not look like an OpenAI key, so nothing was saved\. a key is one long word/);
  app.type('/key openai');
  await app.until(/(OpenAI key from [^ ]+ \(hidden[\s\S]*){3}/);
  app.type(`${KEY} and more words after it`);
  await app.until(/(does not look like an OpenAI key[\s\S]*){2}/);
  app.type('/exit');
  await app.closed;
  assert.ok(!existsSync(t.keychain), 'nothing reached the Keychain');
  assert.ok(!app.out().includes(KEY));
});

test('/key says when a key in the environment will be used before the one it saved', async () => {
  const t = setup();
  const app = run([], t.home, t.log, { ...t.env, OPENAI_API_KEY: 'FAKE-ENV-KEY-0123456' });
  app.type('/key openai');
  await app.until(/OpenAI key from [^ ]+ \(hidden/);
  app.type(KEY);
  await app.until(/saved in your Mac's Keychain\. \/voice starts ChatGPT voice, and \/model has GPT\. OPENAI_API_KEY is set in this shell and is used first/);
  app.type('/exit');
  await app.closed;
});

test('/voice with a key opens the socket with the key in a header, shows both sides as text, and /voice again lets the microphone go', async () => {
  const t = setup();
  withKey(t);
  const app = run([], t.home, t.log, t.env);
  app.type('/voice');
  await app.until(/voice is on\. wear headphones and say something\. \/voice stops it/);
  await app.until(/you said: what is a verb\n[\s\S]*A verb is an action word\.\n/);
  app.type('/status');
  await app.until(/Voice +│ +on/);
  const [socket] = sockets(t.log);
  assert.deepEqual(socket, { ws: 'wss://api.openai.com/v1/realtime?model=gpt-realtime', authorization: `Bearer ${KEY}` });
  assert.ok(lines(t.log).some(l => l.sent === 'session.update'), 'the session was set up');
  assert.ok(!app.out().includes(KEY));
  // The microphone is running until the chat is turned off.
  const pid = await micPid(t.mic);
  assert.ok(alive(pid));
  app.type('/voice');
  await app.until(/voice off\n/);
  assert.ok(await gone(pid), 'the microphone process is gone');
  app.type('/status');
  await app.until(/Voice +│ +on[\s\S]*Voice +│ +off/);
  // The exchange joined the chat, so it is in the export.
  app.type('/export');
  await app.until(/saved: .*\/exports\//);
  app.type('/exit');
  await app.closed;
  const [file] = readdirSync(join(t.home, 'exports'));
  assert.match(readFileSync(join(t.home, 'exports', file), 'utf8'), /> what is a verb\n[\s\S]*A verb is an action word\./);
});

test('leaving the app lets the microphone go', async () => {
  const t = setup();
  withKey(t);
  const app = run([], t.home, t.log, t.env);
  app.type('/voice');
  await app.until(/you said: what is a verb/);
  const pid = await micPid(t.mic);
  assert.ok(alive(pid));
  app.type('/exit');
  await app.closed;
  assert.ok(await gone(pid), 'the microphone process is gone with the app');
});

test('a closed terminal or a kill lets the microphone go too', async () => {
  for (const signal of ['SIGHUP', 'SIGTERM']) {
    const t = setup();
    withKey(t);
    const app = run([], t.home, t.log, t.env);
    app.type('/voice');
    await app.until(/you said: what is a verb/);
    const pid = await micPid(t.mic);
    assert.ok(alive(pid));
    app.kill(signal);
    await app.closed;
    assert.ok(await gone(pid), `the microphone process is gone after ${signal}`);
  }
});

test('a connection that fails says why, once, and the voice chat is off', async () => {
  const t = setup();
  withKey(t);
  const app = run([], t.home, t.log, { ...t.env, FAKE_WS_FAIL: '1' });
  app.type('/voice');
  await app.until(/the voice connection failed \(unauthorized\)\. Check the key and the network\.\x1b\[0m\n[\s\S]*voice off\n/);
  app.type('/status');
  await app.until(/Voice +│ +off/);
  app.type('/exit');
  await app.closed;
  assert.ok(!existsSync(t.mic), 'the microphone is only started once the connection is open');
  assert.ok(!app.out().includes(KEY));
  assert.equal(statSync(t.home).isDirectory(), true);
});
