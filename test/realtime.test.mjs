import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import DEFAULT_INSTRUCTIONS, { startVoice, VOICE_INSTRUCTIONS } from '../lib/realtime.mjs';

// Not a credential. The tests only check where it goes and that it never leaks.
const KEY = 'FAKE-KEY-FOR-TESTS';
const b64 = bytes => Buffer.from(bytes).toString('base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
const AUDIO = { type: 'response.output_audio.delta', item_id: 'item_1', content_index: 0 };
const DONE = { type: 'response.done', response: { status: 'completed' } };

class FakeSocket {
  constructor(url, options) {
    Object.assign(this, { url, options, readyState: 0, sent: [], closeCode: null, handlers: {} });
  }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  send(data) {
    assert.equal(this.readyState, 1, 'sent on a socket that is not open');
    this.sent.push(JSON.parse(data));
  }
  close(code) { this.closeCode = code; this.readyState = 2; }
  // The server's side, for the tests to drive.
  fire(type, event = {}) { for (const fn of this.handlers[type] ?? []) fn(event); }
  open() { this.readyState = 1; this.fire('open'); }
  say(event) { this.fire('message', { data: JSON.stringify(event) }); }
  sentOf(type) { return this.sent.filter(m => m.type === type); }
}

class FakeProc extends EventEmitter {
  constructor(cmd, args, options) {
    super();
    Object.assign(this, { cmd, args, options, signals: [], writes: [], ended: false });
    this.stdout = new EventEmitter();
    this.stdin = Object.assign(new EventEmitter(), {
      write: chunk => { this.writes.push(Buffer.from(chunk)); return true; },
      end: () => { this.ended = true; },
    });
  }
  // A real process reports its end a moment after it is killed.
  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }
  exit(code) { this.emit('close', code, null); }
  get audio() { return [...Buffer.concat(this.writes)]; }
}

function rig(options = {}) {
  const r = { sockets: [], procs: [], timers: [], clock: { t: 1000 }, log: [], states: [] };
  const deps = {
    WebSocket: class extends FakeSocket { constructor(...args) { super(...args); r.sockets.push(this); } },
    spawn: (cmd, args, opts) => { const p = new FakeProc(cmd, args, opts); r.procs.push(p); return p; },
    now: () => r.clock.t,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; r.timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
  };
  r.voice = startVoice({
    key: KEY, instructions: 'SAY LITTLE',
    onUser: text => r.log.push(['user', text]),
    onAssistant: (text, done) => r.log.push(['assistant', text, done]),
    onState: (name, detail) => r.states.push([name, detail]),
    deps, ...options,
  });
  r.ws = r.sockets[0];
  Object.defineProperties(r, {
    mic: { get: () => r.procs.find(p => p.cmd === 'ffmpeg') },
    players: { get: () => r.procs.filter(p => p.cmd === 'ffplay') },
    names: { get: () => r.states.map(s => s[0]) },
  });
  return r;
}

// A chat whose socket is open and whose session the server has accepted.
function ready(options) {
  const r = rig(options);
  r.ws.open();
  r.ws.say({ type: 'session.updated' });
  return r;
}

test('it connects to the realtime endpoint for the model with the key as a bearer header, never in the URL', () => {
  const r = rig();
  assert.equal(r.ws.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime');
  assert.deepEqual(r.ws.options, { headers: { Authorization: `Bearer ${KEY}` } });
  assert.ok(!r.ws.url.includes(KEY));
  assert.equal(r.procs.length, 0, 'no mic or speaker before the socket is open');
  assert.equal(rig({ model: 'gpt-realtime-mini' }).ws.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime-mini');
});

test('opening sends one session.update: a realtime session with 24 kHz PCM both ways, server VAD, transcription, voice and instructions', () => {
  const r = rig();
  r.ws.open();
  assert.equal(r.ws.sent.length, 1);
  assert.deepEqual(r.ws.sent[0], {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: 'SAY LITTLE',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'server_vad', silence_duration_ms: 700, create_response: true, interrupt_response: true },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' },
      },
    },
  });
});

