import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listModels, refreshModels, cachedModels, resolveModel, openSessionFor, canonicalModel, providerOf, askFor, learnContextWindow, contextWindowOf, markStale, CLAUDE_MODELS } from '../lib/models.mjs';
import { serviceById } from '../lib/providers/services.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const GROK = fixture('fake-grok.mjs'), OPENCODE = fixture('fake-opencode.mjs'), CLAUDE = fixture('fake-claude.mjs');
let log, dir, grokDir, options;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dm-models-'));
  log = join(dir, 'log');
  grokDir = join(dir, 'grokhome');
  mkdirSync(grokDir);
  mkdirSync(join(dir, 'state'));
  writeFileSync(join(grokDir, 'models_cache.json'), JSON.stringify({ models: { 'grok-4.7': { info: { context_window: 256000 } } } }));
  process.env.FAKE_LOG = log;
  process.env.FAKE_OC_STATE = join(dir, 'state.json');
  process.env.FAKE_STATE = join(dir, 'state');
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
  // No real service is asked: each test that wants one points it at the fake model endpoint.
  options = { opencode: { bin: OPENCODE }, grok: { bin: GROK, dir: grokDir }, api: { services: [] } };
});
const opened = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });
const launches = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []).filter(l => l.argv);

test('a refresh lists every provider\'s models with an id that names its provider and a context window', async () => {
  const { models, errors } = await refreshModels(options);
  assert.deepEqual(errors, {});
  const byId = Object.fromEntries(models.map(m => [m.id, m]));
  assert.deepEqual(models.filter(m => m.provider === 'claude').map(m => m.id), ['claude/fable', 'claude/opus', 'claude/sonnet', 'claude/haiku']);
  assert.equal(byId['claude/sonnet'].contextWindow, 200000);
  assert.equal(byId['claude/sonnet'].contextSource, 'documented default');
  assert.deepEqual(byId['grok/grok-4.7'], { id: 'grok/grok-4.7', label: 'grok-4.7', provider: 'grok', model: 'grok-4.7', contextWindow: 256000, contextSource: 'grok config' });
  assert.equal(byId['grok/grok-4.6'].contextWindow, null, 'unknown stays unknown');
  assert.equal(byId['grok/grok-4.6'].contextSource, 'unknown');
  assert.deepEqual(byId['opencode-go/gemini-4-argon'], { id: 'opencode-go/gemini-4-argon', label: 'Gemini 4 Argon (opencode-go)', provider: 'opencode', model: 'opencode-go/gemini-4-argon', contextWindow: 1048576, contextSource: 'opencode model list' });
  assert.equal(byId['opencode/old-one'], undefined, 'retired models are left out');
});

test('the cache holds only public model metadata, and a fresh one is reused instead of asking the CLIs again', async () => {
  await listModels(options);
  const first = launches().length;
  assert.ok(first >= 2, 'both CLIs were asked');
  const cache = JSON.parse(readFileSync(join(process.env.DYSLEXIC_MODE_HOME, 'models.json'), 'utf8'));
  assert.deepEqual(Object.keys(cache).sort(), ['fetchedAt', 'learned', 'models', 'version']);
  for (const m of cache.models) assert.deepEqual(Object.keys(m).sort(), ['contextSource', 'contextWindow', 'id', 'label', 'model', 'provider']);
  assert.equal((await listModels(options)).length, cache.models.length);
  assert.equal(launches().length, first, 'no new launch');
  await listModels({ ...options, refresh: true });
  assert.ok(launches().length > first, 'refresh asks again');
  assert.deepEqual(cachedModels().map(m => m.id), cache.models.map(m => m.id));
});

test('with no refresh yet, only the claude models are known, and a provider that fails keeps its last models', async () => {
  assert.deepEqual(cachedModels(), CLAUDE_MODELS);
  await refreshModels(options);
  const { models, errors } = await refreshModels({ ...options, opencode: { bin: join(dir, 'missing') } });
  assert.match(errors.opencode, /ENOENT|missing/);
  assert.ok(models.some(m => m.id === 'opencode-go/gemini-4-argon'), 'last known opencode models kept');
  assert.ok(models.some(m => m.id === 'grok/grok-4.7'));
});

