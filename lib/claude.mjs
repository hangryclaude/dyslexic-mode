import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { dataDir } from './store.mjs';

// How to start the logged-in `claude` CLI: no API key, no direct paid API call.
// Plain mode: tools off and user settings skipped, so hooks and CLAUDE.md never touch the chat.
// Full mode: every Claude Code tool, run from home, with the user's own settings loaded so their
// guard hooks (dcg, guard.py) still screen each command, and their skills and MCP servers come along.
// Each mode always runs from the same folder, because a session can only be resumed from the
// folder it started in.
export function launch({ system, sessionId, model, tools = false, stream = false, bin = process.env.DYSLEXIC_CLAUDE_BIN || 'claude' }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (stream) args.push('--input-format', 'stream-json', '--include-partial-messages');
  if (tools) args.push('--permission-mode', 'bypassPermissions', '--append-system-prompt', system);
  else args.push('--tools', '', '--setting-sources', '', '--system-prompt', system);
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
  // CODEX_BRIDGE=1 is the bridge's own "already inside a run" marker. Without it, the user's
  // Stop hook would ask Codex what to do whenever a reply ends on a question, and push on.
  const env = { ...process.env, CODEX_BRIDGE: '1' };
  return { cmd: bin, args, options: { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: tools ? homedir() : dataDir() } };
}

// One turn in a fresh process, for side jobs like learning a rule or a reading test round.
export function ask(prompt, { system, sessionId, model, tools = false, onTool, bin }) {
  const { cmd, args, options } = launch({ system, sessionId, model, tools, bin });
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    let id = sessionId, result = null, stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    createInterface({ input: child.stdout }).on('line', line => {
      if (!line.trim()) return;
      // A throw in this callback would bypass the promise and kill the whole chat,
      // so anything unexpected fails this one turn, loudly, instead.
      try {
        const ev = JSON.parse(line);
        if (ev.session_id) id = ev.session_id;
        if (ev.type === 'assistant' && onTool) for (const b of ev.message.content) if (b.type === 'tool_use') onTool(b);
        if (ev.type === 'result') result = ev;
      } catch (err) {
        child.kill();
        reject(new Error(`unexpected output from claude: ${err.message}`));
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (!result) return reject(new Error(stderr.trim() || `claude exited ${code} with no result`));
      if (result.is_error || result.subtype !== 'success') return reject(new Error(String(result.result || result.subtype)));
      resolve({ text: result.result, sessionId: id });
    });
    // As in a chat session, a process that dies before reading fails through `close`, not as
    // an uncaught EPIPE.
    child.stdin.on('error', () => child.kill());
    // Prompt goes on stdin so a message starting with "-" is never read as a flag.
    child.stdin.end(prompt);
  });
}

const VERBS = {
  Bash: 'running', Read: 'reading', Edit: 'editing', MultiEdit: 'editing', Write: 'writing',
  Grep: 'searching files', Glob: 'finding files', WebSearch: 'searching the web', WebFetch: 'opening',
  Agent: 'asking an agent', Task: 'asking an agent', Skill: 'using a skill',
};

// A tool call as a short plain-words line for the status, e.g. "asking Codex: codex exec …".
export function toolLine({ name, input = {} }) {
  const arg = String(input.command ?? input.file_path ?? input.query ?? input.url ?? input.pattern ?? input.skill ?? input.description ?? '');
  const verb = name === 'Bash' && /\bcodex\b/.test(arg) ? 'asking Codex' : VERBS[name] ?? name;
  return arg ? `${verb}: ${arg.replace(/\s+/g, ' ')}` : verb;
}
