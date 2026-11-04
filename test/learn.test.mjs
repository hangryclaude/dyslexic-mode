import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, rows, readProfile, writeProfile, readSettings, saveSettings, sessions } from '../lib/store.mjs';
import { learn, distillPrompt } from '../lib/learn.mjs';
import { summarize, table } from '../lib/stats.mjs';
import { QUESTIONS, questionFor, order, pickOf, words } from '../lib/readtest.mjs';

beforeEach(() => { process.env.DYSLEXIC_MODE_HOME = mkdtempSync(join(tmpdir(), 'dm-home-')); });

test('store keeps jsonl rows and the profile in the data dir', () => {
  assert.deepEqual(rows('chats.jsonl'), []);
  append('chats.jsonl', { a: 1 });
  append('chats.jsonl', { a: 2 });
  assert.deepEqual(rows('chats.jsonl'), [{ a: 1 }, { a: 2 }]);
  assert.equal(readProfile(), '');
  writeProfile('- one\n\n');
  assert.equal(readProfile(), '- one');
});

test('learn logs the flag and rewrites the profile from the model rules', async () => {
  writeProfile('- old rule');
  const calls = [];
  const fake = async (p, o) => { calls.push({ p, o }); return { text: 'Sure:\n- old rule\n- keep tables to two columns\n' }; };
  const rules = await learn(fake, { reply: 'a wide table', note: 'the table was too wide' });
  assert.deepEqual(rules, ['- old rule', '- keep tables to two columns']);
  assert.equal(readProfile(), '- old rule\n- keep tables to two columns');
  assert.match(calls[0].p, /- old rule[\s\S]*Their note: the table was too wide[\s\S]*a wide table/);
  assert.equal(calls[0].o.model, 'haiku');
  assert.deepEqual(rows('flags.jsonl').map(f => f.note), ['the table was too wide']);
});

test('learn keeps the old profile when the model returns no rules', async () => {
  writeProfile('- keep me');
  await assert.rejects(learn(async () => ({ text: 'I cannot help.' }), { reply: 'r' }), /old profile was kept/);
  assert.equal(readProfile(), '- keep me');
});

test('learn caps the profile at 10 rules', async () => {
  const many = Array.from({ length: 14 }, (_, i) => `- rule ${i}`).join('\n');
  assert.equal((await learn(async () => ({ text: many }), { reply: 'r', note: 'n' })).length, 10);
});

test('distill prompt asks the model to infer when there is no note', () => {
  assert.match(distillPrompt('', { reply: 'r' }), /\(empty\)[\s\S]*left no note[\s\S]*at most one new rule/);
});

test('summarize reports rewrite rate, test wins and median read times', () => {
  const chats = [{ rewrites: 1 }, { rewrites: 0 }, { rewrites: 1 }];
  const tests = [
    { pick: 'reread', plain: { ms: 30000 }, reread: { ms: 10000 } },
    { pick: 'plain', plain: { ms: 20000 }, reread: { ms: 20000 } },
    { pick: 'same', plain: { ms: 10000 }, reread: { ms: 30000 } },
  ];
  const s = Object.fromEntries(summarize({ chats, tests, flags: [{}] }));
  assert.equal(s['Needed a rewrite'], '2 (67%)');
  assert.equal(s['Flagged hard'], '1');
  assert.equal(s['Test rounds'], '3 of 10');
  assert.equal(s['Re-read picked'], '1 of 3, 1 same');
  assert.equal(s['Read time, plain'], '20.0s');
  assert.equal(s['Read time, re-read'], '20.0s');
});

test('summarize handles an empty history', () => {
  const s = Object.fromEntries(summarize({ chats: [], tests: [], flags: [] }));
  assert.equal(s['Needed a rewrite'], '0');
  assert.equal(s['Read time, plain'], '-');
});

test('table lines up every row to the same width', () => {
  const lines = table([['Replies', '3'], ['Needed a rewrite', '2 (67%)']]).split('\n');
  assert.equal(new Set(lines.map(l => l.length)).size, 1);
  assert.match(lines[2], /\|\s+3 \|$/);
});

test('reading test helpers: question order, blind order, picks, word count', () => {
  assert.equal(questionFor(0), QUESTIONS[0]);
  assert.equal(questionFor(QUESTIONS.length), QUESTIONS[0]);
  assert.deepEqual(order(() => 0.1), ['plain', 'reread']);
  assert.deepEqual(order(() => 0.9), ['reread', 'plain']);
  assert.equal(pickOf('2', ['plain', 'reread']), 'reread');
  assert.equal(pickOf('s', ['plain', 'reread']), 'same');
  assert.equal(words(' two  words\n'), 2);
});

test('settings outlast a launch and merge instead of replacing', () => {
  assert.deepEqual(readSettings(), {});
  saveSettings({ model: 'haiku' });
  saveSettings({ thinking: 'strong' });
  assert.deepEqual(readSettings(), { model: 'haiku', thinking: 'strong' });
});

test('past chats group by session, newest first, with the first question and the last reply', () => {
  const chats = [
    { ts: 1, q: 'old row from before sessions were logged' },
    { ts: 2, session: 'a', q: 'how do backups work', text: 'r1', tools: true },
    { ts: 3, session: 'b', q: 'what is a neuron', text: 'r2', tools: false },
    { ts: 4, session: 'a', q: 'and the cost?', text: 'r3', tools: true },
  ];
  const s = sessions(chats);
  assert.deepEqual(s.map(x => x.id), ['a', 'b']);
  assert.deepEqual(s[0], { id: 'a', first: 'how do backups work', tools: true, turns: 2, ts: 4, last: { q: 'and the cost?', text: 'r3' } });
});

test('summarize reports how fast the first line shows', () => {
  const s = Object.fromEntries(summarize({ chats: [{ first: 900 }, { first: 1500 }, {}], tests: [], flags: [] }));
  assert.equal(s['First line shown'], '1.2s');
});

test('a past chat remembers the model that began it, and a row from before models were logged has none', () => {
  const chats = [
    { ts: 1, session: 'old', q: 'before models', text: 'r0' },
    { ts: 2, session: 'grok', q: 'on grok', text: 'r1', model: 'grok/grok-4.7' },
    { ts: 3, session: 'grok', q: 'still grok', text: 'r2', model: 'grok/grok-4.7' },
    { ts: 4, session: 'plain', q: 'default model', text: 'r3', model: null },
  ];
  const byId = Object.fromEntries(sessions(chats).map(x => [x.id, x]));
  assert.equal(byId.grok.model, 'grok/grok-4.7');
  assert.equal(byId.plain.model, null);
  assert.ok(!('model' in byId.old));
});
