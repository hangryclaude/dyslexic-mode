#!/usr/bin/env node
// Stands in for the `opencode` CLI. `models` prints a list. `serve --stdio` runs a small server with
// the routes and events the real v2 server has (as seen from its OpenAPI document and event
// stream): it prints {"url"} first, wants Basic auth with OPENCODE_SERVER_PASSWORD, and exits when
// stdin closes. FAKE_LOG gets the argv, the OPENCODE_* environment, the cwd, the inline config and
// the body of every session created. FAKE_OC_STATE keeps chats between server processes, as the real
// database does. The prompt's first word picks a behaviour: DIE, FAIL, RETRY, SLOW (runs until
// interrupted), TOOL, THINK. FAKE_NO_SERVE makes `serve` fail, to test the fallback.
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const log = o => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\n');
if (argv[0] === 'models') {
  console.log('opencode-go/gemini-4-argon\nopencode-go/gpt-6-luna\nfake/echo\nnot a model line');
  process.exit(0);
}
if (process.env.FAKE_NO_SERVE) { console.error('serve is broken'); process.exit(1); }

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('OPENCODE_')));
log({ argv, env, cwd: process.cwd(), pid: process.pid, config: JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? 'null') });
const password = process.env.OPENCODE_SERVER_PASSWORD;
const state = () => (existsSync(process.env.FAKE_OC_STATE) ? JSON.parse(readFileSync(process.env.FAKE_OC_STATE, 'utf8')) : { n: 0, chats: {} });
const save = s => writeFileSync(process.env.FAKE_OC_STATE, JSON.stringify(s));

