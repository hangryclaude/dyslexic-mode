import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiKey, saveOpenaiKey, keyFor, saveKey } from '../lib/keys.mjs';

// Not a credential. The tests only check where it goes and that it never leaks.
const KEY = 'FAKE-KEY-FOR-TESTS';
const fakeSecurity = (result, calls = []) => Object.assign((cmd, args, options) => { calls.push({ cmd, args, options }); return result; }, { calls });

test('the environment key wins and the Keychain is never asked', () => {
  const run = fakeSecurity({ status: 0, stdout: 'from-keychain\n' });
  assert.equal(openaiKey({ env: { OPENAI_API_KEY: `  ${KEY}\n` }, run }), KEY);
  assert.equal(run.calls.length, 0);
});

test('with no environment key the Keychain item is read, minus its trailing newline', () => {
  const run = fakeSecurity({ status: 0, stdout: `${KEY}\n` });
  for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: '  ' }]) assert.equal(openaiKey({ env, run }), KEY);
  assert.equal(run.calls.length, 3);
  assert.equal(run.calls[0].cmd, 'security');
  assert.deepEqual(run.calls[0].args, ['find-generic-password', '-s', 'dyslexic-mode', '-a', 'openai', '-w']);
});

test('a missing item, a missing security command and an empty answer all mean no key', () => {
  assert.equal(openaiKey({ env: {}, run: fakeSecurity({ status: 44, stdout: '', stderr: 'could not be found' }) }), null);
  const noSecurity = Object.assign(new Error('spawnSync security ENOENT'), { code: 'ENOENT' });
  assert.equal(openaiKey({ env: {}, run: fakeSecurity({ error: noSecurity, status: null }) }), null);
  assert.equal(openaiKey({ env: {}, run: fakeSecurity({ status: 0, stdout: '\n' }) }), null);
});

test('saving adds the same item the read looks up, replacing an old one', () => {
  const run = fakeSecurity({ status: 0, stdout: '', stderr: '' });
  saveOpenaiKey(`  ${KEY}\n`, { run });
  assert.equal(run.calls[0].cmd, 'security');
  assert.deepEqual(run.calls[0].args, ['add-generic-password', '-U', '-s', 'dyslexic-mode', '-a', 'openai', '-w', KEY]);
});

test('a failed save throws, and the message never has the key in it', () => {
  const run = fakeSecurity({ status: 1, stderr: `security: refused to store ${KEY}\n` });
  assert.throws(() => saveOpenaiKey(KEY, { run }), err => {
    assert.equal(err.message, 'could not save the key to the Keychain: security: refused to store [key]');
    return true;
  });
  const noSecurity = Object.assign(new Error('spawnSync security ENOENT'), { code: 'ENOENT' });
  assert.throws(() => saveOpenaiKey(KEY, { run: fakeSecurity({ error: noSecurity, status: null }) }), /could not save the key to the Keychain: spawnSync security ENOENT/);
});

test('an empty key is refused before security is run', () => {
  const run = fakeSecurity({ status: 0 });
  for (const bad of ['', '  \n', undefined, null]) assert.throws(() => saveOpenaiKey(bad, { run }), /no key to save/);
  assert.equal(run.calls.length, 0);
});

test('reading and saving print nothing', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const saved = Object.fromEntries(methods.map(m => [m, console[m]]));
  const printed = [];
  for (const m of methods) console[m] = (...args) => printed.push(args.join(' '));
  try {
    openaiKey({ env: {}, run: fakeSecurity({ status: 0, stdout: `${KEY}\n` }) });
    saveOpenaiKey(KEY, { run: fakeSecurity({ status: 0 }) });
    assert.throws(() => saveOpenaiKey(KEY, { run: fakeSecurity({ status: 1, stderr: KEY }) }));
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(printed, []);
});

test('every service has its own key: its environment name first, then its own Keychain item', () => {
  const poe = { id: 'poe', env: 'POE_API_KEY' };
  const run = fakeSecurity({ status: 0, stdout: `${KEY}\n` });
  assert.equal(keyFor(poe, { env: { POE_API_KEY: KEY, OPENAI_API_KEY: 'not this one' }, run }), KEY);
  assert.equal(run.calls.length, 0);
  assert.equal(keyFor(poe, { env: { OPENAI_API_KEY: 'not this one' }, run }), KEY);
  assert.deepEqual(run.calls[0].args, ['find-generic-password', '-s', 'dyslexic-mode', '-a', 'poe', '-w']);
  // A local server like Ollama has no environment name, so only the Keychain is asked.
  assert.equal(keyFor({ id: 'ollama' }, { env: {}, run: fakeSecurity({ status: 44 }) }), null);
});

test('saving a service key adds that service\'s item and nothing else', () => {
  const run = fakeSecurity({ status: 0 });
  saveKey('openrouter', ` ${KEY} `, { run });
  assert.deepEqual(run.calls.map(c => c.args), [['add-generic-password', '-U', '-s', 'dyslexic-mode', '-a', 'openrouter', '-w', KEY]]);
});