test('a window a CLI reported replaces the default', async () => {
  await refreshModels(options);
  learnContextWindow('claude/sonnet', 1000000);
  const sonnet = cachedModels().find(m => m.id === 'claude/sonnet');
  assert.equal(sonnet.contextWindow, 1000000);
  assert.equal(sonnet.contextSource, 'reported by the CLI');
  assert.equal(contextWindowOf('claude/sonnet'), 1000000);
  assert.equal(contextWindowOf('nope/none'), null);
  // A later refresh keeps what was learned.
  assert.equal((await refreshModels(options)).models.find(m => m.id === 'claude/sonnet').contextWindow, 1000000);
});

test('an id says which provider and which model name to use, and bare claude names still work', () => {
  const models = CLAUDE_MODELS;
  assert.deepEqual(resolveModel('claude/sonnet', models), { provider: 'claude', model: 'sonnet' });
  assert.deepEqual(resolveModel('sonnet', models), { provider: 'claude', model: 'sonnet' });
  assert.deepEqual(resolveModel('opus[1m]', models), { provider: 'claude', model: 'opus[1m]' });
  assert.deepEqual(resolveModel('claude-sonnet-4-6', models), { provider: 'claude', model: 'claude-sonnet-4-6' });
  assert.deepEqual(resolveModel(undefined, models), { provider: 'claude', model: undefined });
  assert.deepEqual(resolveModel('grok/grok-4.7', models), { provider: 'grok', model: 'grok-4.7' });
  assert.deepEqual(resolveModel('opencode-go/gemini-4-argon', models), { provider: 'opencode', model: 'opencode-go/gemini-4-argon' });
  assert.deepEqual(resolveModel('grok-4.7', [{ id: 'grok/grok-4.7', provider: 'grok', model: 'grok-4.7' }]), { provider: 'grok', model: 'grok-4.7' });
  assert.throws(() => resolveModel('gemini', models), /no model called "gemini"/);
});

test('openSessionFor opens the provider an id names, with the same session shape', async () => {
  const open = (id, bin) => {
    const s = openSessionFor(id, { system: 'SYS', bin });
    opened.push(s);
    return s;
  };
  const model = () => launches().at(-1).argv[launches().at(-1).argv.indexOf('--model') + 1];

  assert.equal((await open('claude/sonnet', CLAUDE).send('hi')).text, 'echo: hi');
  assert.equal(model(), 'sonnet');

  assert.equal((await open('grok/grok-4.7', GROK).send('hi')).text, 'echo: hi');
  assert.equal(model(), 'grok-4.7');

  const r = await open('opencode-go/gemini-4-argon', OPENCODE).send('hi');
  assert.equal(r.text, 'echo: hi');
  // 16 read (10 fresh, 5 cached, 1 newly cached) and 10 written (8 reply, 2 reasoning).
  assert.deepEqual(r.usage, { input: 16, output: 10, cached: 5, contextUsed: 26 });

  for (const id of ['grok/grok-4.7', 'opencode-go/gemini-4-argon']) assert.throws(() => openSessionFor(id, { system: 'SYS', tools: true }), /full access works with Claude only/);
  assert.throws(() => openSessionFor('mystery', { system: 'SYS' }), /no model called/);
});

