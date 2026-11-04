import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openVoice, NO_KEY } from '../lib/voicechat.mjs';

// A startVoice that hands the test the callbacks, so it can play the server's part.
function rig(extra = {}) {
  const r = { seen: [], turns: [], ended: 0, stops: 0 };
  const screen = {
    user: text => r.seen.push(['user', text]),
    reply: (delta, done) => r.seen.push(['reply', delta, done]),
    note: text => r.seen.push(['note', text]),
    problem: text => r.seen.push(['problem', text]),
  };
  const start = options => {
    r.options = options;
    return { stop: () => { r.stops++; } };
  };
  r.voice = openVoice({ key: 'K', screen, onTurn: turn => r.turns.push(turn), onEnd: () => { r.ended++; }, start, ...extra });
  return r;
}

test('the missing-key line is the one the user was promised', () => {
  assert.equal(NO_KEY, "ChatGPT voice needs an OpenAI key. Type /key openai to add it. It is saved in your Mac's Keychain, never in a file.");
});

test('the key and any other option go on to startVoice, and what it returns comes back', () => {
  const r = rig({ voice: 'cedar', micInput: ':2' });
  assert.equal(r.options.key, 'K');
  assert.equal(r.options.voice, 'cedar');
  assert.equal(r.options.micInput, ':2');
  assert.equal(typeof r.options.onUser, 'function');
  r.voice.stop();
  assert.equal(r.stops, 1);
});

test('both sides reach the screen as they come, and a finished exchange goes to onTurn with the whole reply', () => {
  const r = rig();
  r.options.onUser('what is a verb');
  r.options.onAssistant('A verb is ', false);
  r.options.onAssistant('an action word.', false);
  assert.deepEqual(r.turns, [], 'not until the reply ends');
  r.options.onAssistant('', true);
  assert.deepEqual(r.seen, [['user', 'what is a verb'], ['reply', 'A verb is ', false], ['reply', 'an action word.', false], ['reply', '', true]]);
  assert.deepEqual(r.turns, [{ q: 'what is a verb', text: 'A verb is an action word.' }]);
  // The next exchange starts clean.
  r.options.onAssistant('Hello again.', false);
  r.options.onAssistant('', true);
  assert.deepEqual(r.turns[1], { q: '(spoken)', text: 'Hello again.' });
});

test('a reply with nothing in it is not an exchange', () => {
  const r = rig();
  r.options.onUser('mm');
  r.options.onAssistant('  ', false);
  r.options.onAssistant('', true);
  assert.deepEqual(r.turns, []);
});

test('listening is announced once with the headphones hint, and a problem is passed on', () => {
  const r = rig();
  r.options.onState('listening');
  r.options.onState('thinking');
  r.options.onState('listening');
  r.options.onState('error', 'the microphone stopped');
  assert.deepEqual(r.seen, [
    ['note', 'voice is on. wear headphones and say something. /voice stops it'],
    ['problem', 'the microphone stopped'],
  ]);
});

test('a close the user asked for has no reason, one the connection forced says why, and both end the chat', () => {
  const asked = rig();
  asked.options.onState('closed');
  assert.deepEqual(asked.seen, []);
  assert.equal(asked.ended, 1);
  const forced = rig();
  forced.options.onState('closed', 'the voice connection closed (1006)');
  assert.deepEqual(forced.seen, [['problem', 'the voice connection closed (1006)']]);
  assert.equal(forced.ended, 1);
});

test('startVoice failing right away, for no key or no WebSocket, reaches the caller', () => {
  const start = () => { throw new Error('voice chat needs an OpenAI API key'); };
  assert.throws(() => openVoice({ key: '', screen: {}, start }), /needs an OpenAI API key/);
});
