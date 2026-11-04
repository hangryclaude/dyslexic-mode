import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// One way to ask any model a question and get text back. Every backend is run the same way: the
// plain system prompt below, no tools, no files, no user settings, so a score measures the model and
// the thinking style, not whatever the CLI wraps around it.
export const SYSTEM = 'You are a helpful assistant.';
export const DEFAULT_TIMEOUT = 300_000;

const WORK = fileURLToPath(new URL('./.work/', import.meta.url));
const bin = name => process.env[`DYSLEXIC_${name.toUpperCase()}_BIN`] || name;

// Every call starts in the same empty folder. A CLI that looks for AGENTS.md or CLAUDE.md on the way up
// to the repo root finds none, and each backend's own switches below stop it reading the user-level ones
// (checked with a planted CLAUDE.md and AGENTS.md: none of the three reached the model).
function emptyDir() {
  const dir = `${WORK}empty`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const strip = s => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
const json = s => { try { return JSON.parse(s); } catch { return null; } };

// A quota or login error will not clear in a second, so retrying only wastes the wait.
const FATAL = /usage limit|limit reached|quota|insufficient|credit|not logged in|please log in|\/login|invalid api key|unauthori[sz]ed|ENOENT/i;
function fail(message, fatal = FATAL.test(message)) {
  return Object.assign(new Error(message), { fatal });
}

// ---- processes ----------------------------------------------------------------------------------

const live = new Set();
let hooked = false;

function killGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (err) { if (err.code !== 'ESRCH') throw err; }
}

// Each child leads its own process group so a timeout can kill whatever it started too, which means
// Ctrl-C no longer reaches it. So the run kills its own children when it ends.
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on('exit', () => live.forEach(killGroup));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { live.forEach(killGroup); process.exit(130); });
}

