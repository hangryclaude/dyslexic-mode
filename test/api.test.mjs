import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiSession, apiModels, baseOf } from '../lib/providers/api.mjs';
import { SERVICES, findService, serviceById } from '../lib/providers/services.mjs';

// Not a credential. The tests only check where it goes and that it never shows.
const KEY = 'FAKE-KEY-FOR-TESTS-0123456789';
const log = join(mkdtempSync(join(tmpdir(), 'dm-api-')), 'requests');
let server, fake;

// The fake model endpoint from the opencode tests: it streams "echo: <message>", says what it
// remembers, and logs every request body.
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/fake-openai.mjs', import.meta.url))], { env: { ...process.env, FAKE_OPENAI_LOG: log } });
  const port = await new Promise(res => server.stdout.once('data', d => res(/listening (\d+)/.exec(String(d))[1])));
  fake = { id: 'fake', name: 'Fake AI', base: `http://127.0.0.1:${port}/v1` };
});
after(() => server.kill());

const requests = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const lastBody = () => requests().at(-1).body;
const wait = ms => new Promise(r => setTimeout(r, ms));
const chat = opts => openApiSession({ service: fake, model: 'echo', key: KEY, ...opts });

test('a reply streams in pieces, and the request carries the model, the system prompt first and the key', async () => {
  const seen = [];
  const s = chat({ system: 'be brief', fetch: (url, init) => { seen.push({ url, init }); return fetch(url, init); } });
  const pieces = [];
  const r = await s.send('hello there', { onText: d => pieces.push(d) });
  assert.equal(r.text, 'echo: hello there');
  assert.ok(pieces.length > 1, 'more than one piece');
  assert.equal(pieces.join(''), r.text);
  assert.match(r.sessionId, /^api-/);
  assert.equal(seen[0].url, `${fake.base}/chat/completions`);
  assert.equal(seen[0].init.headers.authorization, `Bearer ${KEY}`);
  const body = lastBody();
  assert.equal(body.model, 'echo');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello there' }]);
  assert.ok(!('tools' in body), 'plain chat: no tools offered');
});

test('the chat remembers its turns, and an old chat comes back from its history', async () => {
  const s = chat();
  await s.send('first');
  assert.equal((await s.send('second')).text, 'echo: second [remembers: first]');
  const back = chat({ resume: 'api-old', history: [{ q: 'from before', text: 'an old answer' }] });
  const r = await back.send('again');
  assert.equal(r.text, 'echo: again [remembers: from before]');
  assert.equal(r.sessionId, 'api-old');
  assert.deepEqual(lastBody().messages.map(m => m.role), ['user', 'assistant', 'user']);
});

test('reasoning never shows up in the reply', async () => {
  const r = await chat().send('THINK about it');
  assert.equal(r.text, 'echo: THINK about it');
});

test('token counts come back in the app\'s shape, cache hits inside input', async () => {
  const r = await chat().send('CACHE me');
  assert.equal(r.usage.cached, 100);
  assert.ok(r.usage.input > 0 && r.usage.output > 0);
  assert.equal(r.usage.contextUsed, r.usage.input + r.usage.output);
});

test('esc stops a reply: what came in stays, and the chat carries on from it', async () => {
  const s = chat();
  const pieces = [];
  const reply = s.send('SLOW please', { onText: d => pieces.push(d) });
  while (!pieces.join('').includes('partial')) await wait(10);
  assert.equal(s.busy, true);
  assert.equal(s.interrupt(), true);
  const r = await reply;
  assert.equal(r.stopped, true);
  assert.match(r.text, /^partial/);
  assert.equal(s.busy, false);
  assert.equal((await s.send('next')).text, 'echo: next [remembers: SLOW please]');
});

test('closing a chat mid-reply settles it as stopped, and a closed chat takes no more', async () => {
  const s = chat();
  const pieces = [];
  const reply = s.send('SLOW again', { onText: d => pieces.push(d) });
  while (!pieces.length) await wait(10);
  s.close();
  assert.equal((await reply).stopped, true);
  await assert.rejects(s.send('more'), /this chat is closed/);
});

