#!/usr/bin/env node
// Stands in for the `claude` CLI: echoes stdin back as a stream-json result, and records its
// argv, the bridge marker and its cwd so tests can check how it was launched.
import { readFileSync, appendFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
if (process.env.FAKE_LOG) {
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), bridge: process.env.CODEX_BRIDGE ?? null, cwd: process.cwd() }) + '\n');
}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
if (prompt.startsWith('GARBAGE')) process.stdout.write('this is not json\n');
if (prompt.startsWith('TOOL')) {
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls ~/dev' } }] } });
}
if (prompt.startsWith('FAIL')) emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' });
else emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, session_id: 'sess-1' });
