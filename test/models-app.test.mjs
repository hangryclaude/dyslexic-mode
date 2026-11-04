import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, launches, argAfter, isChat, grokLaunches, opencodeLaunches } from './fixtures/app.mjs';

// The app against fake claude, grok and opencode CLIs: /model really moves the chat to another
// provider, and everything that asks a model something follows it there.
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-models-app-'));
  return { dir, home: join(dir, 'home'), log: join(dir, 'argv') };
};
const rowsOf = home => readFileSync(join(home, 'chats.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('a chat on grok: the reply streams from grok, the window is grok\'s own, and the counts are what grok reported', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/model grok/grok-4.7');
  await app.until(/model: grok\/grok-4\.7\. fresh chat/);
  app.type('hello');
  await app.until(/echo: hello[\s\S]*re-read clean/);
  app.type('/context');
  // Turn 1 on the fake grok: 100 fresh + 50 cached read, and the 11 characters of "echo: hello" written.
  await app.until(/161 of 256,000 tokens\./);
  assert.doesNotMatch(app.out(), /the window size is a guess/);
  app.type('/status');
  await app.until(/Context +│ +<0\.1% of 256,000/);
  assert.match(app.out(), /Model +│ +grok\/grok-4\.7/);
  app.type('/exit');
  await app.closed;
  const [one, ...more] = grokLaunches(log);
  assert.equal(more.length, 0);
  assert.equal(argAfter(one, '--model'), 'grok-4.7');
  assert.ok(one.argv.some(a => a.startsWith('--single=hello')));
  assert.ok(one.argv.some(a => a.startsWith('--system-prompt-override=') && a.includes('dyslexic mode')), 'grok gets the same system prompt');
  const l = await launches(log, 1);
  assert.equal(l.length, 1, 'claude was only started before the switch');
  const [row] = rowsOf(home);
  assert.equal(row.model, 'grok/grok-4.7');
  assert.match(row.session, /^[0-9a-f-]{36}$/);
});

test('a chat on opencode: the model list gives the window, and the counts add the cache and the reasoning back', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/model gemini-4-argon');
  await app.until(/gemini-4-argon → opencode-go\/gemini-4-argon\n[\s\S]*model: opencode-go\/gemini-4-argon\. fresh chat/);
  app.type('hello');
  await app.until(/echo: hello[\s\S]*re-read clean/);
  app.type('/context');
  // 16 read (10 fresh, 5 cached, 1 newly cached) and 13 written (11 reply, 2 reasoning).
  await app.until(/29 of 1,048,576 tokens\./);
  app.type('/exit');
  await app.closed;
  assert.ok(opencodeLaunches(log).length >= 2, 'one server listed the models, one ran the chat');
  assert.equal(rowsOf(home)[0].model, 'opencode-go/gemini-4-argon');
});

test('full access is Claude\'s alone: a model from another provider turns it off, and it cannot be turned on there', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/tools');
  await app.until(/full access on\. fresh chat/);
  app.type('/model grok/grok-4.7');
  await app.until(/full access works with Claude only, so tools are off\n[\s\S]*model: grok\/grok-4\.7/);
  app.type('/status');
  await app.until(/Tools +│ +off/);
  app.type('/tools');
  await app.until(/full access works with Claude only, not grok\/grok-4\.7\. \/model picks a Claude model first/);
  app.type('/status');
  await app.until(/(Tools +│ +off[\s\S]*){2}/);
  app.type('/model opus');
  await app.until(/model: claude\/opus\. fresh chat/);
  app.type('/tools');
  await app.until(/full access on\. fresh chat/);
  app.type('/exit');
  await app.closed;
});

test('what the app asks on the side, like /plan, goes to the model in use', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/model grok/grok-4.7');
  await app.until(/model: grok\/grok-4\.7\. fresh chat/);
  app.type('/plan learn chess');
  await app.until(/the plan was not valid JSON/);
  app.type('/exit');
  await app.closed;
  const asked = grokLaunches(log).filter(x => x.argv.some(a => a.startsWith('--single=Goal: learn chess')));
  assert.equal(asked.length, 1, 'grok got the plan question');
  assert.equal((await launches(log, 1)).filter(x => !isChat(x)).length, 0, 'claude was not asked anything');
});

