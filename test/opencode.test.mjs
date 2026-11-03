import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openOpencodeSession, opencodeModels, parseOpencodeModels, parseApiModels, parseModelsDev, serverConfig, splitModel, describe, events } from '../lib/providers/opencode.mjs';
import { opencodeUsage, claudeUsage, unknownUsage } from '../lib/usage.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-opencode.mjs', import.meta.url));
let log, dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dm-oc-'));
  log = join(dir, 'log');
  process.env.FAKE_LOG = log;
  process.env.FAKE_OC_STATE = join(dir, 'state.json');
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
  delete process.env.FAKE_NO_SERVE;
});
const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const launches = () => lines().filter(l => l.argv);
// Every chat a test opens is closed after it, so a failed assertion cannot leave a server running.
const opened = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });
const open = (o = {}) => {
  const s = openOpencodeSession({ system: 'SYS', model: 'opencode-go/gemini-4-argon', bin: FAKE, ...o });
  opened.push(s);
  return s;
};
const gone = async pid => {
  for (let i = 0; i < 40; i++) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
};

test('text streams in as it is written, the chat is made once, and token use adds the cache and reasoning back', async () => {
  const s = open();
  const parts = [];
  const a = await s.send('hello there', { onText: t => parts.push(t) });
  assert.ok(parts.length > 1, 'more than one piece');
  assert.equal(parts.join(''), 'echo: hello there');
  assert.equal(a.text, 'echo: hello there');
  assert.equal(a.sessionId, 'ses_fake1');
  assert.equal(s.id, 'ses_fake1');
  // Turn 1: 10 fresh + 5 cache read + 1 cache write = 16 in; 17 written + 2 reasoning = 19 out.
  assert.deepEqual(a.usage, { input: 16, output: 19, cached: 5, contextUsed: 35 });
  const b = await s.send('-and again');
  assert.equal(b.text, 'echo: -and again [remembers: hello there]');
  assert.equal(b.sessionId, 'ses_fake1');
  assert.deepEqual(b.usage, { input: 26, output: b.text.length + 2, cached: 5, contextUsed: 26 + b.text.length + 2 });
  assert.equal(launches().length, 1, 'one server serves every reply');
  assert.equal(lines().filter(l => l.created).length, 1);
  s.close();
});