test('canonicalModel names a model the way the registry does, and providerOf says who takes it', () => {
  const list = [...CLAUDE_MODELS, { id: 'grok/grok-4.7', label: 'grok-4.7', provider: 'grok', model: 'grok-4.7' }];
  assert.equal(canonicalModel('sonnet', list), 'claude/sonnet');
  assert.equal(canonicalModel('claude/sonnet', list), 'claude/sonnet');
  assert.equal(canonicalModel('grok-4.7', list), 'grok/grok-4.7');
  assert.equal(canonicalModel('opus[1m]', list), 'opus[1m]', 'an id the registry does not list is left as it is');
  assert.equal(canonicalModel('gemini', list), 'gemini', 'and so is a name nobody takes');
  assert.equal(canonicalModel(undefined, list), undefined);
  assert.equal(canonicalModel(null, list), null);
  for (const [id, who] of [['sonnet', 'claude'], ['opus[1m]', 'claude'], [undefined, 'claude'], ['grok/grok-4.7', 'grok'], ['opencode-go/gemini-4-argon', 'opencode'], ['gemini', null]]) {
    assert.equal(providerOf(id, list), who, String(id));
  }
});

const gone = async pid => {
  for (let i = 0; i < 60; i++) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
};

test('askFor asks one question on whichever provider the id names, with the system prompt, and leaves nothing running', async () => {
  const flag = (argv, name) => argv[argv.indexOf(name) + 1];

  const claude = await askFor('claude/sonnet', 'hi', { system: 'SYS', bin: CLAUDE });
  assert.equal(claude.text, 'echo: hi');
  const claudeArgv = launches().at(-1).argv;
  assert.equal(flag(claudeArgv, '--model'), 'sonnet');
  assert.equal(flag(claudeArgv, '--system-prompt'), 'SYS');
  assert.ok(!claudeArgv.includes('--input-format'), 'claude has a one-shot call of its own');

  const grok = await askFor('grok/grok-4.7', 'hi', { system: 'SYS', bin: GROK });
  assert.equal(grok.text, 'echo: hi');
  const grokArgv = launches().at(-1).argv;
  assert.equal(flag(grokArgv, '--model'), 'grok-4.7');
  assert.ok(grokArgv.includes('--system-prompt-override=SYS'));

  const before = launches().length;
  const oc = await askFor('opencode-go/gemini-4-argon', 'hi', { system: 'SYS', bin: OPENCODE });
  assert.equal(oc.text, 'echo: hi');
  const server = launches().at(before);
  assert.equal(server.config.agents['dyslexic-chat'].system, 'SYS');
  assert.ok(await gone(server.pid), 'the server opened for the question is closed after it');
});

test('a question that fails rejects with the provider\'s own message, and one that is stopped rejects as stopped and ends its process', async () => {
  await assert.rejects(askFor('grok/grok-4.7', 'FAIL it', { bin: GROK }), /boom/);

  const ctl = new AbortController();
  const asked = askFor('grok/grok-4.7', 'SLOW question', { bin: GROK, signal: ctl.signal });
  for (let i = 0; i < 100 && !launches().some(l => l.argv.some(a => a.startsWith('--single=SLOW'))); i++) await new Promise(r => setTimeout(r, 20));
  ctl.abort();
  await assert.rejects(asked, err => err.name === 'AbortError');
  const slow = launches().find(l => l.argv.some(a => a.startsWith('--single=SLOW')));
  assert.ok(await gone(slow.pid), 'the process is ended');

  const before = launches().length;
  await assert.rejects(askFor('grok/grok-4.7', 'hi', { bin: GROK, signal: AbortSignal.abort() }), err => err.name === 'AbortError');
  assert.equal(launches().length, before, 'a call that is already stopped starts nothing');
});

// Not a credential. The tests only check where it goes.
const KEY = 'FAKE-KEY-FOR-TESTS-0123456789';
// The fake model endpoint stands in for a real service, and the fake security for the Keychain.
async function fakeService() {
  const child = spawn(process.execPath, [fixture('fake-openai.mjs')]);
  opened.push({ close: () => child.kill() });
  const port = await new Promise(res => child.stdout.once('data', d => res(/listening (\d+)/.exec(String(d))[1])));
  return `http://127.0.0.1:${port}/v1`;
}
function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  const restore = () => { for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return Promise.resolve().then(fn).finally(restore);
}
function fakeKeychain() {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(fixture('fake-security.mjs'), join(bin, 'security'));
  return { PATH: `${bin}:${process.env.PATH}`, FAKE_KEYCHAIN: join(dir, 'keychain.json') };
}

