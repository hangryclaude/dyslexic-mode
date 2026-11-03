import { spawn } from 'node:child_process';

// Live voice chat on the OpenAI Realtime API. The mic goes up as 24 kHz mono PCM, the reply comes
// back the same way, and both sides arrive as text. ffmpeg records and ffplay plays, so nothing
// needs installing beyond them. The socket, the processes and the clock all come in through
// `deps`, which is how the tests run with no mic, no speakers and no key.
const RATE = 24000;
const BYTES_PER_MS = (RATE * 2) / 1000;
const OPEN = 1;
// How long a reply's text waits for the transcript of the user's own words, so the screen shows
// the two in the order they were said.
const HOLD_MS = 3000;

export const VOICE_INSTRUCTIONS = [
  'You are a calm, patient voice helper for someone who is dyslexic. They are listening to you, and what you say also shows as text on their screen.',
  '',
  'How to speak:',
  '- Use short spoken sentences. Put one idea in each.',
  '- Give one thing at a time, then stop and let them answer.',
  '- Use plain, common words. If a hard word is needed, say what it means.',
  '- Say numbers in plain words, like "twenty-five percent" or "about two thousand". Never read out symbols, links, code or long strings of digits. Say what they are and point to the screen.',
  '- Keep a calm, steady pace. Never rush.',
  '- When you have said something with more than one part, offer to say it again. If they ask you to repeat, use simpler words.',
  '- If they ask how to spell a word, say it slowly in small groups of letters.',
  '',
  'For a study plan, say one step at a time. Say the step, then ask "Ready for the next step?" and wait for a yes. Never list the whole plan at once.',
  '',
  'If you did not catch what they said, say so and ask them to say it again. Do not guess. If they start talking, stop and listen.',
].join('\n');
export default VOICE_INSTRUCTIONS;

