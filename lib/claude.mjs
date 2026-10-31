import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// One chat turn through the logged-in `claude` CLI: no API key, no direct paid API call.
// Tools are off and user settings are skipped, so hooks and CLAUDE.md never leak into the chat.
export function ask(prompt, { system, sessionId, model, bin = process.env.DYSLEXIC_CLAUDE_BIN || 'claude' }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '',
    '--setting-sources', '', '--system-prompt', system];
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let id = sessionId, result = null, stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    createInterface({ input: child.stdout }).on('line', line => {
      if (!line.trim()) return;
      const ev = JSON.parse(line);
      if (ev.session_id) id = ev.session_id;
      if (ev.type === 'result') result = ev;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (!result) return reject(new Error(stderr.trim() || `claude exited ${code} with no result`));
      if (result.is_error || result.subtype !== 'success') return reject(new Error(String(result.result || result.subtype)));
      resolve({ text: result.result, sessionId: id });
    });
    // Prompt goes on stdin so a message starting with "-" is never read as a flag.
    child.stdin.end(prompt);
  });
}
