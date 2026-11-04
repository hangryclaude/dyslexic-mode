import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { home } from '../store.mjs';
import { opencodeUsage } from '../usage.mjs';

const run = promisify(execFile);

// opencode ties a chat to the folder it started in, so every chat runs from here.
const chatFolder = () => {
  const dir = join(home(), 'opencode');
  mkdirSync(dir, { recursive: true });
  return dir;
};

const AGENT = 'dyslexic-chat';
const DENY_ALL = [{ action: '*', resource: '*', effect: 'deny' }];

// The whole setup, handed to a private server as OPENCODE_CONFIG_CONTENT, so the user's own
// opencode config is never touched. System prompt: the agent's `system` replaces opencode's coding
// prompt. Tools: opencode puts the user's global permission rules (here, allow everything) first
// and an agent's own rules after them, so this agent's last rule, deny everything, wins; opencode
// then leaves every tool out of the request to the model (checked against a model endpoint that
// logged the request: no tools, no tool_choice). `steps` caps a model that calls a tool anyway.
export function serverConfig({ system, extra = {} }) {
  return {
    ...extra,
    agents: {
      ...extra.agents,
      // Naming each new chat is a second model call nobody asked for.
      title: { disabled: true },
      [AGENT]: { mode: 'primary', ...(system && { system }), steps: 3, permissions: DENY_ALL },
    },
  };
}

