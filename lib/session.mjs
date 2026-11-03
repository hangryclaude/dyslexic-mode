import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { launch } from './claude.mjs';

// One claude process for the whole chat. Turns go in over stdin as stream-json, so a message
// pays no start-up cost, the MCP servers stay up between turns, and text streams out as it is
// written. If the process dies, the next turn starts a new one on the same session.
export function openSession({ system, model, tools = false, resume, bin }) {
  let proc = null, id = resume, turn = null, closed = false;

  const settle = (how, value) => {
    const t = turn;
    turn = null;
    t?.[how](value);
  };

  function start() {
    const { cmd, args, options } = launch({ system, model, tools, sessionId: id, stream: true, bin });
    const child = spawn(cmd, args, options);
    let stderr = '';
    proc = child;
    child.stderr.on('data', d => { stderr += d; });
    // A process that has stopped reading fails the next write with EPIPE, and an unheard
    // stream error would end the whole chat. Ending the process fails the turn through the
    // close handler instead, with whatever claude said on stderr.
    child.stdin.on('error', () => child.kill());
    createInterface({ input: child.stdout }).on('line', line => {
      if (!line.trim()) return;
      // A throw in here would bypass the promise and kill the chat, so odd output fails the
      // turn instead, loudly.
      let ev;
      try { ev = JSON.parse(line); } catch (err) {
        child.kill();
        return settle('reject', new Error(`unexpected output from claude: ${err.message}`));
      }
      onEvent(ev);
    });
    child.on('error', err => settle('reject', err));
    child.on('close', code => {
      if (proc === child) proc = null;
      if (turn) settle('reject', new Error(stderr.trim() || `claude exited ${code} with no result`));
    });
  }

  function onEvent(ev) {
    if (ev.session_id) id = ev.session_id;
    // Subagents stream too. Their text is their own working, not the reply.
    if (!turn || ev.parent_tool_use_id) return;
    if (ev.type === 'stream_event') {
      const e = ev.event;
      if (e.type === 'content_block_start' && e.content_block?.type === 'text' && turn.text) emit('\n\n');
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') emit(e.delta.text);
    } else if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) if (b.type === 'tool_use') turn.onTool?.(b);
    } else if (ev.type === 'result') {
      if (turn.stopped) settle('resolve', { text: turn.text, sessionId: id, stopped: true });
      else if (ev.is_error || ev.subtype !== 'success') settle('reject', new Error(String(ev.result || ev.subtype)));
      else settle('resolve', { text: ev.result, sessionId: id });
    }
  }

  function emit(s) {
    turn.text += s;
    turn.onText?.(s);
  }

  const write = obj => proc.stdin.write(JSON.stringify(obj) + '\n');

  return {
    get id() { return id; },
    get busy() { return !!turn; },
    // Starts the process early, so its start-up overlaps something else, like the intro.
    warm() { if (!proc && !closed) start(); },
    send(prompt, { onText, onTool } = {}) {
      if (closed) return Promise.reject(new Error('this chat is closed'));
      if (turn) return Promise.reject(new Error('a reply is still running'));
      if (!proc) start();
      return new Promise((resolve, reject) => {
        turn = { resolve, reject, onText, onTool, text: '', stopped: false };
        write({ type: 'user', message: { role: 'user', content: prompt } });
      });
    },
    // Ends the running turn early. Claude still sends a result, which settles it as stopped.
    interrupt() {
      if (!turn || !proc || turn.stopped) return false;
      turn.stopped = true;
      write({ type: 'control_request', request_id: `stop-${Date.now()}`, request: { subtype: 'interrupt' } });
      return true;
    },
    // An idle process exits on its own when stdin ends. A busy one is stopped outright.
    close() {
      closed = true;
      const busy = !!turn;
      if (busy) settle('resolve', { text: turn.text, sessionId: id, stopped: true });
      proc?.stdin.end();
      if (busy) proc?.kill();
      proc = null;
    },
  };
}