test('the voice, transcription model and mic input can be chosen, and the instructions default to the ones for a dyslexic listener', () => {
  const r = rig({ voice: 'cedar', transcriptionModel: 'whisper-1', micInput: ':2', instructions: undefined });
  r.ws.open();
  const { session } = r.ws.sent[0];
  assert.equal(session.audio.output.voice, 'cedar');
  assert.equal(session.audio.input.transcription.model, 'whisper-1');
  assert.equal(session.instructions, VOICE_INSTRUCTIONS);
  assert.equal(r.mic.args[r.mic.args.indexOf('-i') + 1], ':2');
});

test('the mic is ffmpeg capturing the input as 24 kHz mono PCM on stdout, started once the socket opens', () => {
  const r = rig();
  r.ws.open();
  assert.equal(r.procs.length, 1);
  assert.equal(r.mic.cmd, 'ffmpeg');
  assert.deepEqual(r.mic.args, ['-loglevel', 'quiet', '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '24000', '-f', 's16le', '-']);
  assert.deepEqual(r.mic.options, { stdio: ['ignore', 'pipe', 'ignore'] });
});

test('mic chunks go up as base64 input_audio_buffer.append', () => {
  const r = rig();
  r.ws.open();
  r.mic.stdout.emit('data', Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(r.ws.sentOf('input_audio_buffer.append'), [{ type: 'input_audio_buffer.append', audio: 'AQIDBA==' }]);
});

test('a mic chunk that ends mid-sample is realigned, so every append is whole 16-bit samples', () => {
  const r = rig();
  r.ws.open();
  r.mic.stdout.emit('data', Buffer.from([1, 2, 3]));
  r.mic.stdout.emit('data', Buffer.from([4, 5, 6, 7]));
  r.mic.stdout.emit('data', Buffer.from([8]));
  const sent = r.ws.sentOf('input_audio_buffer.append').map(m => Buffer.from(m.audio, 'base64'));
  assert.ok(sent.every(b => b.length % 2 === 0));
  assert.deepEqual([...Buffer.concat(sent)], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('reply audio under either event name is decoded and written to one ffplay', () => {
  const r = ready();
  r.ws.say({ type: 'response.created', response: { id: 'resp_1' } });
  r.ws.say({ ...AUDIO, delta: b64([1, 2, 3, 4]) });
  r.ws.say({ type: 'response.audio.delta', item_id: 'item_1', delta: b64([5, 6]) });
  assert.equal(r.players.length, 1);
  const [speaker] = r.players;
  assert.deepEqual(speaker.args, ['-loglevel', 'quiet', '-nodisp', '-autoexit', '-f', 's16le', '-sample_rate', '24000', '-ch_layout', 'mono', '-i', '-']);
  assert.deepEqual(speaker.options, { stdio: ['pipe', 'ignore', 'ignore'] });
  assert.deepEqual(speaker.audio, [1, 2, 3, 4, 5, 6]);
  assert.equal(speaker.ended, false);
  r.ws.say({ type: 'response.output_audio.done' });
  assert.equal(speaker.ended, true, 'stdin closes, so ffplay plays out its buffer and exits');
});

test('transcripts reach the callbacks: the user\'s words trimmed, the reply as deltas then done, under both naming schemes', () => {
  const r = ready();
  r.ws.say({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: '  what is a fraction \n' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'A part ' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'of a whole.' });
  r.ws.say({ type: 'response.output_audio_transcript.done', transcript: 'A part of a whole.' });
  r.ws.say({ type: 'response.audio_transcript.delta', delta: 'Want it again?' });
  r.ws.say({ type: 'response.audio_transcript.done' });
  assert.deepEqual(r.log, [
    ['user', 'what is a fraction'],
    ['assistant', 'A part ', false], ['assistant', 'of a whole.', false], ['assistant', '', true],
    ['assistant', 'Want it again?', false], ['assistant', '', true],
  ]);
});

test('a transcript with nothing in it is not reported', () => {
  const r = ready();
  r.ws.say({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: '  ' });
  assert.deepEqual(r.log, []);
});

test('the reply\'s text waits for the user\'s own words, so the two show in the order they were said', () => {
  const r = ready();
  r.ws.say({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Sure.' });
  r.ws.say({ type: 'response.output_audio_transcript.done' });
  assert.deepEqual(r.log, [], 'held back');
  r.ws.say({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'help me' });
  assert.deepEqual(r.log, [['user', 'help me'], ['assistant', 'Sure.', false], ['assistant', '', true]]);
  assert.ok(r.timers.every(t => t.cleared), 'nothing is left waiting');
});

test('a transcript that never comes holds the reply for three seconds and no longer', () => {
  const r = ready();
  r.ws.say({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Sure.' });
  assert.deepEqual(r.log, []);
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, 3000);
  r.timers[0].fn();
  assert.deepEqual(r.log, [['assistant', 'Sure.', false]]);
  // Text after that is not held again, and a late transcript is still shown.
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: ' More.' });
  r.ws.say({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'late words' });
  assert.deepEqual(r.log.slice(1), [['assistant', ' More.', false], ['user', 'late words']]);
});

test('a transcript that fails lets the reply through too', () => {
  const r = ready();
  r.ws.say({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Sure.' });
  r.ws.say({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'u1', error: { message: 'no speech' } });
  assert.deepEqual(r.log, [['assistant', 'Sure.', false]]);
  assert.ok(!r.names.includes('error'));
});

test('speech_started silences the speaker at once, drops the cancelled reply\'s late audio, and the next reply gets a fresh speaker', async () => {
  const r = ready();
  r.ws.say({ type: 'response.created', response: { id: 'resp_1' } });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  const [first] = r.players;
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(first.signals, ['SIGKILL']);
  r.ws.say({ ...AUDIO, delta: b64([3, 4]) });
  assert.equal(r.players.length, 1, 'audio that was already on its way does not start a speaker');
  assert.deepEqual(first.audio, [1, 2]);
  r.ws.say({ type: 'input_audio_buffer.speech_stopped' });
  r.ws.say({ type: 'response.created', response: { id: 'resp_2' } });
  r.ws.say({ ...AUDIO, item_id: 'item_2', delta: b64([9, 9]) });
  assert.equal(r.players.length, 2);
  assert.deepEqual(r.players[1].audio, [9, 9]);
  await tick();
  assert.ok(!r.names.includes('error'), 'the killed speaker\'s own close is not a problem');
  assert.deepEqual(r.players[1].signals, []);
});

test('speech_started also silences the tail of a reply the server has already finished sending', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.ws.say({ type: 'response.output_audio.done' });
  r.ws.say(DONE);
  const [speaker] = r.players;
  assert.equal(speaker.ended, true);
  assert.equal(r.names.at(-1), 'speaking', 'ffplay is still working through what it was given');
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(speaker.signals, ['SIGKILL']);
  assert.equal(r.names.at(-1), 'listening');
});

test('a reply that is cut in on is ended for the caller, since the server never sends its end', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Step one is to' });
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(r.log, [['assistant', 'Step one is to', false], ['assistant', '', true]]);
  r.ws.say({ type: 'response.done', response: { status: 'cancelled' } });
  assert.equal(r.log.length, 2, 'ended once');
});

test('cutting in trims the reply on the server to what was heard', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, item_id: 'item_7', content_index: 0, delta: b64(new Uint8Array(48000)) });
  r.clock.t += 400;
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(r.ws.sentOf('conversation.item.truncate'), [
    { type: 'conversation.item.truncate', event_id: 'truncate-1', item_id: 'item_7', content_index: 0, audio_end_ms: 400 },
  ]);
});

test('what was heard is never more than what was sent, and nothing is trimmed once the speaker has finished', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, item_id: 'item_7', delta: b64(new Uint8Array(4800)) });
  r.clock.t += 5000;
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.equal(r.ws.sentOf('conversation.item.truncate')[0].audio_end_ms, 100);

  const done = ready();
  done.ws.say({ type: 'response.created' });
  done.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  done.players[0].exit(0);
  done.ws.say({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(done.ws.sentOf('conversation.item.truncate'), []);
});

test('the server refusing a trim is not an error the user sees', () => {
  const r = ready();
  r.ws.say({ type: 'error', error: { type: 'invalid_request_error', message: 'Audio is already shorter', event_id: 'truncate-1' } });
  assert.ok(!r.names.includes('error'));
});

test('state follows the conversation, and goes back to listening only once the speech has played', () => {
  const r = ready();
  r.ws.say({ type: 'input_audio_buffer.speech_started' });
  r.ws.say({ type: 'input_audio_buffer.speech_stopped' });
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.ws.say({ ...AUDIO, delta: b64([3, 4]) });
  r.ws.say({ type: 'response.output_audio.done' });
  r.ws.say(DONE);
  assert.deepEqual(r.names, ['listening', 'thinking', 'speaking']);
  r.players[0].exit(0);
  assert.deepEqual(r.names, ['listening', 'thinking', 'speaking', 'listening']);
});

test('a reply with no audio goes straight back to listening when it is done', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say(DONE);
  assert.deepEqual(r.names, ['listening', 'thinking', 'listening']);
  assert.equal(r.players.length, 0);
});

test('a server error reaches onState with its message, and the chat carries on', () => {
  const r = ready();
  r.ws.say({ type: 'error', error: { type: 'invalid_request_error', code: 'invalid_value', message: 'Unknown parameter: session.nope' } });
  assert.deepEqual(r.states.slice(1), [['error', 'Unknown parameter: session.nope'], ['listening', undefined]]);
  assert.equal(r.ws.closeCode, null, 'still connected');
  assert.deepEqual(r.mic.signals, []);
});

test('a reply that fails is reported with the reason', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ type: 'response.done', response: { status: 'failed', status_details: { type: 'failed', error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } } } });
  assert.deepEqual(r.states.filter(s => s[0] === 'error'), [['error', 'You exceeded your current quota']]);
  assert.equal(r.names.at(-1), 'listening');
});

