#!/usr/bin/env node
// Stands in for the `grok` CLI. `models` prints the model list. Anything else is one headless reply
// in grok's streaming-messages-json format: init, stream events (thinking, then text), assistant, result.
// It records its argv, its GROK_* environment and its cwd in FAKE_LOG, and keeps each session's
// prompts in FAKE_STATE so a resumed session remembers. The prompt's first word picks a behaviour:
// DIE, FAIL, SLOW (waits to be killed), TOOLS (lists a tool, which the provider must refuse), THINK.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (process.env.FAKE_LOG) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GROK_')));
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, env, cwd: process.cwd(), pid: process.pid }) + '\n');
}
if (argv[0] === 'models') {
  console.log('You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.6\n  - custom-model');
  process.exit(0);
}

const flag = name => argv[argv.indexOf(name) + 1];
const joined = name => argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const prompt = joined('--single');
const resume = argv.includes('--resume') ? flag('--resume') : null;
const session = resume ?? flag('--session-id');
const file = join(process.env.FAKE_STATE, `${session}.json`);
if (resume && !existsSync(file)) {
  console.error(`error: session ${resume} not found`);
  process.exit(1);
}
const history = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
const ev = event => emit({ type: 'stream_event', session_id: session, parent_tool_use_id: null, event });
const delta = d => ev({ type: 'content_block_delta', index: 0, delta: d });
const block = type => ev({ type: 'content_block_start', index: 0, content_block: { type, text: '' } });

// The session exists on disk as soon as grok announces it.
writeFileSync(file, JSON.stringify(history));
emit({ type: 'system', subtype: 'init', session_id: session, model: 'grok-4.7', permissionMode: 'bypassPermissions', tools: prompt.startsWith('TOOLS') ? ['run_terminal_command'] : [], mcp_servers: [] });
if (prompt.startsWith('DIE')) process.exit(3);
if (prompt.startsWith('FAIL')) {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: session });
  process.exit(0);
}
ev({ type: 'message_start' });
if (prompt.startsWith('THINK')) {
  block('thinking');
  delta({ type: 'thinking_delta', thinking: 'secret reasoning' });
  ev({ type: 'content_block_stop', index: 0 });
}
block('text');
if (prompt.startsWith('SLOW')) {
  delta({ type: 'text_delta', text: 'partial ' });
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
} else {
  history.push(prompt);
  writeFileSync(file, JSON.stringify(history));
  const reply = `echo: ${prompt}${history.length > 1 ? ` [remembers: ${history[0]}]` : ''}`;
  let i = 0;
  const timer = setInterval(() => {
    if (i < reply.length) { delta({ type: 'text_delta', text: reply.slice(i, i + 4) }); i += 4; return; }
    clearInterval(timer);
    ev({ type: 'content_block_stop', index: 0 });
    ev({ type: 'message_stop' });
    emit({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: reply }] } });
    // Like grok, input_tokens leaves out the cache reads. Turn n reads 100 * n fresh tokens and 50 cached ones.
    const usage = { input_tokens: 100 * history.length, output_tokens: reply.length, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
    emit({ type: 'result', subtype: 'success', is_error: false, result: reply, stop_reason: 'end_turn', usage, modelUsage: { 'grok-4.7-build': { inputTokens: usage.input_tokens } }, session_id: session });
    // The process lingers a moment after its result, as the real one does: the next turn must not be failed by it.
    setTimeout(() => process.exit(0), 40);
  }, 10);
}
