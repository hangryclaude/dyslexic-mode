import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../lib/session.mjs';
import { toolLine } from '../lib/claude.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
let log;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-sess-'));
  log = join(dir, 'argv');
  process.env.FAKE_LOG = log;
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
});
const launches = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const open = (o = {}) => openSession({ system: 'SYS', bin: FAKE, ...o });

test('one process serves every turn, and text streams in as it is written', async () => {
  const s = open();
  const parts = [];
  const a = await s.send('hello there', { onText: t => parts.push(t) });
  assert.deepEqual(a, { text: 'echo: hello there', sessionId: 'sess-1', usage: { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 3003, output_tokens: 5 } });
  assert.ok(parts.length > 1, 'more than one piece');
  assert.equal(parts.join(''), 'echo: hello there');
  const b = await s.send('-and again');
  assert.equal(b.text, 'echo: -and again');
  assert.equal(launches().length, 1);
  s.close();
});

test('the chat process reads turns as stream-json and runs plain chat from the data dir', async () => {
  const s = open();
  await s.send('hi');
  s.close();
  const { argv, bridge, cwd } = launches()[0];
  for (const pair of [['--input-format', 'stream-json'], ['--output-format', 'stream-json'], ['--tools', ''], ['--system-prompt', 'SYS']])
    assert.equal(argv[argv.indexOf(pair[0]) + 1], pair[1], pair[0]);
  assert.ok(argv.includes('--include-partial-messages'));
  assert.ok(argv.includes('--strict-mcp-config'), 'a chat with no tools carries no MCP tool definitions');
  assert.equal(bridge, '1');
  // Always the same folder, so the session can be resumed from anywhere later.
  assert.equal(realpathSync(cwd), realpathSync(process.env.DYSLEXIC_MODE_HOME));
});

test('tool calls reach the status, and a subagent\'s text never reaches the reply', async () => {
  const s = open({ tools: true });
  const parts = [], tools = [];
  const r = await s.send('TOOL go', { onText: t => parts.push(t), onTool: b => tools.push(toolLine(b)) });
  s.close();
  assert.equal(r.text, 'found 3 folders');
  assert.deepEqual(tools, ['running: ls ~/dev']);
  assert.equal(parts.join(''), 'let me look\n\nfound 3 folders');
});

test('interrupt ends a turn early, keeps what streamed, and the chat carries on', async () => {
  const s = open();
  const parts = [];
  const running = s.send('SLOW one', { onText: t => { parts.push(t); s.interrupt(); } });
  const r = await running;
  assert.deepEqual(r, { text: 'partial ', sessionId: 'sess-1', stopped: true });
  assert.equal(s.interrupt(), false, 'nothing left to stop');
  assert.equal((await s.send('next')).text, 'echo: next');
  assert.equal(launches().length, 1);
  s.close();
});

test('a dead process fails its turn, and the next turn resumes the session in a new one', async () => {
  const s = open();
  await s.send('first');
  await assert.rejects(s.send('DIE now'), /exited 3/);
  assert.equal((await s.send('after')).text, 'echo: after');
  const [one, two] = launches();
  assert.ok(!one.argv.includes('--resume'));
  assert.equal(two.argv[two.argv.indexOf('--resume') + 1], 'sess-1');
  s.close();
});

test('an error result fails the turn, a second send waits its turn, and close settles a busy turn', async () => {
  const s = open({ resume: 'old-id' });
  await assert.rejects(s.send('FAIL'), /boom/);
  assert.equal(launches()[0].argv[launches()[0].argv.indexOf('--resume') + 1], 'old-id');
  const slow = s.send('SLOW');
  await assert.rejects(s.send('too soon'), /still running/);
  s.close();
  assert.equal((await slow).stopped, true);
  await assert.rejects(s.send('after close'), /closed/);
});

test('a claude that stops reading fails the turn, and the chat lives on', async () => {
  // It shuts its stdin and lingers, so the turn's message hits a closed pipe.
  const bin = join(mkdtempSync(join(tmpdir(), 'dm-deaf-')), 'deaf');
  writeFileSync(bin, '#!/bin/sh\nexec 0<&-\nexec sleep 5\n', { mode: 0o755 });
  const s = open({ bin });
  s.warm();
  await new Promise(r => setTimeout(r, 200));
  await assert.rejects(s.send('hello'), /claude exited/);
});
