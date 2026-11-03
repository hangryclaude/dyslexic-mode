import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { home } from '../store.mjs';
import { claudeUsage, unknownUsage } from '../usage.mjs';

const run = promisify(execFile);

// A grok session can only be resumed from the folder it started in, so every chat runs from here.
const chatFolder = () => {
  const dir = join(home(), 'grok');
  mkdirSync(dir, { recursive: true });
  return dir;
};

// grok -p is a coding agent that reads the user's CLAUDE.md, ~100 skills and every MCP server into
// each reply (about 40k prompt tokens). These switches, found in grok's docs, keep a chat to the
// system prompt and the conversation. The init event lists the tools that are left; see onEvent.
const COMPAT = ['AGENTS', 'RULES', 'SKILLS', 'MCPS', 'HOOKS'];
export function plainEnv(env = process.env) {
  const out = { ...env, GROK_MEMORY: '0', GROK_SUBAGENTS: '0', GROK_WORKFLOWS: '0', GROK_WEB_FETCH: '0' };
  for (const vendor of ['CLAUDE', 'CURSOR']) for (const what of COMPAT) out[`GROK_${vendor}_${what}_ENABLED`] = 'false';
  return out;
}

// How to start one reply. The prompt and the system prompt go in as --flag=value, so text that starts
// with "-" is never read as a flag. System prompt: --system-prompt-override replaces grok's own.
// Tools: --tools with an empty value is ignored, so one harmless tool is allowed and then denied,
// along with the two MCP gateway tools that --tools leaves in.
export function launch({ prompt, system, model, effort, sessionId, resume, bin = process.env.DYSLEXIC_GROK_BIN || 'grok' }) {
  const args = [
    `--single=${prompt}`,
    '--output-format', 'streaming-messages-json', '--include-partial-messages',
    '--tools', 'todo_write', '--disallowed-tools', 'todo_write,search_tool,use_tool',
    '--no-subagents', '--disable-web-search', '--no-plan', '--max-turns', '3',
  ];
  if (system) args.push(`--system-prompt-override=${system}`);
  if (model) args.push('--model', model);
  // grok-4.7 reasons at "high" unless told otherwise, and a long answer can take minutes to start.
  if (effort) args.push('--reasoning-effort', effort);
  args.push(...(resume ? ['--resume', resume] : ['--session-id', sessionId]));
  const cwd = chatFolder();
  args.push('--cwd', cwd);
  return { cmd: bin, args, options: { stdio: ['ignore', 'pipe', 'pipe'], env: plainEnv(), cwd } };
}