const clients = new Set();
const send = (type, data) => {
  for (const res of clients) res.write(`data: ${JSON.stringify({ id: `evt_${Math.random()}`, type, data })}\n\n`);
};
const running = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(sid, text) {
  const s = state();
  const chat = s.chats[sid];
  chat.prompts.push(text);
  save(s);
  const n = chat.prompts.length;
  const d = extra => ({ sessionID: sid, assistantMessageID: 'msg_a', ...extra });
  const stop = { interrupted: false };
  running.set(sid, stop);
  send('session.execution.started', { sessionID: sid });
  if (text.startsWith('DIE')) { console.error('boom from fake opencode'); process.exit(3); }
  if (text.startsWith('FAIL')) {
    const error = { type: 'provider.quota', message: 'Go usage limit exceeded', status: 429, retryAfterMs: 444354000 };
    send('session.step.failed', d({ error }));
    send('session.execution.failed', { sessionID: sid, error });
    return running.delete(sid);
  }
  if (text.startsWith('RETRY')) {
    for (let i = 1; i <= 4; i++) send('session.retry.scheduled', d({ attempt: i + 1, error: { type: 'provider.invalid-output', message: 'stream ended without finish_reason' } }));
    return; // then silence: a chat that waited here would wait for minutes
  }
  send('session.step.started', d({ agent: 'dyslexic-chat' }));
  if (text.startsWith('TOOL')) {
    send('session.tool.input.started', d({ id: 'call_1', name: 'bash' }));
    send('session.tool.called', d({ id: 'call_1', input: { command: 'ls' }, executed: false }));
    send('session.tool.failed', d({ id: 'call_1', error: { message: 'No tool named "bash" is currently available.' }, executed: false }));
    send('session.step.ended', d({ finish: 'tool-calls', tokens: { input: 7, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }));
    send('session.step.started', d({ agent: 'dyslexic-chat' }));
  }
  if (text.startsWith('THINK')) {
    send('session.reasoning.started', d({ ordinal: 0 }));
    send('session.reasoning.delta', d({ ordinal: 0, delta: 'secret reasoning' }));
    send('session.reasoning.ended', d({ ordinal: 0, text: 'secret reasoning' }));
  }
  send('session.text.started', d({ ordinal: 0 }));
  if (text.startsWith('SLOW')) {
    send('session.text.delta', d({ ordinal: 0, delta: 'partial ' }));
    while (!stop.interrupted) { await sleep(30); send('session.text.delta', d({ ordinal: 0, delta: '.' })); }
    send('session.text.ended', d({ ordinal: 0, text: 'partial ' }));
    send('session.step.failed', d({ error: { type: 'aborted', message: 'Step interrupted' } }));
    send('session.execution.interrupted', { sessionID: sid, reason: 'user' });
    return running.delete(sid);
  }
  const reply = `echo: ${text}${n > 1 ? ` [remembers: ${chat.prompts[0]}]` : ''}`;
  // Two text blocks when asked, so the gap between blocks can be seen.
  const parts = text.startsWith('TWO') ? ['first block', 'second block'] : [reply];
  for (const [ordinal, part] of parts.entries()) {
    if (ordinal) send('session.text.started', d({ ordinal }));
    for (let i = 0; i < part.length; i += 4) { await sleep(10); send('session.text.delta', d({ ordinal, delta: part.slice(i, i + 4) })); }
    send('session.text.ended', d({ ordinal, text: part }));
  }
  // Turn n reads 10 * n fresh tokens, 5 cached and 1 newly cached; it writes the reply and 2 of reasoning.
  send('session.step.ended', d({ finish: 'stop', cost: 0, tokens: { input: 10 * n, output: parts.join('').length, reasoning: 2, cache: { read: 5, write: 1 } } }));
  send('session.execution.succeeded', { sessionID: sid });
  running.delete(sid);
}

const reply = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`) return reply(res, 401, { message: 'Authentication required' });
    const body = raw ? JSON.parse(raw) : null;
    const url = req.url.split('?')[0];
    const m = /^\/api\/session\/([^/]+)(?:\/(\w+))?$/.exec(url);
    if (url === '/api/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'server.connected', data: {} })}\n\n`);
      clients.add(res);
      return res.on('close', () => clients.delete(res));
    }
    if (url === '/api/model') {
      const model = (providerID, modelID, name, context, extra = {}) => ({ providerID, modelID, id: modelID, name, enabled: true, status: 'active', limit: { context, output: 4096 }, ...extra });
      return reply(res, 200, { location: {}, data: [
        model('opencode-go', 'gemini-4-argon', 'Gemini 4 Argon', 1048576),
        model('opencode-go', 'gpt-6-luna', 'GPT-6 Luna', 1050000),
        model('fake', 'echo', 'Echo', 32000),
        model('opencode', 'old-one', 'Old One', 8000, { status: 'deprecated' }),
        model('opencode', 'switched-off', 'Switched Off', 8000, { enabled: false }),
      ] });
    }
    if (req.method === 'POST' && url === '/api/session') {
      const s = state();
      const id = `ses_fake${++s.n}`;
      s.chats[id] = { model: body.model, prompts: [] };
      save(s);
      log({ created: body });
      return reply(res, 200, { data: { id, model: body.model } });
    }
    if (m) {
      const [, sid, action] = m;
      const chat = state().chats[sid];
      if (!chat) return reply(res, 404, { message: 'no such session' });
      if (!action) return reply(res, 200, { data: { id: sid, model: chat.model } });
      if (action === 'model') {
        const s = state();
        s.chats[sid].model = body.model;
        save(s);
        log({ switched: body });
        return reply(res, 200, { data: { id: sid } });
      }
      if (action === 'prompt') {
        reply(res, 200, { data: { id: 'msg_u', sessionID: sid } });
        return void run(sid, body.text);
      }
      if (action === 'interrupt') {
        const r = running.get(sid);
        if (r) r.interrupted = true;
        return reply(res, 200, { interrupted: !!r });
      }
    }
    reply(res, 404, { message: `no route ${req.method} ${url}` });
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })}\n`));
// Like the real one, this ends when its stdin does.
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
