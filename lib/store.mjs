import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Personal data lives outside the repo: what trips one reader belongs to them, not the project.
export const home = () => process.env.DYSLEXIC_MODE_HOME || join(homedir(), '.dyslexic-mode');
const path = name => { mkdirSync(home(), { recursive: true }); return join(home(), name); };

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
