import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { models, findModel, modelLine } from '../lib/modelmenu.mjs';
import { CLAUDE_MODELS } from '../lib/models.mjs';

let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dm-menu-'));
  process.env.DYSLEXIC_MODE_HOME = home;
});

const grok = (id, contextWindow, contextSource = 'grok config') => ({ id: `grok/${id}`, label: id, provider: 'grok', model: id, contextWindow, contextSource });
const opencode = (id, name, contextWindow) => ({ id, label: `${name} (${id.split('/')[0]})`, provider: 'opencode', model: id, contextWindow, contextSource: 'opencode model list' });
const LIST = [
  ...CLAUDE_MODELS,
  grok('grok-4.7', 256000),
  grok('grok-4.6', null, 'unknown'),
  opencode('opencode-go/gemini-4-argon', 'Gemini 4 Argon', 1048576),
  opencode('opencode/gpt-6-luna', 'GPT 6 Luna', 1050000),
  opencode('opencode-go/gpt-6-luna', 'GPT 6 Luna', 1050000),
];

test('with nothing asked yet the list is Claude\'s four, and a window a reply reported replaces the guess', () => {
  assert.deepEqual(models().map(m => m.id), ['claude/fable', 'claude/opus', 'claude/sonnet', 'claude/haiku']);
  assert.ok(models().every(m => m.provider === 'claude' && m.contextWindow === 200000));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ version: 1, fetchedAt: new Date(0).toISOString(), models: CLAUDE_MODELS, learned: { 'claude/sonnet': 1000000 } }));
  assert.equal(models().find(m => m.id === 'claude/sonnet').contextWindow, 1000000);
});

test('a picker row says what the model is, who runs it and how much it holds, and marks the one in use', () => {
  const [, opus, sonnet] = CLAUDE_MODELS;
  assert.equal(modelLine(opus, 'claude/opus'), 'Claude Opus, claude, 200,000 tokens, a guess (now)');
  assert.equal(modelLine(sonnet, 'claude/opus'), 'Claude Sonnet, claude, 200,000 tokens, a guess');
  assert.equal(modelLine({ ...sonnet, contextWindow: 1000000, contextSource: 'reported by the CLI' }, undefined), 'Claude Sonnet, claude, 1,000,000 tokens');
  assert.equal(modelLine(LIST[4], 'grok/grok-4.7'), 'grok-4.7, grok, 256,000 tokens (now)');
  assert.equal(modelLine(LIST[5], 'grok/grok-4.7'), 'grok-4.6, grok, window unknown');
});

test('a typed model is an id, a label, the name after the provider, a start, or a close spelling', () => {
  const id = typed => findModel(typed, LIST)?.id;
  assert.equal(id('claude/opus'), 'claude/opus');
  assert.equal(id('opus'), 'claude/opus');
  assert.equal(id('Opus'), 'claude/opus');
  assert.equal(id('Claude Sonnet'), 'claude/sonnet');
  assert.equal(id('son'), 'claude/sonnet');
  assert.equal(id('hiaku'), 'claude/haiku');
  assert.equal(id('grok-4.7'), 'grok/grok-4.7');
  assert.equal(id('grok/grok-4.6'), 'grok/grok-4.6');
  assert.equal(id('gemini-4-argon'), 'opencode-go/gemini-4-argon');
  assert.equal(id('opencode-go/gem'), 'opencode-go/gemini-4-argon');
  assert.equal(id('Gemini 4 Argon (opencode-go)'), 'opencode-go/gemini-4-argon');
});

test('a name two models share names neither, but an exact id always names one', () => {
  assert.equal(findModel('gpt-6-luna', LIST), null);
  assert.equal(findModel('claude', LIST), null, 'a start that every Claude model shares');
  assert.equal(findModel('opencode/gpt-6-luna', LIST).id, 'opencode/gpt-6-luna');
  assert.equal(findModel('opencode-go/gpt-6-luna', LIST).id, 'opencode-go/gpt-6-luna');
});

test('an id the list does not know is passed on if claude takes it, and refused if nothing does', () => {
  const custom = findModel('opus[1m]', LIST);
  assert.deepEqual(custom, { id: 'opus[1m]', label: 'opus[1m]', provider: 'claude', contextWindow: 1_000_000 });
  assert.equal(findModel('claude-opus-4-5', LIST).id, 'claude-opus-4-5');
  assert.equal(findModel('claude-opus-4-5', LIST).contextWindow, 200_000);
  for (const typed of ['nonsense', 'gpt-9', '', '  ', 'x/y z']) assert.equal(findModel(typed, LIST), null, JSON.stringify(typed));
});

test('any list with the same shape works, so a provider needs no change here', () => {
  const other = [{ id: 'gpt-5.5', label: 'GPT 5.5', provider: 'openai', contextWindow: 400_000 }];
  assert.equal(findModel('gpt-5.5', other).provider, 'openai');
  assert.equal(findModel('GPT 5.5', other).id, 'gpt-5.5');
});