// Starts a voice chat and returns { stop }. onUser(text) gets what the user said, onAssistant(delta,
// done) the reply as it is spoken (done is true once, with an empty delta, when it ends), and
// onState(name, detail) one of listening, thinking, speaking, error or closed. Nothing is
// reported after closed. Wear headphones: with speakers the mic hears the reply, the server
// takes that for the user cutting in, and the reply stops itself.
export function startVoice({
  key, instructions = VOICE_INSTRUCTIONS, voice = 'marin', model = 'gpt-realtime',
  transcriptionModel = 'gpt-4o-mini-transcribe', micInput = ':0',
  onUser, onAssistant, onState, deps = {},
}) {
  const {
    WebSocket: Socket = globalThis.WebSocket, spawn: run = spawn, now = Date.now,
    setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout,
  } = deps;
  if (!key) throw new Error('voice chat needs an OpenAI API key');
  if (!Socket) throw new Error('voice chat needs a Node with a built-in WebSocket (22 or newer)');

  let stopped = false, finished = false, lastState = null;
  let mic = null, carry = Buffer.alloc(0);
  // Every ffplay still alive. A reply is sent far faster than it plays, so when the user cuts in
  // the server has usually finished and the speaker is still working through its buffer.
  const players = new Set();
  let speaker = null, responding = false, dropping = false, playing = null, cuts = 0;
  let replyOpen = false, holdTimer = null, held = [];
  const untranscribed = new Set();

  const redact = s => String(s).split(key).join('[key]');
  function state(name, detail) {
    if (finished || (name === lastState && name !== 'error')) return;
    lastState = name;
    if (name === 'closed') finished = true;
    onState?.(name, detail === undefined ? undefined : redact(detail));
  }
  const idle = () => { if (!responding && !players.size) state('listening'); };
  // A problem the chat can carry on through. The caller gets the error, then the state goes on.
  function warn(message) {
    state('error', message);
    idle();
  }
  // A problem the chat cannot carry on through.
  function fail(message) {
    if (stopped) return;
    state('error', message);
    stop();
  }

  // The key goes in the handshake header. A socket URL ends up in logs, a header does not.
  const ws = new Socket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const send = msg => { if (ws.readyState === OPEN) ws.send(JSON.stringify(msg)); };

  function launch(cmd, args, stdio) {
    const child = run(cmd, args, { stdio });
    child.on('error', err => fail(err.code === 'ENOENT'
      ? `voice chat needs ${cmd}. Install it with: brew install ffmpeg`
      : `${cmd} failed: ${err.message}`));
    return child;
  }

  function startMic() {
    mic = launch('ffmpeg', [
      '-loglevel', 'quiet', '-f', 'avfoundation', '-i', micInput,
      '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-',
    ], ['ignore', 'pipe', 'ignore']);
    mic.stdout.on('data', chunk => {
      // A pipe read can end between the two bytes of a sample. The odd byte waits for the next
      // read, so every append is whole samples.
      const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = bytes.length - (bytes.length % 2);
      carry = bytes.subarray(whole);
      if (whole) send({ type: 'input_audio_buffer.append', audio: bytes.subarray(0, whole).toString('base64') });
    });
    mic.on('close', code => fail(`the microphone stopped (ffmpeg exited ${code ?? 'on a signal'}). Check that this terminal may use the microphone.`));
  }

  function openSpeaker() {
    const child = launch('ffplay', [
      '-loglevel', 'quiet', '-nodisp', '-autoexit',
      '-f', 's16le', '-sample_rate', String(RATE), '-ch_layout', 'mono', '-i', '-',
    ], ['pipe', 'ignore', 'ignore']);
    players.add(child);
    // Writing to a speaker that was just killed fails. Its close event is where that is handled.
    child.stdin.on('error', () => {});
    child.on('close', code => {
      const ours = players.delete(child);
      if (speaker === child) speaker = null;
      // A speaker silenced on purpose is already out of the set and has nothing to report.
      if (!ours) return;
      if (!code) return idle();
      // Dropping the rest of this reply stops a broken ffplay being restarted for every piece of audio.
      dropping = true;
      warn(`playback stopped (ffplay exited ${code})`);
    });
    return child;
  }

  // Closing stdin lets ffplay play out what it has, then exit on its own.
  function endSpeaker() {
    speaker?.stdin.end();
    speaker = null;
  }

  // SIGKILL, not SIGTERM: a player that is slow to leave keeps talking over the user.
  function silence(child) {
    players.delete(child);
    child.kill('SIGKILL');
  }

  // The user cut in. The speaker stops now and the server is told how much of the reply was
  // heard, so it does not think they heard all of it. If it refuses, the only loss is that.
  function interrupt() {
    if (players.size && playing) {
      const sent = playing.bytes / BYTES_PER_MS, elapsed = now() - playing.startedAt;
      send({
        type: 'conversation.item.truncate', event_id: `truncate-${++cuts}`,
        item_id: playing.itemId, content_index: playing.contentIndex,
        audio_end_ms: Math.max(0, Math.floor(Math.min(sent, elapsed))),
      });
    }
    playing = null;
    for (const child of players) silence(child);
    speaker = null;
    // Audio of the cancelled reply may still be on its way. It is dropped until the next reply starts.
    dropping = true;
    closeReply();
    state('listening');
  }

  function onAudio(ev) {
    if (dropping || !ev.delta) return;
    const audio = Buffer.from(ev.delta, 'base64');
    speaker ??= openSpeaker();
    speaker.stdin.write(audio);
    if (ev.item_id) {
      if (playing?.itemId !== ev.item_id) playing = { itemId: ev.item_id, contentIndex: ev.content_index ?? 0, startedAt: now(), bytes: 0 };
      playing.bytes += audio.length;
    }
    state('speaking');
  }

  // The reply's text, held back while a transcript of what the user just said is still on its way.
  function tell(text, done) {
    replyOpen = !done;
    if (!untranscribed.size) return onAssistant?.(text, done);
    held.push([text, done]);
    holdTimer ??= later(releaseHeld, HOLD_MS);
  }
  function releaseHeld() {
    cancel(holdTimer);
    holdTimer = null;
    untranscribed.clear();
    const waiting = held;
    held = [];
    for (const [text, done] of waiting) onAssistant?.(text, done);
  }
  function userHeard(itemId) {
    untranscribed.delete(itemId);
    if (!untranscribed.size) releaseHeld();
  }
  // A reply that is cut short or cancelled never sends its own end, so it is ended here.
  function closeReply() {
    if (replyOpen) tell('', true);
  }

  function onMessage(raw) {
    if (stopped) return;
    let ev;
    try { ev = JSON.parse(String(raw)); } catch (err) { return warn(`unexpected message from OpenAI: ${err.message}`); }
    switch (ev.type) {
      case 'session.updated':
        state('listening');
        break;
      case 'input_audio_buffer.speech_started':
        interrupt();
        break;
      case 'input_audio_buffer.speech_stopped':
        state('thinking');
        break;
      case 'input_audio_buffer.committed':
        if (ev.item_id) untranscribed.add(ev.item_id);
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(ev.transcript ?? '').trim();
        if (text) onUser?.(text);
        userHeard(ev.item_id);
        break;
      }
      case 'conversation.item.input_audio_transcription.failed':
        userHeard(ev.item_id);
        break;
      case 'response.created':
        responding = true;
        dropping = false;
        if (!players.size) state('thinking');
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        onAudio(ev);
        break;
      case 'response.output_audio.done':
      case 'response.audio.done':
        endSpeaker();
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (ev.delta) tell(ev.delta, false);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        closeReply();
        break;
      case 'response.done': {
        responding = false;
        endSpeaker();
        closeReply();
        if (ev.response?.status === 'failed') warn(ev.response.status_details?.error?.message ?? 'the reply failed');
        else idle();
        break;
      }
      case 'error':
        // The trim sent when the user cuts in carries an id of ours. A refusal of it costs nothing the user sees.
        if (!ev.error?.event_id?.startsWith('truncate-')) warn(ev.error?.message ?? 'OpenAI sent an error');
        break;
    }
  }

  function stop(detail) {
    if (stopped) return;
    stopped = true;
    // Everything is released before any callback runs, so a callback that throws cannot leave the mic on.
    mic?.kill();
    for (const child of players) silence(child);
    speaker = null;
    if (ws.readyState < 2) ws.close(1000);
    // Text still waiting for a transcript is delivered and the open reply ended, ahead of closed.
    releaseHeld();
    closeReply();
    state('closed', detail);
  }

  ws.addEventListener('open', () => {
    // An open that races a stop must not start the mic after it.
    if (stopped) return;
    send({
      type: 'session.update',
      // The model is fixed by the URL, so it is left out here.
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: RATE },
            transcription: { model: transcriptionModel },
            // A pause to find a word should not end the turn, so wait longer than the default 500 ms.
            turn_detection: { type: 'server_vad', silence_duration_ms: 700, create_response: true, interrupt_response: true },
          },
          output: { format: { type: 'audio/pcm', rate: RATE }, voice },
        },
      },
    });
    startMic();
  });
  ws.addEventListener('message', e => onMessage(e.data));
  ws.addEventListener('error', e => fail(`the voice connection failed (${String(e.message || e.error?.message || 'could not connect').replace(/\.$/, '')}). Check the key and the network.`));
  ws.addEventListener('close', e => stop(e.code && e.code !== 1000 ? `the voice connection closed (${e.code})` : undefined));

  // Not `stop` itself: it would take whatever an event hands it as the reason.
  return { stop() { stop(); } };
}
