import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, today, saveFile, latestFile, home } from '../lib/store.mjs';
import { chatMarkdown } from '../lib/chatlog.mjs';
import { copy } from '../lib/clip.mjs';
import { table } from '../lib/stats.mjs';

const FAKE_PBCOPY = fileURLToPath(new URL('./fixtures/fake-pbcopy.mjs', import.meta.url));
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dm-saved-'));
  process.env.DYSLEXIC_MODE_HOME = join(dir, 'home');
});

test('a file name says the topic in plain letters, and is never empty or longer than 40', () => {
  assert.equal(slug('How does a credit score work?'), 'how-does-a-credit-score-work');
  assert.equal(slug('  --Learn Rust!!  '), 'learn-rust');
  assert.equal(slug('!!!'), 'untitled');
  assert.equal(slug('é'), 'untitled');
  const long = slug('word '.repeat(30));
  assert.ok(long.length <= 40 && !long.endsWith('-'), long);
  assert.equal(slug('What is a prime number? Two short sentences.'), 'what-is-a-prime-number-two-short', 'the cut falls between words');
  assert.equal(slug('x'.repeat(100)), 'x'.repeat(40), 'one huge word is cut');
  assert.equal(today(new Date(2026, 10, 3)), '2026-11-03');
  assert.equal(today(new Date(2026, 0, 9)), '2026-01-09');
});

test('a saved file lands in its folder under the data dir, and a second with the same name never overwrites the first', () => {
  const a = saveFile('plans', '2026-11-03-x', 'first');
  const b = saveFile('plans', '2026-11-03-x', 'second');
  assert.equal(a, join(home(), 'plans', '2026-11-03-x.md'));
  assert.equal(b, join(home(), 'plans', '2026-11-03-x-2.md'));
  assert.equal(readFileSync(a, 'utf8'), 'first');
  assert.equal(readFileSync(b, 'utf8'), 'second');
  assert.deepEqual(readdirSync(join(home(), 'plans')).sort(), ['2026-11-03-x-2.md', '2026-11-03-x.md']);
});

test('the latest file is the one saved last, and there is none before the first save', () => {
  assert.equal(latestFile('plans'), null);
  const old = saveFile('plans', 'a-old', 'old');
  const fresh = saveFile('plans', 'b-new', 'new');
  utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1));
  utimesSync(fresh, new Date(2026, 0, 2), new Date(2026, 0, 2));
  assert.deepEqual(latestFile('plans'), { path: fresh, text: 'new' });
  utimesSync(old, new Date(2026, 0, 3), new Date(2026, 0, 3));
  assert.equal(latestFile('plans').path, old);
  writeFileSync(join(home(), 'plans', 'notes.txt'), 'not markdown');
  assert.equal(latestFile('plans').path, old, 'only markdown files count');
});

test('an exported chat quotes each of your messages and puts each reply under its own heading', () => {
  const text = chatMarkdown([
    { q: 'first line\nsecond line', text: '# A reply\n\nwith a heading\n' },
    { q: 'again', text: 'done' },
  ], { date: '2026-11-03', model: undefined, thinking: 'strong', session: 'sess-9' });
  assert.equal(text, [
    '# Chat, 2026-11-03', '',
    'Model: default. Thinking: strong. Session: sess-9.', '',
    '## You', '', '> first line', '> second line', '', '## Claude', '', '# A reply', '', 'with a heading', '',
    '## You', '', '> again', '', '## Claude', '', 'done', '',
  ].join('\n'));
  assert.match(chatMarkdown([], { date: 'd', model: 'haiku', thinking: 'off' }), /Model: haiku\. Thinking: off\.\n/);
});

test('copy hands the text to pbcopy, and says what is missing or wrong', async () => {
  const clip = join(dir, 'clip');
  process.env.FAKE_CLIP = clip;
  await copy('• first\nsecond → é', { bin: FAKE_PBCOPY });
  assert.equal(readFileSync(clip, 'utf8'), '• first\nsecond → é');
  await assert.rejects(copy('x', { bin: join(dir, 'nope') }), /needs the macOS pbcopy/);
  await assert.rejects(copy('x', { bin: 'false' }), /pbcopy exited 1/);
});

test('table keeps its two-column shape, and takes more columns with the words left-aligned on request', () => {
  assert.equal(table([['Replies', '3']]), '| Measure | Value |\n|:--------|------:|\n| Replies |     3 |');
  assert.equal(
    table([['Model', 'default'], ['Tools', 'off']], ['Setting', 'Value'], { left: [1] }),
    '| Setting | Value   |\n|:--------|:--------|\n| Model   | default |\n| Tools   | off     |',
  );
  const three = table([['System', '~3,900', '0.4%']], ['Part', 'Tokens', 'Share']).split('\n');
  assert.equal(new Set(three.map(l => l.length)).size, 1);
  assert.equal(three[1], '|:-------|-------:|------:|');
});