test('a refresh asks each service with a key and each local server, and lists their models as api/<service>/<model>', async () => {
  const base = await fakeService();
  await withEnv({ POE_BASE_URL: base, OLLAMA_BASE_URL: base }, async () => {
    const asked = [];
    const api = { services: ['poe', 'groq', 'ollama'].map(serviceById), key: s => { asked.push(s.id); return s.id === 'poe' ? KEY : null; } };
    const { models, errors } = await refreshModels({ ...options, api });
    assert.deepEqual(errors, {});
    assert.deepEqual(asked, ['poe', 'groq'], 'a local server is never asked for a key');
    assert.deepEqual(models.find(m => m.id === 'api/poe/echo'), {
      id: 'api/poe/echo', label: 'Echo', provider: 'api', service: 'poe', model: 'echo', owner: null, contextWindow: null, contextSource: 'unknown',
    });
    assert.ok(models.some(m => m.id === 'api/ollama/echo'));
    assert.ok(!models.some(m => m.service === 'groq'), 'a service with no key is not asked');
    assert.ok(models.some(m => m.id === 'claude/opus') && models.some(m => m.id === 'grok/grok-4.7'), 'the CLIs are still there');
  });
  // A service that cannot be reached this time keeps what it offered, and says why.
  await withEnv({ POE_BASE_URL: 'http://127.0.0.1:9/v1' }, async () => {
    const { models, errors } = await refreshModels({ ...options, api: { services: [serviceById('poe')], key: () => KEY } });
    assert.match(errors.Poe, /Poe could not be reached/);
    assert.ok(models.some(m => m.id === 'api/poe/echo'));
  });
});

test('an api/ id opens a chat with its service and key, a resumed one keeps its history, and a side question works', async () => {
  const base = await fakeService();
  await withEnv({ POE_BASE_URL: base, POE_API_KEY: KEY, OLLAMA_BASE_URL: base }, async () => {
    assert.deepEqual(resolveModel('api/poe/gpt-5', []), { provider: 'api', service: 'poe', model: 'gpt-5' });
    assert.equal(providerOf('api/openrouter/openai/gpt-5', []), 'api');
    assert.equal(resolveModel('api/openrouter/openai/gpt-5', []).model, 'openai/gpt-5');
    assert.throws(() => resolveModel('api/nowhere/echo', []), /no model called "api\/nowhere\/echo"/);
    const s = openSessionFor('api/poe/echo', { system: 'be brief', resume: 'api-1', history: [{ q: 'earlier', text: 'ok' }] });
    opened.push(s);
    const r = await s.send('now');
    assert.equal(r.text, 'echo: now [remembers: earlier]');
    assert.equal(r.sessionId, 'api-1');
    assert.throws(() => openSessionFor('api/poe/echo', { tools: true }), /full access works with Claude only, not Poe/);
    assert.equal((await askFor('api/ollama/echo', 'one question', { system: 'be brief' })).text, 'echo: one question');
  });
});

test('a service with no key yet says how to add one, and asks the Keychain under its own name', async () => {
  const env = fakeKeychain();
  await withEnv({ ...env, GROQ_API_KEY: '', FAKE_SECURITY_LOG: join(dir, 'security.log') }, () => {
    assert.throws(() => openSessionFor('api/groq/llama-3.3-70b-versatile'), /no Groq key yet\. \/key groq saves one/);
    const asked = readFileSync(join(dir, 'security.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(asked, [['find-generic-password', '-s', 'dyslexic-mode', '-a', 'groq', '-w']]);
  });
});

test('a new key makes the next list a fresh one', async () => {
  await refreshModels(options);
  markStale();
  const before = JSON.parse(readFileSync(join(dir, 'home', 'models.json'), 'utf8'));
  assert.equal(before.fetchedAt, new Date(0).toISOString());
  await listModels(options);
  assert.notEqual(JSON.parse(readFileSync(join(dir, 'home', 'models.json'), 'utf8')).fetchedAt, before.fetchedAt);
});
