#!/usr/bin/env node
// Stands in for the `claude` CLI and records its argv, the bridge marker and its cwd so tests
// can check how it was launched. One-shot mode echoes stdin back as a stream-json result.
// Stream mode (--input-format stream-json) answers each user line the way the real CLI does:
// text deltas, assistant snapshots for tool calls, then a result. The prompt's first word
// picks a behaviour: TOOL, SLOW (waits for an interrupt), FAIL, DIE.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
if (process.env.FAKE_LOG) {
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, bridge: process.env.CODEX_BRIDGE ?? null, cwd: process.cwd(), pid: process.pid }) + '\n');
}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');

if (argv.includes('--input-format')) {
  const session = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : 'sess-1';
  const ev = (event, parent = null) => emit({ type: 'stream_event', session_id: session, parent_tool_use_id: parent, event });
  const text = s => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: s } });
  const block = () => ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  const done = result => emit({ type: 'result', subtype: 'success', is_error: false, result, session_id: session });
  let waiting = false;
  createInterface({ input: process.stdin }).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.type === 'control_request') {
      emit({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id } });
      if (waiting) { waiting = false; emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: session }); }
      return;
    }
    const prompt = msg.message.content;
    emit({ type: 'system', subtype: 'init', session_id: session });
    if (prompt.startsWith('DIE')) process.exit(3);
    if (prompt.startsWith('FAIL')) return emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: session });
    block();
    if (prompt.startsWith('SLOW')) { text('partial '); waiting = true; return; }
    if (prompt.startsWith('TOOL')) {
      text('let me look');
      emit({ type: 'assistant', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls ~/dev' } }] } });
      // A subagent's own text, which must never reach the reply.
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SUBAGENT' } }, 'tool-1');
      block();
      text('found 3 ');
      text('folders');
      return done('found 3 folders');
    }
    const reply = `echo: ${prompt}`;
    for (let i = 0; i < reply.length; i += 4) text(reply.slice(i, i + 4));
    done(reply);
  });
} else {
  const prompt = readFileSync(0, 'utf8');
  emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  if (prompt.startsWith('GARBAGE')) process.stdout.write('this is not json\n');
  if (prompt.startsWith('TOOL')) {
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls ~/dev' } }] } });
  }
  if (prompt.startsWith('FAIL')) emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' });
  else emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, session_id: 'sess-1' });
}
