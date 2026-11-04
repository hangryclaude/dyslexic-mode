import { resolve } from './commands.mjs';
import { contextWindow, count } from './context.mjs';
import { cachedModels, providerOf } from './models.mjs';
import { MAKERS, OTHER, makerOf, pretty } from './makers.mjs';
import { serviceById } from './providers/services.mjs';

// The models /model offers are the registry's: Claude's, whatever grok and opencode say they have,
// and what each service you have a key for offers. Each is { id, label, provider, model,
// contextWindow, contextSource }, plus `service` for a service's. This is the list that is already
// known, with nothing asked. /model asks listModels() for a fresh one when it is a day old.
export const models = () => cachedModels();

// A window as a short number, since a list is read down a column: 1M, 400K. One nobody has
// reported yet is Claude's documented 200K, and says it is a guess.
const short = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const windowText = m => (m.contextWindow
  ? `${short(m.contextWindow)} tokens${m.contextSource === 'documented default' ? ', a guess' : ''}`
  : 'window unknown');

// Who brings a model to you: the claude or grok CLI, one of opencode's routes, or a service.
export const routeOf = m => (m.provider === 'api' ? serviceById(m.service)?.name ?? m.service
  : m.provider === 'opencode' ? m.id.split('/')[0] : m.provider);

// A model's name on its own. opencode's labels carry their route, which the row says anyway.
export const nameOf = m => m.label.replace(/\s*\(opencode(-go)?\)$/, '');

// A picker row for one model, beside its name: who brings it and how much it can hold, each in a
// column of its own.
export const modelLine = (m, current) => `${routeOf(m).padEnd(13)} ${windowText(m)}${m.id === current ? '  (now)' : ''}`;

// The list by company, in the order MAKERS gives, leaving out the companies with no model.
export function byMaker(list) {
  const groups = new Map([...MAKERS, OTHER].map(k => [k, []]));
  for (const m of list) groups.get(makerOf(m)).push(m);
  return [...groups].filter(([, ms]) => ms.length).map(([maker, ms]) => ({ maker, models: ms }));
}

// Every model's name once, in its company's colour, for the brain to be written in. Each
// company's names spread evenly through the list, so neighbours differ and every colour shows.
// Every company's first name comes first, in MAKERS order. The grok CLI names its models by id,
// like grok-4.7, so a bare id is spelled out.
export function brainWords(list = models()) {
  const spelled = name => (/^[a-z0-9.-]+$/.test(name) ? pretty(name) : name);
  return byMaker(list)
    .flatMap(({ maker, models: ms }) => [...new Set(ms.map(m => spelled(nameOf(m))))].map((name, i, all) => ({ name, color: maker.color, at: i / all.length })))
    .sort((a, b) => a.at - b.at)
    .map(({ name, color }) => ({ name, color }));
}

// What /brain shows: the words to write the brain in, and how many models and companies.
export function brainOf(list = models()) {
  const companies = byMaker(list).length;
  return {
    words: brainWords(list),
    tally: `${count(list.length)} model${list.length === 1 ? '' : 's'} · ${companies} compan${companies === 1 ? 'y' : 'ies'}`,
  };
}

// A picker row for one company: how many models, in a column, and who brings them.
export function makerLine({ models: ms }, current) {
  const routes = [...new Set(ms.map(routeOf))];
  const via = routes.length > 3 ? `${routes.slice(0, 3).join(', ')} +${routes.length - 3}` : routes.join(', ');
  return `${String(ms.length).padStart(3)} ${ms.length === 1 ? 'model ' : 'models'}  ${via}${ms.some(m => m.id === current) ? '  (now)' : ''}`;
}

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

// Every model a typed word is part of, like "gemini" or "llama", for when it names a family, not one.
export const matching = (typed, list = models()) => {
  const t = typed.trim().toLowerCase();
  return t ? list.filter(m => `${m.id} ${m.label}`.toLowerCase().includes(t)) : [];
};
