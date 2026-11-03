import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listModels, refreshModels, cachedModels, resolveModel, openSessionFor, learnContextWindow, contextWindowOf, CLAUDE_MODELS } from '../lib/models.mjs';

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
  options = { opencode: { bin: OPENCODE }, grok: { bin: GROK, dir: grokDir } };
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
  const { models, errors } = await refreshModels({ opencode: { bin: join(dir, 'missing') }, grok: { bin: GROK, dir: grokDir } });
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