test('a message that is not JSON is reported instead of thrown', () => {
  const r = ready();
  r.ws.fire('message', { data: 'not json' });
  const [, detail] = r.states.find(s => s[0] === 'error');
  assert.match(detail, /^unexpected message from OpenAI: /);
});

test('events it has no use for are ignored', () => {
  const r = ready();
  const before = r.states.length;
  for (const type of ['rate_limits.updated', 'conversation.item.added', 'response.output_item.added', 'response.output_text.delta', 'nonsense']) r.ws.say({ type });
  r.ws.say({});
  assert.equal(r.states.length, before);
  assert.deepEqual(r.log, []);
});

test('the key never reaches a callback or the console, even when the server or the socket echoes it back', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const saved = Object.fromEntries(methods.map(m => [m, console[m]]));
  const printed = [];
  for (const m of methods) console[m] = (...args) => printed.push(args.join(' '));
  let r;
  try {
    r = ready();
    r.ws.say({ type: 'error', error: { message: `Incorrect API key provided: ${KEY}` } });
    r.ws.say({ type: 'response.created' });
    r.ws.say({ type: 'response.done', response: { status: 'failed', status_details: { error: { message: `bad ${KEY}` } } } });
    r.ws.fire('error', { message: `handshake rejected for ${KEY}.` });
  } finally {
    Object.assign(console, saved);
  }
  const everything = JSON.stringify([r.states, r.log, printed]);
  assert.ok(!everything.includes(KEY));
  assert.match(everything, /\[key\]/);
  assert.deepEqual(printed, []);
  assert.ok(!JSON.stringify(r.ws.sent).includes(KEY), 'and it is in no message sent to the server');
});