test('a refused request says why in the service\'s words, never shows the key, and leaves no trace in the chat', async () => {
  let calls = 0;
  const s = chat({
    fetch: (url, init) => (calls++ === 0
      ? new Response(JSON.stringify({ error: { message: `Invalid key ${KEY}` } }), { status: 401 })
      : fetch(url, init)),
  });
  await assert.rejects(s.send('lost'), err => {
    assert.equal(err.message, 'Fake AI said 401: Invalid key [key]. /key fake saves a new key.');
    return true;
  });
  await s.send('kept');
  assert.deepEqual(lastBody().messages, [{ role: 'user', content: 'kept' }]);
});

test('a service that refuses stream_options is asked again without it', async () => {
  const bodies = [];
  const s = chat({
    fetch: (url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options' } }), { status: 400 })
        : fetch(url, init);
    },
  });
  assert.equal((await s.send('hi')).text, 'echo: hi');
  assert.equal(bodies.length, 2);
  assert.ok(!('stream_options' in bodies[1]));
});

test('a service\'s list keeps its chat models, with a name to show and a window where it says', async () => {
  const data = [
    { id: 'gpt-5', owned_by: 'OpenAI', architecture: { output_modalities: ['text'] }, context_window: { context_length: 400000 } },
    { id: 'seedream-4.5', architecture: { output_modalities: ['image'] } },
    { id: 'kling-2.5-turbo-std', owned_by: 'fal', architecture: { output_modalities: ['text'] } },
    { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro', architecture: { modality: 'text+image->text' }, context_length: 1048576 },
    { id: 'models/gemini-2.5-flash', owned_by: 'google' },
    { id: 'text-embedding-3-small' },
    { id: 'whisper-large-v3' },
    { id: 'mistral-embed', capabilities: { completion_chat: false } },
    { id: 'mistral-large-latest', capabilities: { completion_chat: true }, max_context_length: 131072, type: 'base' },
    { id: 'llama3.2:latest', owned_by: 'library' },
  ];
  const seen = [];
  const got = await apiModels({ ...fake, base: 'https://example.invalid/v1' }, {
    key: KEY,
    fetch: async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ object: 'list', data })); },
  });
  assert.equal(seen[0].url, 'https://example.invalid/v1/models');
  assert.equal(seen[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(got, [
    { id: 'gpt-5', label: 'GPT-5', owner: 'OpenAI', contextWindow: 400000 },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', owner: null, contextWindow: 1048576 },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', owner: 'google', contextWindow: null },
    { id: 'mistral-large-latest', label: 'Mistral Large Latest', owner: null, contextWindow: 131072 },
    { id: 'llama3.2:latest', label: 'Llama3.2:latest', owner: 'library', contextWindow: null },
  ]);
});

test('a local server that is not running offers nothing, and a service that cannot be reached says so', async () => {
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  assert.deepEqual(await apiModels({ ...fake, local: true }, { fetch: down }), []);
  await assert.rejects(apiModels(fake, { key: KEY, fetch: down }), /Fake AI could not be reached: ECONNREFUSED/);
  await assert.rejects(apiModels(fake, { key: KEY, fetch: async () => new Response('nope', { status: 402 }) }), /Fake AI said 402: nope\./);
});

test('<ID>_BASE_URL points a service somewhere else', () => {
  const poe = serviceById('poe');
  assert.equal(baseOf(poe, {}), 'https://api.poe.com/v1');
  assert.equal(baseOf(poe, { POE_BASE_URL: 'http://127.0.0.1:9/v1/' }), 'http://127.0.0.1:9/v1');
});

test('every service has an id, a name, an address and a key name, unless it runs on this computer', () => {
  assert.equal(new Set(SERVICES.map(s => s.id)).size, SERVICES.length);
  for (const s of SERVICES) {
    assert.match(s.id, /^[a-z]+$/, s.id);
    assert.match(s.base, /^https?:\/\//, s.id);
    assert.ok(s.local || /^[A-Z_]+_API_KEY$/.test(s.env), s.id);
    assert.ok(s.name && s.note && s.site, s.id);
  }
});

test('a typed service name finds its service, typos and all', () => {
  assert.equal(findService('poe').id, 'poe');
  assert.equal(findService('OpenRouter').id, 'openrouter');
  assert.equal(findService('gemni').id, 'gemini');
  assert.equal(findService('lm studio').id, 'lmstudio');
  assert.equal(findService('nothing-like-it'), null);
  assert.equal(findService(''), null);
});
