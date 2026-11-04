#!/usr/bin/env node
// Stands in for a model endpoint (OpenAI chat-completions, streaming) so the real `opencode`
// binary can be tested without a quota. Prints "listening <port>", and appends every request
// body to FAKE_OPENAI_LOG so a test can see exactly what the CLI sent: the system prompt, the
// history, and whether any tool was offered.
// The last user message's first word picks a behaviour: SLOW (streams until the client leaves),
// TOOL (calls a tool if one was offered). Anything else is answered as "echo: <message>", plus
// "[remembers: <first user message>]" once there is a history, so memory is visible in the reply.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 0);
const text = c => (typeof c === 'string' ? c : (c ?? []).map(p => p.text ?? '').join(''));
// A rough, stable token count, so a test can assert exact usage numbers.
const tokens = s => Math.ceil(s.length / 4);

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', d => { raw += d; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'echo', object: 'model' }] }));
    }
    const body = JSON.parse(raw || '{}');
    if (process.env.FAKE_OPENAI_LOG) appendFileSync(process.env.FAKE_OPENAI_LOG, JSON.stringify({ url: req.url, body }) + '\n');
    const users = (body.messages ?? []).filter(m => m.role === 'user').map(m => text(m.content));
    const last = users.at(-1) ?? '';
    const promptTokens = tokens(JSON.stringify(body.messages ?? []));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const chunk = (delta, finish = null) => send({ id: 'cmpl-1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
    const end = (completion, finish) => {
      chunk({}, finish);
      const usage = { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion };
      // CACHE reports 100 prompt tokens as cache hits and 3 completion tokens as reasoning, the way
      // OpenAI-style endpoints do, so a test can see whether the CLI counts them inside or outside input/output.
      if (last.startsWith('CACHE')) {
        usage.prompt_tokens_details = { cached_tokens: 100 };
        usage.completion_tokens_details = { reasoning_tokens: 3 };
      }
      send({ id: 'cmpl-1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage });
      res.end('data: [DONE]\n\n');
    };
    chunk({ role: 'assistant', content: '' });
    if (last.startsWith('SLOW')) {
      chunk({ content: 'partial ' });
      const timer = setInterval(() => chunk({ content: '.' }), 100);
      res.on('close', () => clearInterval(timer));
      return;
    }
    // FORCETOOL calls a tool nobody offered, the way a model can when it has seen tools before.
    const tool = body.tools?.[0]?.function?.name ?? (last.startsWith('FORCETOOL') ? 'bash' : null);
    if ((last.startsWith('TOOL') || last.startsWith('FORCETOOL')) && tool) {
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: tool, arguments: '{"command":"ls"}' } }] });
      return end(5, 'tool_calls');
    }
    const reply = `echo: ${last}${users.length > 1 ? ` [remembers: ${users[0]}]` : ''}`;
    // THINK streams reasoning first, which must never show up as part of the reply.
    if (last.startsWith('THINK')) { chunk({ reasoning_content: 'let me ' }); chunk({ reasoning_content: 'think' }); }
    let i = 0;
    const timer = setInterval(() => {
      if (i >= reply.length) { clearInterval(timer); return end(tokens(reply), 'stop'); }
      chunk({ content: reply.slice(i, i + 4) });
      i += 4;
    }, 30);
    res.on('close', () => clearInterval(timer));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