test('stop ends the mic and every speaker, closes the socket, reports closed once, and ignores what comes later', async () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Half a sen' });
  const [speaker] = r.players;
  r.voice.stop();
  assert.deepEqual(r.mic.signals, ['SIGTERM']);
  assert.deepEqual(speaker.signals, ['SIGKILL']);
  assert.equal(r.ws.closeCode, 1000);
  assert.deepEqual(r.log.at(-1), ['assistant', '', true], 'the open reply is ended');
  assert.equal(r.names.at(-1), 'closed');
  const states = r.states.length, procs = r.procs.length, sent = r.ws.sent.length;
  r.voice.stop();
  r.ws.fire('close', { code: 1000 });
  r.ws.say({ ...AUDIO, delta: b64([5, 6]) });
  r.ws.say({ type: 'response.created' });
  r.mic.stdout.emit('data', Buffer.from([1, 2]));
  await tick();
  assert.equal(r.states.length, states);
  assert.equal(r.procs.length, procs);
  assert.equal(r.ws.sent.length, sent);
  assert.equal(r.names.filter(n => n === 'closed').length, 1);
  assert.equal(r.log.length, 2);
});

test('stop before the socket opens closes it, and an open that races the stop starts nothing', () => {
  const r = rig();
  r.voice.stop();
  assert.equal(r.ws.closeCode, 1000);
  assert.deepEqual(r.states, [['closed', undefined]]);
  r.ws.fire('open');
  assert.equal(r.procs.length, 0);
  assert.equal(r.ws.sent.length, 0);
});