test('going back to a chat from another provider switches to its model, and a chat within one provider keeps the model in use', async () => {
  const { home, log } = setup();
  const first = run([], home, log);
  first.type('/model grok/grok-4.7');
  await first.until(/model: grok\/grok-4\.7\. fresh chat/);
  first.type('remember zebra');
  await first.until(/re-read clean/);
  first.type('/exit');
  await first.closed;

  // --model is for one launch, but the chat's session id means nothing to claude, so it follows the chat.
  const again = run(['-c', '--model', 'haiku'], home, log);
  await again.until(/back in: remember zebra[\s\S]*echo: remember zebra/);
  assert.match(again.out(), /chat only: tools are off · model grok\/grok-4\.7/);
  again.type('and now');
  await again.until(/echo: and now \[remembers: remember zebra\]/);
  again.type('/exit');
  await again.closed;
  const [one, two] = grokLaunches(log);
  assert.equal(argAfter(two, '--resume'), argAfter(one, '--session-id'));

  // The same provider: the model in use stays, whatever began the chat.
  const { home: home2, log: log2 } = setup();
  const a = run(['--model', 'opus'], home2, log2);
  a.type('hello opus');
  await a.until(/re-read clean/);
  a.type('/exit');
  await a.closed;
  const b = run(['-c', '--model', 'haiku'], home2, log2);
  await b.until(/back in: hello opus/);
  assert.match(b.out(), /model claude\/haiku/);
  b.type('/exit');
  await b.closed;
});

test('a model nobody takes, and full access on a model that cannot have it, are put right at the start and said once', async () => {
  const { home, log } = setup();
  const bad = run(['--model', 'nonsense'], home, log);
  await bad.until(/no model called "nonsense", so the default model is used/);
  bad.type('hello');
  await bad.until(/echo: hello/);
  bad.type('/exit');
  await bad.closed;
  assert.ok(!(await launches(log, 1))[0].argv.includes('--model'), 'claude\'s own default');

  const full = setup();
  const app = run(['--full', '--model', 'grok/grok-4.7'], full.home, full.log, {}, { noTools: false });
  await app.until(/chat only: tools are off · model grok\/grok-4\.7\n {2}full access works with Claude only, so tools are off for grok\/grok-4\.7\n/);
  app.type('/exit');
  await app.closed;
});

test('/model refresh asks every provider again and says which could not be asked', async () => {
  const { dir, home, log } = setup();
  const app = run([], home, log, { DYSLEXIC_OPENCODE_BIN: join(dir, 'no-such-opencode') });
  app.type('/model refresh');
  await app.until(/opencode could not be asked: .*\n[\s\S]*7 models from 2 companies\. \/model lists them/);
  app.type('/exit');
  await app.closed;
});

test('a window the model reports is kept, so the next launch starts with the right size and no guess', async () => {
  const { home, log } = setup();
  const first = run([], home, log, { FAKE_WINDOW: '1000000' });
  first.type('/model sonnet');
  await first.until(/model: claude\/sonnet\. fresh chat/);
  first.type('/context');
  await first.until(/the window size is a guess: 200,000\./);
  first.type('hello');
  await first.until(/re-read clean/);
  first.type('/exit');
  await first.closed;
  assert.equal(JSON.parse(readFileSync(join(home, 'models.json'), 'utf8')).learned['claude/sonnet'], 1000000);

  const again = run([], home, log);
  again.type('/context');
  await again.until(/of 1,000,000 tokens\./);
  assert.doesNotMatch(again.out(), /the window size is a guess/);
  again.type('/exit');
  await again.closed;
});

test('a settings file from before the model list still works: a bare alias is the Claude model of that name', async () => {
  const { home, log } = setup();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'haiku' }));
  const app = run([], home, log);
  app.type('/model claude/haiku');
  await app.until(/already on claude\/haiku/);
  app.type('/exit');
  await app.closed;
  assert.equal(argAfter((await launches(log, 1))[0], '--model'), 'haiku');
});
