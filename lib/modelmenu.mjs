import { resolve } from './commands.mjs';
import { contextWindow, count } from './context.mjs';

// The one place that says which models /model offers. It returns the claude aliases for now,
// each as { id, label, provider, contextWindow }, the shape a longer list from other providers
// will have too, so the picker, /context and /status never need to change when it grows.
// The windows are what the claude CLI itself reported for these aliases on 2026-11-03. After
// every reply the app uses the window the CLI reports, so an account with a smaller one reads right.
export const models = () => [
  { id: 'haiku', label: 'Haiku', provider: 'claude', contextWindow: 1_000_000 },
  { id: 'sonnet', label: 'Sonnet', provider: 'claude', contextWindow: 1_000_000 },
  { id: 'opus', label: 'Opus', provider: 'claude', contextWindow: 1_000_000 },
];

// A picker row: what the model is, who runs it, and how much it can hold.
export const modelLine = (m, current) => `${m.label}, ${m.provider}, ${count(m.contextWindow)} tokens${m.id === current ? ' (now)' : ''}`;

// A typed model: an id or a label, the start of one, or a close spelling, like /model opsu.
// An id the list does not know but that looks like one (opus[1m], claude-opus-4-5) is passed
// on as typed, because claude accepts those too.
export function findModel(typed, list = models()) {
  const t = typed.trim().toLowerCase();
  const names = [...new Set(list.flatMap(m => [m.id.toLowerCase(), m.label.toLowerCase()]))];
  const name = resolve(t, names);
  const hit = name && list.find(m => m.id.toLowerCase() === name || m.label.toLowerCase() === name);
  if (hit) return hit;
  if (/^[\w.[\]-]+$/.test(t) && /[\d[\]-]/.test(t)) return { id: typed.trim(), label: typed.trim(), provider: 'custom', contextWindow: contextWindow(t) };
  return null;
}