test('plain chat: the system prompt is the agent\'s, every tool is denied, and nothing of the user\'s config or folders is read', async () => {
  const s = open();
  await s.send('hi');
  s.close();
  const [{ argv, env, cwd, config }] = launches();
  assert.deepEqual(argv, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0']);
  const agent = config.agents['dyslexic-chat'];
  assert.equal(agent.system, 'SYS');
  assert.deepEqual(agent.permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  assert.equal(agent.steps, 3);
  assert.deepEqual(config.agents.title, { disabled: true });
  assert.match(env.OPENCODE_SERVER_PASSWORD, /^[0-9a-f]{32}$/);
  for (const k of ['OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_CONFIG_PROJECT_DISABLE', 'OPENCODE_DISABLE_AUTOUPDATE']) assert.equal(env[k], '1', k);
  assert.equal(realpathSync(cwd), realpathSync(join(process.env.DYSLEXIC_MODE_HOME, 'opencode')));
  const { created } = lines().find(l => l.created);
  assert.deepEqual(created.model, { providerID: 'opencode-go', id: 'gemini-4-argon' });
  assert.equal(created.agent, 'dyslexic-chat');
  assert.deepEqual(created.permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  assert.deepEqual(created.location, { directory: join(process.env.DYSLEXIC_MODE_HOME, 'opencode') });
});

test('reasoning is not the reply, two text blocks are set apart, and a tool the model tried is reported', async () => {
  const s = open();
  const think = await s.send('THINK hard');
  assert.equal(think.text, 'echo: THINK hard');
  const two = await s.send('TWO blocks');
  assert.equal(two.text, 'first block\n\nsecond block');
  const tools = [];
  await s.send('TOOL go', { onTool: b => tools.push(b) });
  assert.deepEqual(tools, [{ name: 'bash', input: { command: 'ls' } }]);
  s.close();
});

test('interrupt ends a reply early and keeps what streamed, and the chat carries on in the same server', async () => {
  const s = open();
  const parts = [];
  const r = await s.send('SLOW one', { onText: t => { parts.push(t); s.interrupt(); } });
  assert.equal(r.stopped, true);
  assert.equal(r.text.startsWith('partial '), true);
  assert.equal(s.interrupt(), false, 'nothing left to stop');
  assert.equal((await s.send('next')).text, 'echo: next [remembers: SLOW one]');
  assert.equal(launches().length, 1);
  s.close();
});

test('a server that dies fails its reply, and the next reply starts a new one on the same chat', async () => {
  const s = open();
  await s.send('first');
  await assert.rejects(s.send('DIE now'), /boom from fake opencode/);
  const after = await s.send('after');
  assert.equal(after.sessionId, 'ses_fake1');
  assert.equal(after.text, 'echo: after [remembers: first]');
  assert.equal(launches().length, 2);
  s.close();
});

test('a quota error fails the reply with how long it lasts, and a model that keeps failing is given up on', async () => {
  const s = open();
  await assert.rejects(s.send('FAIL'), /Go usage limit exceeded \(try again in 5\.1 days\)/);
  await assert.rejects(s.send('RETRY'), /stream ended without finish_reason/);
  assert.equal((await s.send('fine')).text.startsWith('echo: fine'), true);
  s.close();
});

test('a second send waits its turn, close settles a busy reply and ends the server, and a closed chat refuses', async () => {
  const s = open();
  const slow = s.send('SLOW');
  await assert.rejects(s.send('too soon'), /still running/);
  await new Promise(r => setTimeout(r, 400));
  s.close();
  assert.equal((await slow).stopped, true);
  await assert.rejects(s.send('after close'), /closed/);
  assert.ok(await gone(launches()[0].pid), 'the server is gone');
});

test('closing an idle chat ends its server, even one that was only warmed', async () => {
  const s = open();
  s.warm();
  await new Promise(r => setTimeout(r, 400));
  assert.equal(s.id, 'ses_fake1', 'warm made the chat');
  s.close();
  assert.ok(await gone(launches()[0].pid));
});

test('resuming: a chat the server knows continues, the model is switched if it differs, and an unknown one fails loudly', async () => {
  const a = open();
  await a.send('remember zebra');
  a.close();
  const b = open({ resume: 'ses_fake1', model: 'fake/echo' });
  assert.equal((await b.send('what word')).text, 'echo: what word [remembers: remember zebra]');
  assert.deepEqual(lines().find(l => l.switched).switched, { model: { providerID: 'fake', id: 'echo' } });
  b.close();
  const c = open({ resume: 'ses_nope' });
  await assert.rejects(c.send('hi'), /no chat ses_nope/);
});

test('a server that will not start fails the reply with what it said', async () => {
  process.env.FAKE_NO_SERVE = '1';
  const s = open();
  await assert.rejects(s.send('hi'), /serve is broken/);
});

test('opencode models: the list, the server\'s limits, and the cached catalog as a fallback', async () => {
  assert.deepEqual(parseOpencodeModels('opencode-go/gemini-4-argon\n\n  fake/echo  \nWarning: something\n'), ['opencode-go/gemini-4-argon', 'fake/echo']);
  assert.deepEqual(await opencodeModels({ bin: FAKE }), [
    { id: 'opencode-go/gemini-4-argon', name: 'Gemini 4 Argon', contextWindow: 1048576 },
    { id: 'opencode-go/gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1050000 },
    { id: 'fake/echo', name: 'Echo', contextWindow: 32000 },
  ]);
  const catalog = join(dir, 'models.json');
  writeFileSync(catalog, JSON.stringify({ 'opencode-go': { models: { 'gpt-6-luna': { limit: { context: 1050000 } } } } }));
  assert.deepEqual([...parseModelsDev(JSON.parse(readFileSync(catalog, 'utf8')))], [['opencode-go/gpt-6-luna', 1050000]]);
  process.env.FAKE_NO_SERVE = '1';
  assert.deepEqual(await opencodeModels({ bin: FAKE, cacheFile: catalog }), [
    { id: 'opencode-go/gemini-4-argon', name: 'opencode-go/gemini-4-argon', contextWindow: null },
    { id: 'opencode-go/gpt-6-luna', name: 'opencode-go/gpt-6-luna', contextWindow: 1050000 },
    { id: 'fake/echo', name: 'fake/echo', contextWindow: null },
  ]);
  assert.deepEqual(parseApiModels({ data: [{ providerID: 'a', modelID: 'b', name: 'B', limit: { context: 5 }, enabled: true }, { providerID: 'a', modelID: 'c', name: 'C', status: 'deprecated' }, { providerID: 'a', modelID: 'd', name: 'D', enabled: false }] }), [{ id: 'a/b', name: 'B', contextWindow: 5 }]);
});

test('small pieces: model names, the config, error sentences, event frames and the usage shapes', async () => {
  assert.deepEqual(splitModel('opencode-go/gemini-4-argon'), { providerID: 'opencode-go', id: 'gemini-4-argon' });
  assert.deepEqual(splitModel('a/b/c#fast'), { providerID: 'a', id: 'b/c', variant: 'fast' });
  assert.throws(() => splitModel('gemini'), /provider\/model/);
  const base = serverConfig({ system: 'S', extra: { providers: { x: {} }, agents: { mine: {} } } });
  assert.deepEqual(Object.keys(base.agents).sort(), ['dyslexic-chat', 'mine', 'title']);
  assert.deepEqual(base.providers, { x: {} });
  assert.equal(describe({ message: 'Nope', retryAfterMs: 7200000 }), 'Nope (try again in 2.0 hours)');
  assert.equal(describe({ type: 'x' }), 'x');
  // A frame may arrive in pieces, with heartbeat comments between frames.
  const body = ['data: {"a":1}\n\n: heartbeat\n\ndata: {"b"', ':2}\n\n'].map(s => new TextEncoder().encode(s));
  const seen = [];
  for await (const ev of events(body)) seen.push(ev);
  assert.deepEqual(seen, [{ a: 1 }, { b: 2 }]);
  const step = (input, output) => ({ input, output, reasoning: 1, cache: { read: 2, write: 3 } });
  assert.deepEqual(opencodeUsage([step(10, 4), step(20, 6)]), { input: 15 + 25, output: 5 + 7, cached: 4, contextUsed: 25 + 7 });
  assert.deepEqual(opencodeUsage([]), unknownUsage());
  assert.deepEqual(claudeUsage({ usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, modelUsage: { 'claude-x': { contextWindow: 200000 } } }), { input: 125, output: 7, cached: 100, contextUsed: 132, contextWindow: 200000 });
  assert.deepEqual(claudeUsage({ result: 'no usage here' }), unknownUsage());
});
