// The real `opencode` binary against a fake model endpoint (test/fixtures/fake-openai.mjs), so the
// real protocol, the real permission rules and the real token accounting are exercised without a
// quota. It adds chats to the user's own opencode database, so it only runs on request:
//   DYSLEXIC_INTEGRATION=1 npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openOpencodeSession } from '../lib/providers/opencode.mjs';

const skip = process.env.DYSLEXIC_INTEGRATION === '1' ? false : 'set DYSLEXIC_INTEGRATION=1 to run against the real opencode';
const FAKE_MODEL = fileURLToPath(new URL('./fixtures/fake-openai.mjs', import.meta.url));
const SYSTEM = 'You are the integration test bot. Answer briefly.';
let dir, fake, extraConfig, log;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'dm-int-'));
  log = join(dir, 'requests');
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
  fake = spawn('node', [FAKE_MODEL, '0'], { env: { ...process.env, FAKE_OPENAI_LOG: log }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise(r => createInterface({ input: fake.stdout }).once('line', l => r(l.split(' ')[1])));
  extraConfig = { providers: { fake: { name: 'Fake', package: '@ai-sdk/openai-compatible', settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'test' }, models: { echo: { name: 'Echo', limit: { context: 32000, output: 4096 } } } } } };
});
after(() => fake?.kill());

const requests = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l).body) : []);
const tokens = s => Math.ceil(s.length / 4);
const open = () => openOpencodeSession({ system: SYSTEM, model: 'fake/echo', extraConfig });

test('the model is sent our system prompt and no tool at all, remembers turn 1, and its token use is the endpoint\'s own', { skip, timeout: 90000 }, async () => {
  const s = open();
  try {
    const before = requests().length;
    const a = await s.send('hello');
    const b = await s.send('again');
    const sent = requests().slice(before);
    assert.equal(sent.length, 2);
    for (const body of sent) {
      assert.equal((body.tools ?? []).length, 0, 'no tool offered');
      assert.equal(body.tool_choice ?? null, null);
    }
    const system = sent[0].messages.find(m => m.role === 'system').content;
    assert.ok((typeof system === 'string' ? system : system.map(p => p.text).join('')).startsWith(SYSTEM));
    assert.deepEqual(sent[1].messages.filter(m => m.role === 'user').map(m => m.content), ['hello', 'again']);
    assert.equal(b.text, 'echo: again [remembers: hello]');
    assert.equal(b.sessionId, a.sessionId);
    const prompt = tokens(JSON.stringify(sent[1].messages));
    assert.deepEqual(b.usage, { input: prompt, output: tokens(b.text), cached: 0, contextUsed: prompt + tokens(b.text) });
  } finally {
    s.close();
  }
});

test('a model that calls a tool anyway runs nothing, and the reply still ends', { skip, timeout: 90000 }, async () => {
  const s = open();
  try {
    const before = requests().length;
    const tools = [];
    await s.send('FORCETOOL list the files', { onTool: b => tools.push(b) });
    assert.ok(tools.length >= 1 && tools.every(t => t.name === 'bash'), 'the attempt is reported');
    assert.ok(requests().length - before <= 3, 'steps are capped');
  } finally {
    s.close();
  }
});

test('interrupt stops a streaming reply, and the chat carries on', { skip, timeout: 90000 }, async () => {
  const s = open();
  try {
    const r = await s.send('SLOW go', { onText: () => { s.interrupt(); } });
    assert.equal(r.stopped, true);
    assert.ok(r.text.startsWith('partial'));
    assert.equal((await s.send('next')).text, 'echo: next [remembers: SLOW go]');
  } finally {
    s.close();
  }
});
