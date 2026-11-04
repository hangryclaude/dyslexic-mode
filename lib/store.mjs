import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// Choices that should outlast a launch, like the model and the thinking level.
export function readSettings() {
  const p = path('settings.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export const saveSettings = patch => writeFileSync(path('settings.json'), JSON.stringify({ ...readSettings(), ...patch }, null, 2) + '\n');

// Saved documents, like plans and exports, are markdown files in a folder under the data dir.
// The name says the day and the topic, and a second file with the same name gets -2, never
// overwrites the first.
export const today = (d = new Date()) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
export function slug(text, max = 40) {
  let name = '';
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    if (name && name.length + 1 + word.length > max) break;
    name = name ? `${name}-${word}` : word;
  }
  return name.slice(0, max) || 'untitled';
}

export function saveFile(folder, name, text) {
  const dir = join(dataDir(), folder);
  mkdirSync(dir, { recursive: true });
  let file = join(dir, `${name}.md`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `${name}-${n}.md`);
  writeFileSync(file, text, { flag: 'wx' });
  return file;
}

// The file saved last, so `/plan` alone can show it again.
export function latestFile(folder) {
  const dir = join(dataDir(), folder);
  if (!existsSync(dir)) return null;
  const [newest] = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => join(dir, f))
    .map(path => ({ path, at: statSync(path).mtimeMs })).sort((a, b) => b.at - a.at || (a.path < b.path ? 1 : -1));
  return newest ? { path: newest.path, text: readFileSync(newest.path, 'utf8') } : null;
}

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
