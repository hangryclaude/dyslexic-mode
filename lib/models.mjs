import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSession } from './session.mjs';
import { ask } from './claude.mjs';
import { openGrokSession, grokModels } from './providers/grok.mjs';
import { openOpencodeSession, opencodeModels } from './providers/opencode.mjs';
import { openApiSession, apiModels } from './providers/api.mjs';
import { SERVICES, serviceById } from './providers/services.mjs';
import { keyFor } from './keys.mjs';
import { claudeUsage } from './usage.mjs';
import { dataDir } from './store.mjs';

export { claudeUsage };

const run = promisify(execFile);
const DAY = 864e5;

// Every model has an id that names its provider, so one string says where a chat goes:
//   claude/sonnet            the claude CLI, which takes these aliases or a full model name
//   grok/grok-4.7            the grok CLI
//   opencode-go/gemini-4-argon   opencode, in its own provider/model form
//   api/poe/gpt-5            an AI service over its own API, with your key (lib/providers/services.mjs)
// `model` is the name the provider's CLI or API is given.
const CLAUDE = [['fable', 'Claude Fable'], ['opus', 'Claude Opus'], ['sonnet', 'Claude Sonnet'], ['haiku', 'Claude Haiku']];
// The claude CLI reports its real window in each reply (usage.contextWindow). Until one has been
// seen, 200k is the documented default.
export const CLAUDE_MODELS = CLAUDE.map(([model, label]) => ({
  id: `claude/${model}`, label, provider: 'claude', model, contextWindow: 200000, contextSource: 'documented default',
}));

const cachePath = () => join(dataDir(), 'models.json');

// Only public model metadata is kept here: ids, names and window sizes. Never anything from a login.
function readCache() {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

const withLearned = cache => cache.models.map(m => (cache.learned?.[m.id] ? { ...m, contextWindow: cache.learned[m.id], contextSource: 'reported by the CLI' } : m));

// Free, never starts a CLI: what the last refresh found, or only the claude models if there was none.
export const cachedModels = () => {
  const cache = readCache();
  return cache ? withLearned(cache) : CLAUDE_MODELS;
};

export const contextWindowOf = (id, models = cachedModels()) => models.find(m => m.id === id)?.contextWindow ?? null;

// Records a window a CLI reported in a reply, like usage.contextWindow from claude.
export function learnContextWindow(id, tokens) {
  const cache = readCache() ?? { version: 1, fetchedAt: new Date(0).toISOString(), models: CLAUDE_MODELS };
  cache.learned = { ...cache.learned, [id]: tokens };
  writeFileSync(cachePath(), JSON.stringify(cache, null, 2) + '\n');
}

// One tiny claude reply, to read the window the CLI reports for an alias. It costs a real reply.
export async function probeClaudeWindow(model, { bin = process.env.DYSLEXIC_CLAUDE_BIN || 'claude' } = {}) {
  const { stdout } = await run(bin, ['-p', '--output-format', 'json', '--tools', '', '--setting-sources', '', '--model', model, 'Reply with: ok'], { timeout: 90000 });
  return claudeUsage(JSON.parse(stdout)).contextWindow ?? null;
}

// The services a refresh asks: each one with a key, and each local server, which needs none and
// offers nothing when it is not running. A service with no key is not asked at all.
async function serviceModels({ services = SERVICES, key = s => keyFor(s), fetch } = {}, attempt, old) {
  const asked = services.map(s => ({ s, key: s.local ? null : key(s) })).filter(a => a.s.local || a.key);
  const lists = await Promise.all(asked.map(({ s, key: k }) => attempt(s.name, () => apiModels(s, { key: k, fetch }))));
  return asked.flatMap(({ s }, i) => {
    // A service that could not be asked this time keeps what it offered last time.
    if (!lists[i]) return (old?.models ?? []).filter(m => m.provider === 'api' && m.service === s.id);
    // Newest first, as near as names tell: GPT-5.2 before GPT-5.1.
    const found = [...lists[i]].sort((a, b) => b.label.localeCompare(a.label, 'en', { numeric: true }));
    return found.map(m => ({
      id: `api/${s.id}/${m.id}`, label: m.label, provider: 'api', service: s.id, model: m.id, owner: m.owner,
      contextWindow: m.contextWindow, contextSource: m.contextWindow ? `${s.name} model list` : 'unknown',
    }));
  });
}

// Asks every CLI and service what it offers and writes the answer to models.json. One that is
// missing or logged out is reported in `errors` and keeps its last known models, so one broken
// provider does not empty the list. `opencode`, `grok`, `claude` and `api` are options for their
// discovery functions (a test points them at fakes); `probeClaude` asks claude for its real
// windows, one reply per alias.
export async function refreshModels({ opencode, grok, claude, api, probeClaude = false } = {}) {
  const old = readCache();
  const errors = {};
  const attempt = async (provider, fn) => {
    try { return await fn(); } catch (err) { errors[provider] = err.message; return null; }
  };
  const [oc, gk, apis] = await Promise.all([
    attempt('opencode', () => opencodeModels(opencode)), attempt('grok', () => grokModels(grok)), serviceModels(api, attempt, old),
  ]);
  const kept = provider => (old?.models ?? []).filter(m => m.provider === provider);
  const claudes = await Promise.all(CLAUDE_MODELS.map(async m => {
    const window = probeClaude ? await attempt('claude', () => probeClaudeWindow(m.model, claude)) : null;
    if (window) return { ...m, contextWindow: window, contextSource: 'reported by the claude CLI' };
    // Without a probe, a window an earlier one found is kept.
    const before = kept('claude').find(k => k.id === m.id);
    return before && before.contextSource !== m.contextSource ? { ...m, contextWindow: before.contextWindow, contextSource: before.contextSource } : m;
  }));
  const models = [
    ...claudes,
    ...(gk ? gk.map(m => ({
      id: `grok/${m.id}`, label: m.id, provider: 'grok', model: m.id, contextWindow: m.contextWindow, contextSource: m.contextWindow ? 'grok config' : 'unknown',
    })) : kept('grok')),
    ...(oc ? oc.map(m => ({
      id: m.id, label: `${m.name} (${m.id.split('/')[0]})`, provider: 'opencode', model: m.id, contextWindow: m.contextWindow, contextSource: m.contextWindow ? 'opencode model list' : 'unknown',
    })) : kept('opencode')),
    ...apis,
  ];
  writeFileSync(cachePath(), JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models, learned: old?.learned ?? {} }, null, 2) + '\n');
  return { models: withLearned({ models, learned: old?.learned }), errors };
}

