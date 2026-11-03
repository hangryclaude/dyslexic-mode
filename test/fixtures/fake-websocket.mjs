// Preloaded into the app with NODE_OPTIONS=--import=<this file>. It replaces the built-in WebSocket
// with a scripted OpenAI Realtime server, so a test never reaches the network. It appends what it
// was asked to FAKE_LOG: the address and the Authorization header, and the type of each message
// the app sends. Once open, the "server" plays one short exchange: the user asks what a verb is,
// and the reply arrives as transcript pieces. FAKE_WS_FAIL=1 makes the connection fail instead.
import { appendFileSync } from 'node:fs';

const log = o => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\n');

// [wait in ms after the one before, what the server says]
const SCRIPT = [
  [20, { type: 'session.updated' }],
  [20, { type: 'input_audio_buffer.speech_started' }],
  [10, { type: 'input_audio_buffer.speech_stopped' }],
  [10, { type: 'input_audio_buffer.committed', item_id: 'u1' }],
  [10, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'what is a verb' }],
  [10, { type: 'response.created' }],
  [10, { type: 'response.output_audio_transcript.delta', delta: 'A verb is ' }],
  [10, { type: 'response.output_audio_transcript.delta', delta: 'an action word.' }],
  [10, { type: 'response.output_audio_transcript.done' }],
  [10, { type: 'response.done', response: { status: 'completed' } }],
];

class FakeSocket {
  constructor(url, options) {
    this.readyState = 0;
    this.handlers = {};
    log({ ws: url, authorization: options?.headers?.Authorization ?? null });
    if (process.env.FAKE_WS_FAIL) {
      setTimeout(() => this.fire('error', { message: 'unauthorized' }), 20);
      return;
    }
    setTimeout(() => {
      this.readyState = 1;
      this.fire('open');
      let at = 0;
      for (const [wait, event] of SCRIPT) {
        at += wait;
        setTimeout(() => this.readyState === 1 && this.fire('message', { data: JSON.stringify(event) }), at);
      }
    }, 20);
  }

  addEventListener(type, fn) {
    (this.handlers[type] ??= []).push(fn);
  }

  fire(type, event = {}) {
    for (const fn of this.handlers[type] ?? []) fn(event);
  }

  send(data) {
    log({ sent: JSON.parse(data).type });
  }

  close(code) {
    this.readyState = 3;
    setTimeout(() => this.fire('close', { code }), 5);
  }
}

Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, configurable: true, writable: true });