// One grok process per reply: `grok -p` has no way to take a second message, so the chat lives in
// grok's own session and each reply resumes it. A reply costs about two seconds of start-up.
export function openGrokSession({ system, model, effort, resume, bin }) {
  let id = resume, fresh = null, proc = null, turn = null, closed = false;

  // Each process answers one turn and may end after the next turn has begun, so everything it
  // does is checked against its own turn.
  const settle = (t, how, value) => {
    if (turn !== t) return;
    turn = null;
    t[how](value);
  };
  const stopped = t => ({ text: t.text, sessionId: id, stopped: true, usage: unknownUsage() });

  function start(t, prompt) {
    // A new chat gets its id up front, so the first reply and the ones after it name the same session.
    if (!id) fresh ??= randomUUID();
    const { cmd, args, options } = launch({ prompt, system, model, effort, resume: id, sessionId: fresh, bin });
    const child = spawn(cmd, args, options);
    let stderr = '';
    proc = child;
    child.stderr.on('data', d => { stderr += d; });
    createInterface({ input: child.stdout }).on('line', line => {
      if (!line.trim()) return;
      // A throw in here would bypass the promise and kill the chat, so odd output fails the reply instead.
      let ev;
      try { ev = JSON.parse(line); } catch (err) {
        child.kill();
        return settle(t, 'reject', new Error(`unexpected output from grok: ${err.message}`));
      }
      onEvent(t, ev, child);
    });
    child.on('error', err => settle(t, 'reject', err));
    child.on('close', code => {
      if (proc === child) proc = null;
      if (t.stopped) settle(t, 'resolve', stopped(t));
      else settle(t, 'reject', new Error(stderr.trim() || `grok exited ${code} with no result`));
    });
  }

  function onEvent(t, ev, child) {
    if (turn !== t || ev.parent_tool_use_id) return;
    if (ev.session_id) id = ev.session_id;
    if (ev.type === 'system' && ev.subtype === 'init') {
      // Fails closed: a grok that still lists a tool is not the plain chat this app promises, and its
      // permission mode is usually "always approve".
      if (ev.tools?.length) {
        child.kill();
        settle(t, 'reject', new Error(`grok offered ${ev.tools.length} tools (${ev.tools.slice(0, 3).join(', ')}...) in plain chat, so it was stopped`));
      }
    } else if (ev.type === 'stream_event') {
      const e = ev.event;
      if (e.type === 'content_block_start' && e.content_block?.type === 'text' && t.text) emit(t, '\n\n');
      // thinking_delta is its reasoning, not the reply.
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') emit(t, e.delta.text);
    } else if (ev.type === 'result') {
      if (t.stopped) settle(t, 'resolve', stopped(t));
      else if (ev.is_error || ev.subtype !== 'success') settle(t, 'reject', new Error(String(ev.result || ev.subtype)));
      else settle(t, 'resolve', { text: ev.result ?? t.text, sessionId: id, usage: claudeUsage(ev) });
    }
  }

  function emit(t, s) {
    t.text += s;
    t.onText?.(s);
  }

  return {
    get id() { return id; },
    get busy() { return !!turn; },
    // Nothing to start early: grok has no process between replies.
    warm() { chatFolder(); },
    send(prompt, { onText } = {}) {
      if (closed) return Promise.reject(new Error('this chat is closed'));
      if (turn) return Promise.reject(new Error('a reply is still running'));
      return new Promise((resolve, reject) => {
        turn = { resolve, reject, onText, text: '', stopped: false };
        start(turn, prompt);
      });
    },
    // Ends the process. What streamed so far is kept, and the next reply resumes the same session.
    interrupt() {
      if (!turn || !proc || turn.stopped) return false;
      turn.stopped = true;
      proc.kill('SIGTERM');
      return true;
    },
    close() {
      closed = true;
      if (turn) settle(turn, 'resolve', stopped(turn));
      proc?.kill();
      proc = null;
    },
  };
}

// `grok models` prints "  * grok-4.7 (default)" and "  - grok-4.6" lines under "Available models:".
export const parseGrokModels = text => [...text.matchAll(/^\s+[*-]\s+(\S+)/gm)].map(m => m[1]);

// grok keeps xAI's own model table in models_cache.json, with a context_window per model.
export function parseModelsCache(json) {
  const out = new Map();
  for (const [id, m] of Object.entries(json?.models ?? {})) if (Number.isFinite(m?.info?.context_window)) out.set(id, m.info.context_window);
  return out;
}

// Models the user added themselves live in config.toml as [model.<id>] with a context_window.
export function parseConfigToml(text) {
  const out = new Map();
  let id = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) { id = /^model\.(.+)$/.exec(section[1])?.[1].replace(/^"|"$/g, '') ?? null; continue; }
    const window = id && /^context_window\s*=\s*(\d+)/.exec(line);
    if (window) out.set(id, Number(window[1]));
  }
  return out;
}

export const grokHome = () => process.env.GROK_HOME || join(homedir(), '.grok');

// The models the logged-in grok offers, each with its context window where grok's own files say
// what it is (null where they do not). Only model ids and window sizes are read, never auth.json.
export async function grokModels({ bin = process.env.DYSLEXIC_GROK_BIN || 'grok', dir = grokHome() } = {}) {
  const { stdout } = await run(bin, ['models'], { timeout: 30000 });
  const windows = new Map();
  const read = (name, parse) => {
    const p = join(dir, name);
    if (existsSync(p)) for (const [k, v] of parse(readFileSync(p, 'utf8'))) windows.set(k, v);
  };
  read('config.toml', parseConfigToml);
  read('models_cache.json', text => parseModelsCache(JSON.parse(text)));
  return parseGrokModels(stdout).map(id => ({ id, contextWindow: windows.get(id) ?? null }));
}