// "opencode-go/gemini-4-argon" or "provider/model#variant" as opencode's API wants it.
export function splitModel(model) {
  const m = /^([^/#]+)\/([^#]+)(?:#(.+))?$/.exec(model ?? '');
  if (!m) throw new Error(`opencode models look like provider/model, not "${model}"`);
  return { providerID: m[1], id: m[2], ...(m[3] && { variant: m[3] }) };
}

// A server of our own on a free port, with a password only this process knows. `serve --stdio`
// prints {"url": ...} on its first line and exits when its stdin closes, so it cannot outlive this
// process, even a killed one. The user's background opencode service is never used.
export async function startServer({ bin = process.env.DYSLEXIC_OPENCODE_BIN || 'opencode', config, ready = 20000 }) {
  const password = randomBytes(16).toString('hex');
  const env = {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_SERVER_PASSWORD: password,
    // CLAUDE.md, skills and AGENTS.md files are for coding, not for this chat. Without the two
    // PROJECT switches opencode walks up from the chat folder and reads the user's ~/AGENTS.md.
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG_PROJECT_DISABLE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_FILEWATCHER: '1',
  };
  const child = spawn(bin, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], { cwd: chatFolder(), env, stdio: ['pipe', 'pipe', 'pipe'] });
  const server = { child, stderr: '', url: null, auth: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  child.stderr.on('data', d => { server.stderr = (server.stderr + d).slice(-2000); });
  // Ending stdin on a process that has already gone would otherwise be an unheard stream error.
  child.stdin.on('error', () => {});
  server.stop = (hard = false) => {
    child.stdin.end();
    if (hard) return child.kill();
    const timer = setTimeout(() => child.kill(), 1500);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  };
  server.url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('opencode did not start')); }, ready);
    createInterface({ input: child.stdout }).once('line', line => {
      clearTimeout(timer);
      try { resolve(JSON.parse(line).url); } catch { child.kill(); reject(new Error(`unexpected output from opencode: ${line.slice(0, 100)}`)); }
    });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', code => { clearTimeout(timer); reject(new Error(server.stderr.trim() || `opencode exited ${code} before it was ready`)); });
  });
  server.api = async (method, path, body) => {
    const res = await fetch(server.url + path, {
      method,
      headers: { authorization: server.auth, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`opencode ${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
    return text ? JSON.parse(text) : null;
  };
  return server;
}

// The server's events: "data: {json}" frames, with ": heartbeat" comments between them.
export async function* events(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data) yield JSON.parse(data);
    }
  }
}

const ago = ms => (ms >= 864e5 ? `${(ms / 864e5).toFixed(1)} days` : ms >= 36e5 ? `${(ms / 36e5).toFixed(1)} hours` : `${Math.max(1, Math.round(ms / 6e4))} minutes`);
// opencode's error as a sentence, with how long a quota is out for when it says.
export const describe = (e = {}) => `${e.message || e.type || 'opencode failed'}${e.retryAfterMs > 6e4 ? ` (try again in ${ago(e.retryAfterMs)})` : ''}`;

// A chat on a server of its own, started with the first message (or warm) and ended by close. The
// chat itself lives in opencode's database, so a server that dies, or a later launch, picks it up by id.
// `extraConfig` is merged under ours; the tests use it to add a model endpoint.
export function openOpencodeSession({ system, model, resume, bin, extraConfig }) {
  let server = null, ready = null, id = resume, turn = null, closed = false;
  const wanted = model ? splitModel(model) : null;

  const settle = (how, value) => {
    const t = turn;
    turn = null;
    if (!t) return;
    clearTimeout(t.timer);
    t.ac.abort();
    t[how](value);
  };
  const stopped = t => ({ text: t.text, sessionId: id, stopped: true, usage: opencodeUsage(t.steps) });

  async function boot() {
    const s = await startServer({ bin, config: serverConfig({ system, extra: extraConfig }) });
    server = s;
    s.child.on('close', code => {
      if (server !== s) return;
      server = null;
      ready = null;
      if (turn) settle('reject', new Error(s.stderr.trim().slice(-300) || `opencode exited ${code}`));
    });
    try {
      if (id) {
        const known = await s.api('GET', `/api/session/${id}`).catch(err => { throw err.status === 404 ? new Error(`opencode has no chat ${id}`) : err; });
        const now = known.data.model;
        if (wanted && (now?.id !== wanted.id || now?.providerID !== wanted.providerID)) await s.api('POST', `/api/session/${id}/model`, { model: wanted });
      } else {
        const made = await s.api('POST', '/api/session', {
          agent: AGENT, ...(wanted && { model: wanted }), location: { directory: chatFolder() }, title: 'dyslexic mode', permissions: DENY_ALL,
        });
        id = made.data.id;
      }
    } catch (err) {
      s.stop(true);
      throw err;
    }
  }

  const ensure = () => (ready ??= boot().catch(err => { ready = null; throw err; }));

  function emit(t, s) {
    t.text += s;
    t.onText?.(s);
  }

  function onEvent(t, ev) {
    const d = ev.data ?? {};
    if (d.sessionID !== id) return;
    switch (ev.type) {
      case 'session.text.started':
        t.block = '';
        if (t.text) emit(t, '\n\n');
        break;
      case 'session.text.delta':
        t.block += d.delta;
        emit(t, d.delta);
        break;
      // The deltas should add up to the block; if the last ones were lost, the rest is added here.
      case 'session.text.ended':
        if (d.text.length > t.block.length && d.text.startsWith(t.block)) emit(t, d.text.slice(t.block.length));
        break;
      case 'session.tool.input.started':
        t.tools.set(d.id, d.name);
        break;
      case 'session.tool.called':
        t.onTool?.({ name: t.tools.get(d.id) ?? 'tool', input: d.input });
        break;
      case 'session.step.ended':
        t.steps.push(d.tokens);
        break;
      case 'session.step.failed':
        t.error = d.error;
        break;
      // opencode retries a failing model endpoint for minutes; a chat gives up after two tries.
      case 'session.retry.scheduled':
        if (++t.retries > 2) giveUp(t, d.error);
        break;
      case 'session.execution.succeeded':
        settle('resolve', t.stopped ? stopped(t) : { text: t.text, sessionId: id, usage: opencodeUsage(t.steps) });
        break;
      case 'session.execution.interrupted':
        settle('resolve', stopped(t));
        break;
      case 'session.execution.failed':
        settle('reject', new Error(describe(d.error ?? t.error)));
        break;
    }
  }

  function giveUp(t, error) {
    server?.api('POST', `/api/session/${id}/interrupt`).catch(() => {});
    settle('reject', new Error(describe(error ?? t.error)));
  }

  // Reads the server's events for one reply. It is opened before the message goes in, so none is missed.
  async function pump(t, s) {
    // A server that died ends the stream first, or breaks it ("terminated") when the socket is reset
    // under load. Its exit comes with what it said on stderr, which says more than either does, so
    // it gets a moment to land.
    const exited = () => Promise.race([new Promise(r => s.child.once('close', r)), new Promise(r => setTimeout(r, 500))]);
    try {
      const res = await fetch(`${s.url}/api/event`, { headers: { authorization: s.auth }, signal: t.ac.signal });
      if (!res.ok) throw new Error(`opencode events answered ${res.status}`);
      for await (const ev of events(res.body)) {
        if (ev.type === 'server.connected') t.connected();
        else onEvent(t, ev);
        if (turn !== t) return;
      }
      await exited();
      if (turn === t) settle('reject', new Error('lost the connection to opencode'));
    } catch (err) {
      if (turn !== t || t.ac.signal.aborted) return;
      await exited();
      if (turn === t) settle('reject', err);
    }
  }

  async function converse(t, prompt) {
    await ensure();
    if (turn !== t) return;
    if (t.stopped) return settle('resolve', stopped(t));
    const s = server;
    const connected = new Promise(r => { t.connected = r; });
    pump(t, s);
    // A server that never says it is connected is waited for briefly, not forever.
    await Promise.race([connected, new Promise(r => setTimeout(r, 3000))]);
    if (t.stopped) return settle('resolve', stopped(t));
    t.posted = true;
    await s.api('POST', `/api/session/${id}/prompt`, { text: prompt });
    // Stopped while the message was going in: the first interrupt may have found nothing to stop.
    if (t.stopped && turn === t) stopRun(t);
  }

  // Asks opencode to stop; it answers with an interrupted event, which settles the reply as stopped.
  // If it never does, the server is ended and the reply settles anyway, with what streamed.
  function stopRun(t) {
    const s = server;
    s?.api('POST', `/api/session/${id}/interrupt`).catch(() => s.stop(true));
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      if (turn !== t) return;
      settle('resolve', stopped(t));
      s?.stop(true);
    }, 4000);
  }

  return {
    get id() { return id; },
    get busy() { return !!turn; },
    // Starts the server and the chat early, so that overlaps something else, like the intro.
    warm() { if (!closed) ensure().catch(() => {}); },
    send(prompt, { onText, onTool } = {}) {
      if (closed) return Promise.reject(new Error('this chat is closed'));
      if (turn) return Promise.reject(new Error('a reply is still running'));
      return new Promise((resolve, reject) => {
        const t = { resolve, reject, onText, onTool, text: '', block: '', stopped: false, posted: false, steps: [], retries: 0, tools: new Map(), error: null, ac: new AbortController(), timer: null };
        turn = t;
        converse(t, prompt).catch(err => { if (turn === t) settle('reject', err); });
      });
    },
    interrupt() {
      const t = turn;
      if (!t || t.stopped) return false;
      t.stopped = true;
      if (t.posted) stopRun(t);
      return true;
    },
    close() {
      closed = true;
      const busy = turn;
      if (busy) settle('resolve', stopped(busy));
      const s = server;
      server = null;
      ready = null;
      s?.stop(!!busy);
    },
  };
}

// `opencode models` prints one provider/model per line.
export const parseOpencodeModels = text => text.split('\n').map(l => l.trim()).filter(l => /^[^\s/]+\/\S+$/.test(l));

// GET /api/model: every model the server knows, with its limits. Models that are switched off or
// retired are left out.
export function parseApiModels(json) {
  return (json?.data ?? [])
    .filter(m => m.enabled !== false && m.status !== 'deprecated')
    .map(m => ({ id: `${m.providerID}/${m.modelID}`, name: m.name, contextWindow: m.limit?.context ?? null }));
}

// opencode's cached copy of the models.dev catalog: { provider: { models: { id: { limit: { context } } } } }.
export function parseModelsDev(json) {
  const out = new Map();
  for (const [provider, p] of Object.entries(json ?? {})) {
    for (const [model, m] of Object.entries(p?.models ?? {})) if (Number.isFinite(m?.limit?.context)) out.set(`${provider}/${model}`, m.limit.context);
  }
  return out;
}

// The models opencode can chat with, each with its context window. The server is asked first, as it
// knows the user's own providers and this week's models. If that fails, `opencode models` gives the
// names and opencode's cached catalog gives the windows it has (null for the rest).
export async function opencodeModels({ bin = process.env.DYSLEXIC_OPENCODE_BIN || 'opencode', extraConfig, cacheFile = join(homedir(), '.cache', 'opencode', 'models.json') } = {}) {
  try {
    const server = await startServer({ bin, config: serverConfig({ extra: extraConfig }) });
    try {
      return parseApiModels(await server.api('GET', '/api/model'));
    } finally {
      server.stop(true);
    }
  } catch {
    const { stdout } = await run(bin, ['models'], { timeout: 30000 });
    const windows = existsSync(cacheFile) ? parseModelsDev(JSON.parse(readFileSync(cacheFile, 'utf8'))) : new Map();
    return parseOpencodeModels(stdout).map(id => ({ id, name: id, contextWindow: windows.get(id) ?? null }));
  }
}
