#!/usr/bin/env node
// Stands in for the `claude` CLI and records its argv, the bridge marker and its cwd so tests
// can check how it was launched. One-shot mode echoes stdin back as a stream-json result.
// Stream mode (--input-format stream-json) answers each user line the way the real CLI does:
// text deltas, assistant snapshots for tool calls, then a result. The prompt's first word
// picks a behaviour: TOOL, SLOW (waits for an interrupt), FAIL, DIE.
// Both modes report usage like the real CLI. Token counts follow the text, so a longer chat
// reads as a fuller context and a fresh process starts small. FAKE_WINDOW makes the result
// report a context window, and FAKE_PROMPTS logs every prompt it was given.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
if (process.env.FAKE_LOG) {
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, bridge: process.env.CODEX_BRIDGE ?? null, cwd: process.cwd(), pid: process.pid }) + '\n');
}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
const seen = prompt => { if (process.env.FAKE_PROMPTS) appendFileSync(process.env.FAKE_PROMPTS, JSON.stringify(prompt) + '\n'); };

// BASE is the system prompt and everything else a real session starts with.
const BASE = 3000, tokens = s => Math.ceil(s.length / 4);
const WINDOW = Number(process.env.FAKE_WINDOW) || undefined;
const total = us => Object.fromEntries(Object.keys(us[0]).map(k => [k, us.reduce((n, u) => n + u[k], 0)]));
const modelUsage = u => WINDOW && { 'fake-model': { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadInputTokens: u.cache_read_input_tokens, cacheCreationInputTokens: u.cache_creation_input_tokens, contextWindow: WINDOW } };

// What the one-shot modes say back for the prompts the app sends on purpose.
function canned(prompt) {
  if (prompt.startsWith('Goal: ')) {
    const goal = prompt.split('\n')[0].slice('Goal: '.length);
    if (goal.startsWith('BROKEN')) return 'no plan here, sorry';
    return '```json\n' + JSON.stringify({ goal, first: 'Open a blank page', steps: [{ title: 'Skim the topic', minutes: 10 }, { title: 'Write the main ideas', minutes: 40 }, { title: 'Test yourself', minutes: 15 }] }, null, 2) + '\n```';
  }
  const lens = /^Solve this by (picturing|looking|telling)/.exec(prompt);
  if (lens) return `draft: ${lens[1]}`;
  if (prompt.startsWith('Three thinkers')) return `combined ${(prompt.match(/<draft \d/g) || []).length} drafts`;
  return `echo: ${prompt}`;
}

if (argv.includes('--input-format')) {
  const session = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : 'sess-1';
  const ev = (event, parent = null) => emit({ type: 'stream_event', session_id: session, parent_tool_use_id: parent, event });
  const text = s => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: s } });
  const block = () => ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  const done = (result, calls) => {
    const usage = total(calls);
    emit({ type: 'result', subtype: 'success', is_error: false, result, session_id: session, usage, modelUsage: modelUsage(usage) });
  };
  let waiting = false, history = 0, asked = 0;
  // One API call: it reports the input it read when it starts, and the whole count when it ends.
  // What the process has already heard is read back from the cache, like the real thing.
  const begin = (prompt, reply) => {
    const p = tokens(prompt), r = tokens(reply);
    const usage = { input_tokens: 3, cache_read_input_tokens: history ? BASE + history : 0, cache_creation_input_tokens: (history ? 0 : BASE) + p, output_tokens: r };
    history += p + r;
    ev({ type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } });
    return () => {
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      return usage;
    };
  };
  createInterface({ input: process.stdin }).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.type === 'control_request') {
      emit({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id } });
      if (waiting) { waiting = false; emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: session }); }
      return;
    }
    const prompt = msg.message.content;
    seen(prompt);
    emit({ type: 'system', subtype: 'init', session_id: session });
    if (prompt.startsWith('DIE')) process.exit(3);
    if (prompt.startsWith('FAIL')) return emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: session });
    const earlier = asked++;
    if (prompt.startsWith('SLOW')) { begin(prompt, 'partial '); block(); text('partial '); waiting = true; return; }
    if (prompt.startsWith('TOOL')) {
      const first = begin(prompt, 'let me look');
      block();
      text('let me look');
      emit({ type: 'assistant', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls ~/dev' } }] } });
      // A subagent's own text, which must never reach the reply.
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SUBAGENT' } }, 'tool-1');
      const one = first();
      const second = begin('tool result', 'found 3 folders');
      block();
      text('found 3 ');
      text('folders');
      return done('found 3 folders', [one, second()]);
    }
    const reply = prompt.startsWith('Summarize this chat') ? `SUMMARY: ${earlier} earlier messages`
      : prompt.includes('Reply with only the word: ready') ? 'ready' : `echo: ${prompt}`;
    const end = begin(prompt, reply);
    block();
    for (let i = 0; i < reply.length; i += 4) text(reply.slice(i, i + 4));
    done(reply, [end()]);
  });
} else {
  const prompt = readFileSync(0, 'utf8');
  seen(prompt);
  emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  if (prompt.startsWith('GARBAGE')) process.stdout.write('this is not json\n');
  if (prompt.startsWith('TOOL')) {
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls ~/dev' } }] } });
  }
  // Never answers, so a test can end the process itself.
  if (prompt.startsWith('SLOW')) setInterval(() => {}, 1000);
  else if (prompt.startsWith('FAIL')) emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' });
  else {
    const reply = canned(prompt);
    const usage = { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: BASE + tokens(prompt), output_tokens: tokens(reply) };
    emit({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: 'sess-1', usage, modelUsage: modelUsage(usage) });
  }
}
