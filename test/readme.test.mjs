import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MENU } from '../lib/commands.mjs';
import { LEVEL_NAMES } from '../lib/think.mjs';
import { NO_KEY } from '../lib/voicechat.mjs';

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

test('the README covers any model, ChatGPT voice and the keys policy, and quotes the line the app prints with no key', () => {
  for (const title of ['Any model', 'ChatGPT voice', 'Keys and secrets']) assert.ok(section(title), title);
  assert.ok(section('ChatGPT voice').includes(NO_KEY));
  const keys = section('Keys and secrets');
  for (const part of ['Keychain', 'never written to a file', 'OPENAI_API_KEY', '/key', '[key]', 'gitleaks']) assert.ok(keys.includes(part), part);
  const models = section('Any model');
  for (const part of ['claude/opus', 'grok', 'opencode', '/model refresh', "Claude's alone"]) assert.ok(models.includes(part), part);
});

test('reading aloud is gone from the docs and from the recording', () => {
  for (const path of ['README.md', 'media/chat.svg']) assert.doesNotMatch(read(path), /aloud|tab reads|`\/read`/i, path);
});