// A new key means a service has models the list does not have yet, so the next /model asks again.
export function markStale() {
  const cache = readCache();
  if (cache) writeFileSync(cachePath(), JSON.stringify({ ...cache, fetchedAt: new Date(0).toISOString() }, null, 2) + '\n');
}

// The models to offer. A refresh under a day old is reused; `refresh: true` asks the CLIs again.
export async function listModels({ refresh = false, ...options } = {}) {
  const cache = readCache();
  if (!refresh && cache && Date.now() - Date.parse(cache.fetchedAt) < DAY) return withLearned(cache);
  return (await refreshModels(options)).models;
}

// Which provider and CLI model name an id means. A bare claude alias (the app's --model has always
// taken "sonnet") and no id at all (claude's own default) still work.
export function resolveModel(id, models = cachedModels()) {
  if (id == null) return { provider: 'claude', model: undefined };
  const hit = models.find(m => m.id === id) ?? models.find(m => m.provider === 'grok' && m.model === id);
  if (hit) return { provider: hit.provider, model: hit.model, ...(hit.service && { service: hit.service }) };
  const [head, ...rest] = id.split('/');
  if (rest.length && (head === 'claude' || head === 'grok')) return { provider: head, model: rest.join('/') };
  // api/<service>/<model>: a model the list has not seen yet still goes to its service.
  if (head === 'api') {
    const [service, ...model] = rest;
    if (!serviceById(service) || !model.length) throw new Error(`no model called "${id}"`);
    return { provider: 'api', service, model: model.join('/') };
  }
  if (rest.length) return { provider: 'opencode', model: id };
  if (/^(fable|opus|sonnet|haiku)(\[|$)|^claude-/.test(id)) return { provider: 'claude', model: id };
  throw new Error(`no model called "${id}"`);
}

// A chat on whichever provider the id names, with the same send/interrupt/close as lib/session.mjs.
// grok, opencode and the services are plain chat only: full access (tools) is Claude's. A service
// keeps no chat of its own, so `history` (the turns so far) is how one comes back.
export function openSessionFor(modelId, { tools = false, ...opts } = {}) {
  const { provider, model, service } = resolveModel(modelId);
  if (provider === 'claude') return openSession({ ...opts, model, tools });
  if (tools) throw new Error(`full access works with Claude only, not ${provider === 'api' ? serviceById(service).name : provider}`);
  if (provider === 'api') return openApiSession({ ...opts, ...serviceAccess(service), model });
  return (provider === 'grok' ? openGrokSession : openOpencodeSession)({ ...opts, model });
}

// A service and the key it takes. A local server takes none.
function serviceAccess(id) {
  const service = serviceById(id);
  const key = service.local ? null : keyFor(service);
  if (!service.local && !key) throw new Error(`no ${service.name} key yet. /key ${service.id} saves one`);
  return { service, key };
}

// The registry's id for a name someone typed or saved: "sonnet" is claude/sonnet. A name the
// registry does not list, like opus[1m], stays as it was typed.
export function canonicalModel(id, models = cachedModels()) {
  if (id == null) return id;
  try {
    const { provider, model } = resolveModel(id, models);
    return models.find(m => m.provider === provider && m.model === model)?.id ?? id;
  } catch {
    return id;
  }
}

// Which provider takes an id, or null when none does. No id at all is claude's own default.
export function providerOf(id, models = cachedModels()) {
  try {
    return resolveModel(id, models).provider;
  } catch {
    return null;
  }
}

// One question and one answer on whichever provider the id names. Claude has a one-shot call of
// its own. The others only chat, so a chat is opened for the question and closed after it. A call
// that is stopped rejects with an AbortError, as claude's does.
export async function askFor(modelId, prompt, { system, signal, ...opts } = {}) {
  const { provider, model } = resolveModel(modelId);
  if (provider === 'claude') return ask(prompt, { ...opts, system, signal, model });
  const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });
  if (signal?.aborted) throw stopped();
  const chat = openSessionFor(modelId, { system, bin: opts.bin });
  const stop = () => chat.close();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const reply = await chat.send(prompt);
    if (reply.stopped) throw stopped();
    return reply;
  } finally {
    signal?.removeEventListener('abort', stop);
    chat.close();
  }
}
