import { resolve } from './commands.mjs';
import { contextWindow, count } from './context.mjs';
import { cachedModels, providerOf } from './models.mjs';

// The models /model offers are the registry's: Claude's, and whatever grok and opencode say they
// have. Each is { id, label, provider, model, contextWindow, contextSource }. This is the list that
// is already known, with no CLI started. /model asks listModels() for a fresh one when it is a day old.
export const models = () => cachedModels();

// A window nobody has reported yet is Claude's documented 200k, and says it is a guess.
const windowText = m => (m.contextWindow
  ? `${count(m.contextWindow)} tokens${m.contextSource === 'documented default' ? ', a guess' : ''}`
  : 'window unknown');

// A picker row: what the model is, who runs it, and how much it can hold.
export const modelLine = (m, current) => `${m.label}, ${m.provider}, ${windowText(m)}${m.id === current ? ' (now)' : ''}`;

// A typed model: an id, a label, the short name after the provider ("opus"), the start of one, or
// a close spelling, like /model opsu. A short name two models share, like gpt-6-luna at two
// providers, names neither, but an exact id always does. An id the list does not know but claude
// takes (opus[1m], claude-opus-4-5) is passed on as typed.
export function findModel(typed, list = models()) {
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  const keys = m => [m.id, m.label, m.id.split('/').at(-1)].filter(Boolean).map(k => String(k).toLowerCase());
  const name = resolve(t, [...new Set(list.flatMap(keys))]);
  const hits = name ? list.filter(m => keys(m).includes(name)) : [];
  const hit = hits.find(m => m.id.toLowerCase() === name) ?? (hits.length === 1 ? hits[0] : null);
  if (hit) return hit;
  if (hits.length) return null;
  if (/^[\w.[\]-]+$/.test(t) && providerOf(typed.trim(), list) === 'claude') {
    return { id: typed.trim(), label: typed.trim(), provider: 'claude', contextWindow: contextWindow(t) };
  }
  return null;
}
