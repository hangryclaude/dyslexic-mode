import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Personal data lives outside the repo: what trips one reader belongs to them, not the project.
export const home = () => process.env.DYSLEXIC_MODE_HOME || join(homedir(), '.dyslexic-mode');
export const dataDir = () => { mkdirSync(home(), { recursive: true }); return home(); };
const path = name => join(dataDir(), name);

export const append = (name, row) => appendFileSync(path(name), JSON.stringify(row) + '\n');

export function rows(name) {
  const p = path(name);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

export function readProfile() {
  const p = path('profile.md');
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : '';
}

export const writeProfile = text => writeFileSync(path('profile.md'), text.trim() + '\n');

// Choices that should outlast a launch, like reading every reply aloud.
export function readSettings() {
  const p = path('settings.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export const saveSettings = patch => writeFileSync(path('settings.json'), JSON.stringify({ ...readSettings(), ...patch }, null, 2) + '\n');

// Past chats, newest first, one row per session: what it was about and how it ended.
export function sessions(chats = rows('chats.jsonl')) {
  const byId = new Map();
  for (const c of chats) {
    if (!c.session) continue;
    const s = byId.get(c.session) ?? { id: c.session, first: c.q, tools: c.tools, turns: 0 };
    byId.set(c.session, { ...s, ts: c.ts, last: { q: c.q, text: c.text }, turns: s.turns + 1 });
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}
