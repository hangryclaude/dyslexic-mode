import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGrokSession, parseGrokModels, parseModelsCache, parseConfigToml, grokModels } from '../lib/providers/grok.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-grok.mjs', import.meta.url));
let log, dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dm-grok-'));
  log = join(dir, 'argv');
  mkdirSync(join(dir, 'state'));
  process.env.FAKE_LOG = log;
  process.env.FAKE_STATE = join(dir, 'state');
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
});
const launches = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const arg = (argv, name) => argv[argv.indexOf(name) + 1];
const opened = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });
const open = (o = {}) => {
  const s = openGrokSession({ system: 'SYS', bin: FAKE, model: 'grok-4.7', ...o });
  opened.push(s);
  return s;
};

test('text streams in as it is written, and the first reply names its session and its token use', async () => {
  const s = open();
  const parts = [];
  const r = await s.send('hello there', { onText: t => parts.push(t) });
  assert.equal(r.text, 'echo: hello there');
  assert.ok(parts.length > 1, 'more than one piece');
  assert.equal(parts.join(''), 'echo: hello there');
  assert.match(r.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(s.id, r.sessionId);
  // Turn 1: 100 fresh + 50 cached read, wrote 17.
  assert.deepEqual(r.usage, { input: 150, output: 17, cached: 50, contextUsed: 167 });
  s.close();
});

test('the second turn resumes the first one\'s session and remembers it, and a start-up that outlasts the reply does not fail it', async () => {
  const s = open();
  const a = await s.send('remember zebra');
  const b = await s.send('-what was it');
  assert.equal(b.text, 'echo: -what was it [remembers: remember zebra]');
  assert.equal(b.sessionId, a.sessionId);
  assert.deepEqual(b.usage, { input: 250, output: b.text.length, cached: 50, contextUsed: 250 + b.text.length });
  const [one, two] = launches();
  assert.equal(arg(one.argv, '--session-id'), a.sessionId);
  assert.ok(!one.argv.includes('--resume'));
  assert.equal(arg(two.argv, '--resume'), a.sessionId);
  assert.ok(!two.argv.includes('--session-id'));
  s.close();
});

test('plain chat: system prompt replaced, tools and extras switched off, run from the data folder', async () => {
  const s = open({ effort: 'low' });
  await s.send('-hi "there"');
  s.close();
  const { argv, env, cwd } = launches()[0];
  // A prompt that starts with "-" goes in as --single=value, so it is never read as a flag.
  assert.ok(argv.includes('--single=-hi "there"'));
  assert.ok(argv.includes('--system-prompt-override=SYS'));
  assert.equal(arg(argv, '--output-format'), 'streaming-messages-json');
  assert.ok(argv.includes('--include-partial-messages'));
  assert.equal(arg(argv, '--model'), 'grok-4.7');
  assert.equal(arg(argv, '--reasoning-effort'), 'low');
  // An empty --tools is ignored by grok, so one tool is allowed and then denied along with the MCP gateway.
  assert.equal(arg(argv, '--tools'), 'todo_write');
  assert.equal(arg(argv, '--disallowed-tools'), 'todo_write,search_tool,use_tool');
  for (const flag of ['--no-subagents', '--disable-web-search', '--no-plan']) assert.ok(argv.includes(flag), flag);
  for (const k of ['GROK_CLAUDE_AGENTS_ENABLED', 'GROK_CLAUDE_RULES_ENABLED', 'GROK_CLAUDE_SKILLS_ENABLED', 'GROK_CLAUDE_MCPS_ENABLED', 'GROK_CURSOR_SKILLS_ENABLED'])
    assert.equal(env[k], 'false', k);
  for (const k of ['GROK_MEMORY', 'GROK_SUBAGENTS', 'GROK_WORKFLOWS', 'GROK_WEB_FETCH']) assert.equal(env[k], '0', k);
  // Always the same folder, because a session can only be resumed from the folder it started in.
  assert.equal(realpathSync(cwd), realpathSync(join(process.env.DYSLEXIC_MODE_HOME, 'grok')));
});

test('reasoning never reaches the reply', async () => {
  const s = open();
  const parts = [];
  const r = await s.send('THINK about it', { onText: t => parts.push(t) });
  assert.equal(r.text, 'echo: THINK about it');
  assert.ok(!parts.join('').includes('secret'));
  s.close();
});

test('interrupt ends a reply early and keeps what streamed, and the next reply resumes the same chat', async () => {
  const s = open();
  const first = await s.send('first');
  const running = s.send('SLOW one', { onText: () => { s.interrupt(); } });
  const r = await running;
  assert.deepEqual(r, { text: 'partial ', sessionId: first.sessionId, stopped: true, usage: { input: null, output: null, cached: null, contextUsed: null } });
  assert.equal(s.interrupt(), false, 'nothing left to stop');
  const next = await s.send('next');
  assert.equal(next.text, 'echo: next [remembers: first]');
  s.close();
});

test('a process that dies fails its reply, and the next reply carries on in the same session', async () => {
  const s = open();
  const first = await s.send('first');
  await assert.rejects(s.send('DIE now'), /exited 3/);
  assert.equal((await s.send('after')).sessionId, first.sessionId);
  s.close();
});

test('an error result fails the reply, a second send waits its turn, and close settles a busy reply', async () => {
  const s = open();
  await assert.rejects(s.send('FAIL'), /boom/);
  const slow = s.send('SLOW');
  await assert.rejects(s.send('too soon'), /still running/);
  s.close();
  assert.equal((await slow).stopped, true);
  await assert.rejects(s.send('after close'), /closed/);
});

test('a grok that lists a tool is stopped and the reply fails, so a tool can never run unnoticed', async () => {
  const s = open();
  await assert.rejects(s.send('TOOLS please'), /offered 1 tools/);
  s.close();
});

test('resuming a session that grok does not have fails loudly', async () => {
  const s = open({ resume: '00000000-0000-4000-8000-000000000000' });
  await assert.rejects(s.send('hi'), /not found/);
});

test('grok models and their windows: the list, xAI\'s cache and the user\'s own models', async () => {
  assert.deepEqual(parseGrokModels('Default model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.6\n  - custom-model\n'), ['grok-4.7', 'grok-4.6', 'custom-model']);
  assert.deepEqual([...parseModelsCache({ models: { 'grok-4.7': { info: { context_window: 256000 } }, odd: { info: {} } } })], [['grok-4.7', 256000]]);
  const toml = '[ui]\nyolo = false\n\n[model.custom-model]\nmodel = "custom-model"\ncontext_window = 262144\n\n[model."dotted.id"]\ncontext_window = 1000000\n\n[models]\ncontext_window = 5\n';
  assert.deepEqual([...parseConfigToml(toml)], [['custom-model', 262144], ['dotted.id', 1000000]]);
  const grokDir = join(dir, 'grokhome');
  mkdirSync(grokDir);
  writeFileSync(join(grokDir, 'config.toml'), toml);
  writeFileSync(join(grokDir, 'models_cache.json'), JSON.stringify({ models: { 'grok-4.7': { info: { context_window: 256000 } } } }));
  assert.deepEqual(await grokModels({ bin: FAKE, dir: grokDir }), [
    { id: 'grok-4.7', contextWindow: 256000 },
    { id: 'grok-4.6', contextWindow: null },
    { id: 'custom-model', contextWindow: 262144 },
  ]);
});
