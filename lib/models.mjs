import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSession } from './session.mjs';
import { openGrokSession, grokModels } from './providers/grok.mjs';
import { openOpencodeSession, opencodeModels } from './providers/opencode.mjs';
import { claudeUsage } from './usage.mjs';
import { dataDir } from './store.mjs';

export { claudeUsage };

const run = promisify(execFile);
const DAY = 864e5;

// Every model has an id that names its provider, so one string says where a chat goes:
//   claude/sonnet            the claude CLI, which takes these aliases or a full model name
//   grok/grok-4.7            the grok CLI
//   opencode-go/gemini-4-argon   opencode, in its own provider/model form
// `model` is the name the provider's CLI is given.
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

// Asks every CLI what it offers and writes the answer to models.json. A CLI that is missing or
// logged out is reported in `errors` and keeps its last known models, so one broken provider does
// not empty the list. `opencode`, `grok` and `claude` are options for their discovery functions (a
// test points them at fake CLIs); `probeClaude` asks claude for its real windows, one reply per alias.
export async function refreshModels({ opencode, grok, claude, probeClaude = false } = {}) {
  const old = readCache();
  const errors = {};
  const attempt = async (provider, fn) => {
    try { return await fn(); } catch (err) { errors[provider] = err.message; return null; }
  };
  const [oc, gk] = await Promise.all([attempt('opencode', () => opencodeModels(opencode)), attempt('grok', () => grokModels(grok))]);
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
  ];
  writeFileSync(cachePath(), JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models, learned: old?.learned ?? {} }, null, 2) + '\n');
  return { models: withLearned({ models, learned: old?.learned }), errors };
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
  if (hit) return { provider: hit.provider, model: hit.model };
  const [head, ...rest] = id.split('/');
  if (rest.length && (head === 'claude' || head === 'grok')) return { provider: head, model: rest.join('/') };
  if (rest.length) return { provider: 'opencode', model: id };
  if (/^(fable|opus|sonnet|haiku)(\[|$)|^claude-/.test(id)) return { provider: 'claude', model: id };
  throw new Error(`no model called "${id}"`);
}

// A chat on whichever provider the id names, with the same send/interrupt/close as lib/session.mjs.
// grok and opencode are plain chat only: full access (tools) is Claude's.
export function openSessionFor(modelId, { tools = false, ...opts } = {}) {
  const { provider, model } = resolveModel(modelId);
  if (provider === 'claude') return openSession({ ...opts, model, tools });
  if (tools) throw new Error(`full access works with Claude only, not ${provider}`);
  return (provider === 'grok' ? openGrokSession : openOpencodeSession)({ ...opts, model });
}
