import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MENU } from '../lib/commands.mjs';
import { LEVEL_NAMES } from '../lib/think.mjs';
import { NO_KEY } from '../lib/voicechat.mjs';
import { SERVICES } from '../lib/providers/services.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const README = read('README.md');
const section = title => README.split(/^## /m).find(s => s.startsWith(`${title}\n`));

test('the README table lists every command the app has, and no command it does not have', () => {
  const table = section('Commands');
  const listed = new Set([...table.matchAll(/^\| `([!/][a-z]*)[ `]/gm)].map(m => m[1]));
  assert.deepEqual([...listed].sort(), MENU.map(([name]) => name).sort());
});

test('the README leads with the thinking modes and has a row for every level', () => {
  assert.ok(README.indexOf('## Thinking modes') > 0 && README.indexOf('## Thinking modes') < README.indexOf('## Run it'));
  const modes = section('Thinking modes');
  for (const level of LEVEL_NAMES) assert.match(modes, new RegExp(`^\\| \`${level}\` \\|`, 'm'), level);
});

test('the README covers every AI, ChatGPT voice and the keys policy, and quotes the line the app prints with no key', () => {
  for (const title of ['Every AI', 'ChatGPT voice', 'Keys and secrets']) assert.ok(section(title), title);
  assert.ok(section('ChatGPT voice').includes(NO_KEY));
  const keys = section('Keys and secrets');
  for (const part of ['Keychain', 'never written to a file', 'POE_API_KEY', '/key', '[key]', 'gitleaks']) assert.ok(keys.includes(part), part);
  const models = section('Every AI');
  for (const part of ['claude/opus', 'api/poe/gpt-5', 'grok', 'opencode', '/model refresh', 'Only Claude gets tools']) assert.ok(models.includes(part), part);
});

test('the services table has a row for every service, with its /key and its variable', () => {
  const rows = section('Every AI').split('\n');
  for (const s of SERVICES) {
    const row = rows.find(line => line.startsWith(`| ${s.name} |`));
    assert.ok(row, s.name);
    if (!s.local) for (const part of [`\`/key ${s.id}\``, `\`${s.env}\``]) assert.ok(row.includes(part), `${s.name}: ${part}`);
  }
});

test('reading aloud is gone from the docs', () => {
  assert.doesNotMatch(README, /aloud|tab reads|`\/read`/i);
});

test('every picture the README shows is in the repo', () => {
  const pictures = [...README.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]).filter(src => !/^https?:/.test(src));
  assert.ok(pictures.length >= 3, pictures.join(', '));
  for (const src of pictures) assert.ok(existsSync(new URL(`../${src}`, import.meta.url)), src);
});