test('stop delivers text still waiting for a transcript, in order, before closed', () => {
  const r = ready();
  r.ws.say({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  r.ws.say({ type: 'response.output_audio_transcript.delta', delta: 'Sure.' });
  r.voice.stop();
  assert.deepEqual(r.log, [['assistant', 'Sure.', false], ['assistant', '', true]]);
  assert.equal(r.names.at(-1), 'closed');
  assert.ok(r.timers.every(t => t.cleared));
});

test('a dropped connection closes the mic and speakers and reports closed with the code', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.ws.readyState = 3;
  r.ws.fire('close', { code: 1006 });
  assert.deepEqual(r.mic.signals, ['SIGTERM']);
  assert.deepEqual(r.players[0].signals, ['SIGKILL']);
  assert.deepEqual(r.states.at(-1), ['closed', 'the voice connection closed (1006)']);
  assert.equal(r.ws.closeCode, null, 'it was already closed');
});

test('a normal close from the server says nothing more than closed', () => {
  const r = ready();
  r.ws.readyState = 3;
  r.ws.fire('close', { code: 1000 });
  assert.deepEqual(r.states.at(-1), ['closed', undefined]);
});

test('a failed connection is reported with its reason, then closed', () => {
  const r = rig();
  r.ws.readyState = 3;
  r.ws.fire('error', { message: 'Received network error or non-101 status code.' });
  r.ws.fire('close', { code: 1006 });
  assert.deepEqual(r.states, [
    ['error', 'the voice connection failed (Received network error or non-101 status code). Check the key and the network.'],
    ['closed', undefined],
  ]);
});

test('a missing ffmpeg says what to install and ends the chat', () => {
  const r = rig();
  r.ws.open();
  r.mic.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }));
  assert.deepEqual(r.states, [['error', 'voice chat needs ffmpeg. Install it with: brew install ffmpeg'], ['closed', undefined]]);
  assert.equal(r.ws.closeCode, 1000);
});

test('a missing ffplay says what to install and ends the chat when the first reply would play', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.players[0].emit('error', Object.assign(new Error('spawn ffplay ENOENT'), { code: 'ENOENT' }));
  assert.deepEqual(r.states.filter(s => s[0] === 'error'), [['error', 'voice chat needs ffplay. Install it with: brew install ffmpeg']]);
  assert.equal(r.names.at(-1), 'closed');
});

test('the chat ends if the mic dies by itself', () => {
  const r = ready();
  r.mic.exit(1);
  const [, detail] = r.states.find(s => s[0] === 'error');
  assert.match(detail, /^the microphone stopped \(ffmpeg exited 1\)\. Check that this terminal may use the microphone\.$/);
  assert.equal(r.names.at(-1), 'closed');
  assert.equal(r.ws.closeCode, 1000);
});

test('a speaker that dies mid-reply is reported once, the rest of that reply is dropped, and the next reply starts a new one', () => {
  const r = ready();
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([1, 2]) });
  r.players[0].exit(1);
  r.ws.say({ ...AUDIO, delta: b64([3, 4]) });
  r.ws.say({ ...AUDIO, delta: b64([5, 6]) });
  assert.equal(r.players.length, 1, 'not restarted for every piece of audio');
  assert.deepEqual(r.states.filter(s => s[0] === 'error'), [['error', 'playback stopped (ffplay exited 1)']]);
  r.ws.say(DONE);
  r.ws.say({ type: 'response.created' });
  r.ws.say({ ...AUDIO, delta: b64([7, 8]) });
  assert.equal(r.players.length, 2);
  assert.deepEqual(r.players[1].audio, [7, 8]);
});

test('it will not start without a key, or on a Node with no WebSocket', () => {
  assert.throws(() => rig({ key: '' }), /needs an OpenAI API key/);
  assert.throws(() => rig({ key: undefined }), /needs an OpenAI API key/);
  assert.throws(() => startVoice({ key: KEY, deps: { WebSocket: null } }), /built-in WebSocket/);
});

test('the voice instructions are written for a dyslexic listener', () => {
  assert.equal(DEFAULT_INSTRUCTIONS, VOICE_INSTRUCTIONS);
  for (const re of [/dyslexic/, /short spoken sentences/, /one idea/, /numbers in plain words/, /offer to say it again/, /one step at a time/, /Ready for the next step\?/])
    assert.match(VOICE_INSTRUCTIONS, re);
});