// `input` undefined means stdin is closed, not left open: `opencode run` waits forever on an open one.
function exec({ cmd, args, env = {}, input, timeoutMs }) {
  hookExit();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: emptyDir(),
      env: { ...process.env, ...env },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: true,
    });
    live.add(child);
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => {
      clearTimeout(timer);
      live.delete(child);
      reject(fail(`${cmd}: ${err.message}`, err.code === 'ENOENT'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      live.delete(child);
      resolve({ stdout, stderr, code, timedOut });
    });
    if (input !== undefined) {
      // A child that dies before reading breaks the pipe. That shows up as its exit code, not here.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

// ---- claude -------------------------------------------------------------------------------------

// Tools, user settings and hooks are off, and the system prompt is replaced, so the user's CLAUDE.md
// and skills never reach the model. CODEX_BRIDGE=1 stops the user's Stop hook from running.
// --no-session-persistence keeps thousands of bench runs out of the user's session history.
const claudeArgs = (name, extra) => [
  '-p', '--model', name, '--tools', '', '--setting-sources', '',
  '--system-prompt', SYSTEM, '--no-session-persistence', ...extra,
];
const CLAUDE_ENV = { CODEX_BRIDGE: '1' };

function claudeResult(ev, code, stderr) {
  if (!ev) throw fail(`claude exited ${code} with no result: ${strip(stderr).trim().slice(0, 300)}`);
  if (ev.is_error || ev.subtype !== 'success') throw fail(`claude: ${String(ev.result || ev.subtype).slice(0, 300)}`);
  if (!ev.result) throw fail('claude returned an empty reply', false);
  return { text: ev.result, outTokens: ev.usage?.output_tokens ?? null, modelId: Object.keys(ev.modelUsage ?? {})[0] ?? null };
}

export function parseClaude({ stdout, stderr, code, timedOut }, timeoutMs) {
  if (timedOut) throw fail(`claude timed out after ${timeoutMs} ms`, false);
  return claudeResult(json(stdout), code, stderr);
}

// stream-json prints one event per line. The last "result" event holds the reply.
export function parseClaudeStream({ stdout, stderr, code, timedOut }, timeoutMs) {
  if (timedOut) throw fail(`claude timed out after ${timeoutMs} ms`, false);
  const events = stdout.split('\n').map(json).filter(Boolean);
  return claudeResult(events.findLast(e => e.type === 'result'), code, stderr);
}

async function claudeText({ name, prompt, timeoutMs }) {
  const t0 = Date.now();
  const r = await exec({ cmd: bin('claude'), args: claudeArgs(name, ['--output-format', 'json']), env: CLAUDE_ENV, input: prompt, timeoutMs });
  return { ...parseClaude(r, timeoutMs), ms: Date.now() - t0 };
}

// ---- opencode -----------------------------------------------------------------------------------

// opencode is a coding agent. Left alone it offers the model a dozen tools (shell, edit, write, web
// search...) and about 170k characters of instructions. A private agent with one deny-everything
// rule drops the tool list to nothing and the system prompt to the plain one. Checked against a
// local endpoint that records the request: tools [], system "You are a helpful assistant." plus a
// short block with the date and folder.
const OPENCODE_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  agents: {
    bench: { mode: 'primary', system: SYSTEM, permissions: [{ action: '*', resource: '*', effect: 'deny' }] },
  },
};

let opencodeConfig = null;
function opencodeConfigPath() {
  if (!opencodeConfig) {
    mkdirSync(WORK, { recursive: true });
    opencodeConfig = `${WORK}opencode.json`;
    writeFileSync(opencodeConfig, JSON.stringify(OPENCODE_CONFIG, null, 2) + '\n');
  }
  return opencodeConfig;
}

// --standalone gives each call its own server, so these variables reach it; the shared background
// service would ignore them. OPENCODE_DISABLE_PROJECT_CONFIG stops it reading AGENTS.md files.
const OPENCODE_ENV = () => ({
  OPENCODE_CONFIG: opencodeConfigPath(),
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
});

export function parseOpencode({ stdout, stderr, code, timedOut }, timeoutMs) {
  if (timedOut) throw fail(`opencode timed out after ${timeoutMs} ms`, false);
  const events = stdout.split('\n').map(json).filter(e => e && e.type);
  const err = events.findLast(e => e.type === 'error')?.error;
  if (err) {
    const hours = err.retryAfterMs ? `, retry in ${Math.round(err.retryAfterMs / 36e5)} h` : '';
    const quota = /^provider\.(quota|free-limit)/.test(err.type ?? '') || err.status === 402;
    throw fail(`opencode: ${err.message ?? 'error'}${hours}`, quota || FATAL.test(err.message ?? ''));
  }
  // The run is only comparable if the model could not reach a tool.
  if (events.some(e => e.type === 'tool_use')) throw fail('opencode used a tool, so this run is not comparable', true);
  const text = events.filter(e => e.type === 'text').map(e => e.part?.text ?? '').join('\n\n').trim();
  if (!text) {
    // Only an old build that prints plain text lands here, and only a clean exit counts as a reply.
    if (!events.length && code === 0 && strip(stdout).trim()) return { text: strip(stdout).trim(), outTokens: null };
    throw fail(`opencode returned no text (exit ${code}): ${strip(stderr).trim().slice(0, 300)}`, false);
  }
  // The last step of a plain answer prints no step_finish in this build, so there is often no count
  // at all. null says so; 0 would claim the model wrote nothing.
  const finished = events.filter(e => e.type === 'step_finish');
  const outTokens = finished.length
    ? finished.reduce((s, e) => s + (e.part?.tokens?.output ?? 0) + (e.part?.tokens?.reasoning ?? 0), 0)
    : null;
  return { text, outTokens };
}

async function opencodeText({ name, prompt, timeoutMs }) {
  const t0 = Date.now();
  const args = ['run', '--standalone', '--agent', 'bench', '-m', name, '--format', 'json', prompt];
  const r = await exec({ cmd: bin('opencode'), args, env: OPENCODE_ENV(), timeoutMs });
  return { ...parseOpencode(r, timeoutMs), ms: Date.now() - t0 };
}

// ---- grok ---------------------------------------------------------------------------------------

// `--tools ""` and `--tools none` do nothing in grok ("names no tool, so other tools stay
// available"). Naming every tool in --disallowed-tools is what empties the list; checked against a
// local endpoint that recorded the request. dontAsk and one turn are the net under it: a tool added
// in a later version cannot run, and cannot start a loop either.
const GROK_TOOLS = [
  'run_terminal_command', 'read_file', 'search_replace', 'list_dir', 'grep', 'write', 'todo_write',
  'kill_command_or_subagent', 'get_command_or_subagent_output', 'spawn_subagent', 'monitor',
  'scheduler_create', 'scheduler_delete', 'scheduler_list', 'search_tool', 'use_tool', 'workflow',
  'enter_plan_mode', 'exit_plan_mode', 'ask_user_question', 'send_feedback',
  'image_gen', 'image_edit', 'image_to_video', 'reference_to_video', 'web_search', 'web_fetch',
].join(',');

// Grok reads ~/.claude/CLAUDE.md, rules and skills by default, and makes extra calls for a title, a
// turn summary and a next-prompt suggestion. All of that is switched off.
const GROK_ENV = {
  GROK_CLAUDE_AGENTS_ENABLED: '0', GROK_CLAUDE_RULES_ENABLED: '0', GROK_CLAUDE_SKILLS_ENABLED: '0',
  GROK_CLAUDE_HOOKS_ENABLED: '0', GROK_CLAUDE_MCPS_ENABLED: '0',
  GROK_TURN_SUMMARY: '0', GROK_TITLE_REFRESH: '0', GROK_PROMPT_SUGGESTIONS: '0', GROK_MEMORY: '0',
  GROK_DISABLE_AUTOUPDATER: '1',
};

export function parseGrok({ stdout, stderr, code, timedOut }, timeoutMs) {
  if (timedOut) throw fail(`grok timed out after ${timeoutMs} ms`, false);
  const ev = json(stdout);
  if (!ev || typeof ev !== 'object') {
    if (code === 0 && stdout.trim()) return { text: stdout.trim(), outTokens: null };
    throw fail(`grok exited ${code}: ${strip(stderr || stdout).trim().slice(0, 300)}`);
  }
  if (ev.error) throw fail(`grok: ${String(ev.error.message ?? ev.error).slice(0, 300)}`);
  if (ev.num_turns > 1) throw fail('grok took more than one turn, so it used a tool', true);
  if (!ev.text) throw fail(`grok returned no text (exit ${code})`, false);
  const u = ev.usage ?? {};
  return { text: ev.text, outTokens: (u.output_tokens ?? 0) + (u.reasoning_tokens ?? 0), modelId: Object.keys(ev.modelUsage ?? {})[0] ?? null };
}

async function grokText({ name, prompt, timeoutMs }) {
  const t0 = Date.now();
  const args = [
    '-p', prompt, '--output-format', 'json', '--disallowed-tools', GROK_TOOLS, '--permission-mode', 'dontAsk',
    '--max-turns', '1', '--no-subagents', '--disable-web-search', '--no-plan', '--system-prompt-override', SYSTEM,
  ];
  if (name) args.push('-m', name);
  const r = await exec({ cmd: bin('grok'), args, env: GROK_ENV, timeoutMs });
  return { ...parseGrok(r, timeoutMs), ms: Date.now() - t0 };
}

// ---- entry points -------------------------------------------------------------------------------

const TEXT = { claude: claudeText, opencode: opencodeText, grok: grokText };

// "claude:haiku" -> claude, "opencode:opencode-go/gpt-6-luna" -> opencode, "grok" or "grok:name" -> grok.
function parseModel(model) {
  const text = String(model), at = text.indexOf(':');
  const backend = at < 0 ? text : text.slice(0, at), name = at < 0 ? '' : text.slice(at + 1);
  if (!(backend in TEXT) || (!name && backend !== 'grok')) {
    throw new Error(`unknown model "${model}": use claude:<model>, opencode:<provider/model> or grok`);
  }
  return { backend, name };
}

export const backendOf = model => parseModel(model).backend;

// One retry for a failed call, unless the failure is one a retry cannot fix.
async function withRetry(call) {
  try {
    return await call();
  } catch (err) {
    if (err.fatal) throw err;
    await new Promise(r => setTimeout(r, Number(process.env.BENCH_RETRY_MS ?? 1500)));
    return call();
  }
}

export function runText({ model, prompt, timeoutMs = DEFAULT_TIMEOUT }) {
  const { backend, name } = parseModel(model);
  return withRetry(() => TEXT[backend]({ name, prompt, timeoutMs }));
}

// A question about a picture. Claude only: the stream-json input is how the CLI takes an image block.
export function runImage({ model, pngPath, prompt, timeoutMs = DEFAULT_TIMEOUT }) {
  const { backend, name } = parseModel(model);
  if (backend !== 'claude') throw new Error(`images are only wired for claude models, not ${model}`);
  const data = readFileSync(pngPath).toString('base64');
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        { type: 'text', text: prompt },
      ],
    },
  };
  return withRetry(async () => {
    const t0 = Date.now();
    const args = claudeArgs(name, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
    const r = await exec({ cmd: bin('claude'), args, env: CLAUDE_ENV, input: JSON.stringify(message) + '\n', timeoutMs });
    return { ...parseClaudeStream(r, timeoutMs), ms: Date.now() - t0 };
  });
}
