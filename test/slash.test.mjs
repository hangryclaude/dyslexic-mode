import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, launches, argAfter, isChat, FAKE_PBCOPY } from './fixtures/app.mjs';
import { MENU } from '../lib/commands.mjs';
import { carryPrompt } from '../lib/compact.mjs';
import { STYLES } from '../lib/thinking.mjs';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-slash-'));
  return { dir, home: join(dir, 'home'), log: join(dir, 'argv'), prompts: join(dir, 'prompts') };
};
const settings = home => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
const promptsOf = file => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const tokens = s => Math.ceil(s.length / 4);
const num = s => Number(s.replaceAll(',', ''));

test('/help lists every command under its group with a one-line description', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/help');
  await app.until(/typos are fine/);
  const out = app.out();
  assert.match(out, /Chat\n +! +flag the last reply as hard to read/);
  for (const group of ['Chat', 'Model and tools', 'Your reading', 'Looks and sound', 'Other']) assert.match(out, new RegExp(`^ +${group}$`, 'm'));
  for (const [name, help] of MENU) assert.ok(out.includes(`${name.padEnd(8)}  ${help}`), name);
  assert.match(out, /\/exit +quit/);
  app.type('/exit');
  await app.closed;
});

test('the start-up lines point at /help and no longer mention reading aloud', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  await app.until(/chat only: tools are off[\s\S]*esc stops a reply\. \/help lists every command\./);
  assert.doesNotMatch(app.out(), /aloud|\btab\b/i);
  app.type('/exit');
  await app.closed;
});

test('/model switches by name, forgives a slip, remembers the choice, and starts a fresh session each time', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('hello');
  await app.until(/re-read clean/);
  app.type('/model haiku');
  await app.until(/model: claude\/haiku\. fresh chat/);
  app.type('/model hiaku');
  await app.until(/hiaku → claude\/haiku\n[\s\S]*already on claude\/haiku/);
  app.type('/model nonsense');
  await app.until(/no model "nonsense"\. these are the models: claude\/fable, claude\/opus, claude\/sonnet, claude\/haiku, grok\/grok-4\.7, grok\/grok-4\.6, grok\/custom-model, opencode-go\/gemini-4-argon, opencode-go\/gpt-6-luna, fake\/echo\n/);
  app.type('/model opus[1m]');
  await app.until(/model: opus\[1m\]\. fresh chat/);
  app.type('/exit');
  await app.closed;
  const l = await launches(log, 3);
  assert.equal(l.length, 3);
  assert.ok(!l[0].argv.includes('--model'));
  assert.equal(argAfter(l[1], '--model'), 'haiku');
  assert.ok(!l[1].argv.includes('--resume'), 'a new model is a new session');
  assert.equal(argAfter(l[2], '--model'), 'opus[1m]');
  assert.equal(settings(home).model, 'opus[1m]');
});

test('/model alone lists the models when there is no menu to draw, and a saved model is used at the next start', async () => {
  const { home, log } = setup();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  const app = run([], home, log);
  await app.until(/chat only: tools are off · model claude\/sonnet/);
  app.type('/model');
  await app.until(/models: claude\/fable, claude\/opus, claude\/sonnet, claude\/haiku, grok\/grok-4\.7, .*, fake\/echo\. type \/model and a name/);
  app.type('/status');
  await app.until(/Model +│ +claude\/sonnet/);
  app.type('/exit');
  await app.closed;
  assert.equal(argAfter((await launches(log, 1))[0], '--model'), 'sonnet');
});

test('--model is for one launch and is not saved', async () => {
  const { home, log } = setup();
  const app = run(['--model', 'haiku'], home, log);
  app.type('/status');
  await app.until(/Model +│ +claude\/haiku/);
  app.type('/exit');
  await app.closed;
  assert.ok(!existsSync(join(home, 'settings.json')));
});

test('/think sets the level, forgives a slip, remembers it, and starts a fresh session each time', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/think');
  await app.until(/thinking is off\. choose from: off, dyslexic, strong, extreme, explorer/);
  app.type('/think strong');
  await app.until(/thinking: strong\. fresh chat/);
  app.type('/think extrme');
  await app.until(/extrme → extreme\n[\s\S]*thinking: extreme\. fresh chat/);
  app.type('/think extreme');
  await app.until(/thinking is already extreme/);
  app.type('/think nope');
  await app.until(/no thinking level "nope"\. choose from: off, dyslexic, strong, extreme, explorer/);
  app.type('/think e');
  await app.until(/no thinking level "e"/);
  app.type('/think off');
  await app.until(/thinking: off\. fresh chat/);
  app.type('/exit');
  await app.closed;
  assert.equal(settings(home).thinking, 'off');
  const l = await launches(log, 4);
  assert.equal(l.length, 4, 'the start-up process, then one fresh session per change');
  assert.ok(l.every(x => !x.argv.includes('--resume')));
});

test('a saved thinking level is shown at the start and in /status', async () => {
  const { home, log } = setup();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ thinking: 'dyslexic' }));
  const app = run([], home, log);
  await app.until(/chat only: tools are off · thinking dyslexic/);
  app.type('/status');
  await app.until(/Thinking +│ +dyslexic/);
  app.type('hello');
  await app.until(/re-read clean/);
  app.type('/exit');
  await app.closed;
  const row = JSON.parse(readFileSync(join(home, 'chats.jsonl'), 'utf8').trim());
  assert.equal(row.thinking, 'dyslexic');
});

test('the thinking level is the "How to think" section of the system prompt claude is started with, and off takes it out', async () => {
  const { home, log } = setup();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ thinking: 'dyslexic' }));
  const app = run([], home, log);
  app.type('/think strong');
  await app.until(/thinking: strong\. fresh chat/);
  app.type('/think extreme');
  await app.until(/thinking: extreme\. fresh chat/);
  app.type('/think off');
  await app.until(/thinking: off\. fresh chat/);
  app.type('/exit');
  await app.closed;
  const system = launch => argAfter(launch, '--system-prompt');
  const l = await launches(log, 4);
  assert.equal(l.length, 4);
  // The saved level is in the very first chat. Each change starts a chat that has the new level and not the old one.
  for (const [i, level] of [[0, 'dyslexic'], [1, 'strong'], [2, 'extreme']]) {
    assert.ok(system(l[i]).includes(`## How to think\n${STYLES[level]}`), level);
    assert.equal(system(l[i]).split('## How to think').length - 1, 1, `${level} once`);
    for (const other of ['dyslexic', 'strong', 'extreme'].filter(n => n !== level)) assert.ok(!system(l[i]).includes(STYLES[other]), `${level} has no ${other}`);
    assert.ok(system(l[i]).indexOf('## How to think') < system(l[i]).indexOf('Before you answer'), 'thinking first, the skill after');
  }
  assert.doesNotMatch(system(l[3]), /How to think/);
});

test('explorer adds nothing to the system prompt, because it is a pipeline the app runs and not text', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/think explorer');
  await app.until(/thinking: explorer\. fresh chat/);
  app.type('a question');
  await app.until(/explored 3 ways/);
  app.type('/exit');
  await app.closed;
  const l = (await launches(log, 5)).filter(x => !isChat(x));
  assert.equal(l.length, 4);
  for (const launch of l) assert.doesNotMatch(argAfter(launch, '--system-prompt'), /How to think/);
});

test('explorer: three drafts and a weighing per message, the last turns ride along, and no chat process is started', async () => {
  const { home, log, prompts } = setup();
  const app = run([], home, log, { FAKE_PROMPTS: prompts });
  app.type('/think explorer');
  await app.until(/thinking: explorer\. fresh chat/);
  app.type('first question');
  await app.until(/combined 3 drafts[\s\S]*explored 3 ways/);
  app.type('second question');
  await app.until(/explored 3 ways[\s\S]*explored 3 ways/);
  app.type('/export');
  await app.until(/saved: .*exports/);
  app.type('/exit');
  await app.closed;
  const l = await launches(log, 9);
  assert.equal(l.filter(isChat).length, 1, 'only the process warmed before explorer was chosen');
  assert.equal(l.filter(x => !isChat(x)).length, 8, 'four one-shot calls for each of the two messages');
  assert.ok(l.filter(x => !isChat(x)).every(x => argAfter(x, '--tools') === '' && !x.argv.includes('--resume')), 'no tools, no session');
  const asked = promptsOf(prompts);
  const first = asked.filter(p => p.includes('first question') && !p.includes('Earlier in this chat'));
  const second = asked.filter(p => p.includes('second question'));
  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.ok(second.every(p => p.includes('Earlier in this chat:\nYou: first question\nClaude: combined 3 drafts') && p.includes('New message:\nsecond question')));
  const rows = readFileSync(join(home, 'chats.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x));
  assert.deepEqual(rows.map(r => [r.thinking, r.session]), [['explorer', undefined], ['explorer', undefined]]);
  const [exported] = readdirSync(join(home, 'exports'));
  assert.match(readFileSync(join(home, 'exports', exported), 'utf8'), /Thinking: explorer\.[\s\S]*> first question[\s\S]*combined 3 drafts[\s\S]*> second question/);
});

test('explorer ignores full access and says so, and /compact has nothing to do in it', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/tools');
  await app.until(/full access on\. fresh chat/);
  app.type('/think explorer');
  await app.until(/explorer works without tools, so it ignores full access/);
  app.type('/compact');
  await app.until(/explorer only sends the last few turns, so there is nothing to compact/);
  app.type('/exit');
  await app.closed;
});

test('/context starts with the system prompt alone, then draws the bar and the three parts from the measured reply', async () => {
  const { home, log } = setup();
  const app = run([], home, log, { FAKE_WINDOW: '1000000' });
  app.type('/context');
  await app.until(/no reply yet, so only the system prompt is counted\./);
  assert.match(app.out(), /of 200,000 tokens\. the system prompt is a guess: characters \/ 4\./);
  assert.match(app.out(), /Conversation +│ +0 +│/);
  app.type('hello');
  await app.until(/re-read clean/);
  app.type('/context');
  await app.until(/3,008 of 1,000,000 tokens/);
  const out = app.out();
  assert.match(out, /^ {2}[▒█░]{40} {2}0\.3% used$/m);
  const system = num(/System prompt, about +│ +~([\d,]+)/.exec(out.slice(out.lastIndexOf('Part')))[1]);
  const conversation = num(/█ Conversation +│ +([\d,]+)/.exec(out.slice(out.lastIndexOf('Part')))[1]);
  assert.ok(system > 500, 'the system prompt estimate is the real prompt, chars / 4');
  assert.equal(system + conversation, 3008, 'the two parts add up to what the reply measured');
  assert.match(out.slice(out.lastIndexOf('Part')), /░ Free +│ +996,992 +│/);
  app.type('/exit');
  await app.closed;
});

test('/context in full access says Claude\'s own tools count under Conversation', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/tools');
  await app.until(/full access on\. fresh chat/);
  app.type('/context');
  await app.until(/full access: Claude's own tools and prompt count under Conversation\./);
  app.type('/exit');
  await app.closed;
});

test('/status shows model, thinking, tools, context, session and voice', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/status');
  await app.until(/Voice +│ +off/);
  assert.match(app.out(), /Model +│ +default/);
  assert.match(app.out(), /Thinking +│ +off/);
  assert.match(app.out(), /Tools +│ +off/);
  assert.match(app.out(), /Context +│ +no reply yet/);
  assert.match(app.out(), /Session +│ +none yet/);
  app.type('hello');
  await app.until(/re-read clean/);
  app.type('/status');
  await app.until(/Context +│ +1\.5% of 200,000/);
  assert.match(app.out(), /Session +│ +sess-1/);
  app.type('/exit');
  await app.closed;
});

test('/compact summarizes in the chat, starts a fresh session from the summary, and shows tokens before and after', async () => {
  const { home, log, prompts } = setup();
  const app = run([], home, log, { FAKE_PROMPTS: prompts });
  app.type('nothing yet');
  await app.until(/re-read clean/);
  app.type('/new');
  await app.until(/fresh chat/);
  app.type('/compact');
  await app.until(/nothing to compact yet\. send a message first/);
  // Short paragraphs, so the reply passes the re-read check and nothing is rewritten.
  const long = Array(45).fill('Alpha beta gamma. Delta epsilon zeta.').join('\n\n');
  app.type(long);
  await app.until(/re-read clean[\s\S]*re-read clean/);
  app.type(long);
  await app.until(/(re-read clean[\s\S]*){3}/);
  app.type('/compact');
  await app.until(/After +│ +[\d,]+ +│/);
  const out = app.out();
  assert.match(out, /kept in the summary:[\s\S]*SUMMARY: 2 earlier messages/);
  const before = num(/Before +│ +([\d,]+)/.exec(out)[1]), after = num(/After +│ +([\d,]+)/.exec(out)[1]);
  assert.equal(after, 3 + 3000 + tokens(carryPrompt('SUMMARY: 2 earlier messages')) + tokens('ready'), 'the new session read the base and the summary');
  assert.ok(before > 3000 + 2 * tokens(long), `before ${before} holds both long turns`);
  assert.ok(after < before, `after ${after} is smaller than before ${before}`);
  app.type('and now?');
  await app.until(/echo: and now\?/);
  app.type('/exit');
  await app.closed;
  const l = await launches(log, 3);
  assert.deepEqual(l.map(x => x.argv.includes('--resume')), [false, false, false], 'every session is new: the start, /new, and the compacted one');
  const asked = promptsOf(prompts);
  const at = asked.findIndex(p => p.startsWith('Summarize this chat'));
  assert.ok(at > 0, 'the summary was asked of the running chat');
  assert.equal(asked[at + 1], carryPrompt('SUMMARY: 2 earlier messages'), 'the fresh session starts with the summary');
  assert.equal(asked[at + 2], 'and now?');
  const rows = readFileSync(join(home, 'chats.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 4, 'the summary turns are not logged as chats');
});

test('/clear starts a fresh chat just like /new, and forgets what the chat said', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('hello');
  await app.until(/re-read clean/);
  app.type('/clear');
  await app.until(/fresh chat/);
  app.type('/export');
  await app.until(/nothing to export yet/);
  app.type('/copy');
  await app.until(/nothing to copy yet/);
  app.type('/exit');
  await app.closed;
  const l = await launches(log, 2);
  assert.equal(l.length, 2);
  assert.ok(!l[1].argv.includes('--resume'));
});

test('/plan turns a goal into a checklist with time boxes, saves it, prints the path, and /plan alone shows it again', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/plan');
  await app.until(/no plan yet\. type \/plan and what you want to learn/);
  app.type('/plan learn chess openings');
  await app.until(/saved: .*\/plans\/\d{4}-\d{2}-\d{2}-learn-chess-openings\.md/);
  const out = app.out();
  assert.match(out, /▍ Study plan: learn chess openings/);
  for (const line of ['☐ 2 min First: Open a blank page', '☐ 10 min Skim the topic', '☐ 20 min Write the main ideas \\(1 of 2\\)', '☐ 20 min Write the main ideas \\(2 of 2\\)', '☐ 15 min Test yourself', 'About 67 minutes in 5 steps\\.'])
    assert.match(out, new RegExp(line));
  const [file] = readdirSync(join(home, 'plans'));
  assert.match(file, /^\d{4}-\d{2}-\d{2}-learn-chess-openings\.md$/);
  assert.match(readFileSync(join(home, 'plans', file), 'utf8'), /^# Study plan: learn chess openings\n\n- \[ \] \*\*2 min\*\* First: Open a blank page\n- \[ \] \*\*10 min\*\* Skim the topic\n/);
  app.type('/plan');
  await app.until(/(Study plan: learn chess openings[\s\S]*){2}saved: /);
  app.type('/plan learn chess openings');
  await app.until(/learn-chess-openings-2\.md/);
  assert.equal(readdirSync(join(home, 'plans')).length, 2, 'the same goal twice does not overwrite');
  app.type('/exit');
  await app.closed;
});

test('/plan keeps the case of the goal, and a plan that comes back broken is not saved', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/plan Learn Rust');
  await app.until(/Study plan: Learn Rust/);
  app.type('/plan BROKEN thing');
  await app.until(/the plan did not come back as JSON\. try \/plan again/);
  app.type('/exit');
  await app.closed;
  assert.deepEqual(readdirSync(join(home, 'plans')).map(f => f.replace(/^\d{4}-\d{2}-\d{2}-/, '')), ['learn-rust.md']);
});

test('/plan alone with no saved plan, and /plan last, make a plan from the last message', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('teach me fractions');
  await app.until(/re-read clean/);
  app.type('/plan');
  await app.until(/Study plan: teach me fractions/);
  app.type('another thing to ask');
  await app.until(/echo: another thing to ask/);
  app.type('/plan last');
  await app.until(/Study plan: another thing to ask/);
  app.type('/exit');
  await app.closed;
  assert.deepEqual(readdirSync(join(home, 'plans')).map(f => f.replace(/^\d{4}-\d{2}-\d{2}-/, '')).sort(), ['another-thing-to-ask.md', 'teach-me-fractions.md']);
});

test('/export saves the chat as markdown and prints the path', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/export');
  await app.until(/nothing to export yet/);
  app.type('hello there');
  await app.until(/re-read clean/);
  app.type('/export');
  await app.until(/saved: .*\/exports\/\d{4}-\d{2}-\d{2}-hello-there\.md/);
  app.type('/exit');
  await app.closed;
  const [file] = readdirSync(join(home, 'exports'));
  assert.match(readFileSync(join(home, 'exports', file), 'utf8'), /^# Chat, \d{4}-\d{2}-\d{2}\n\nModel: default\. Thinking: off\. Session: sess-1\.\n\n## You\n\n> hello there\n\n## Claude\n\necho: hello there\n/);
});

test('an old chat brought back with -c is part of the next export', async () => {
  const { home, log } = setup();
  const first = run([], home, log);
  first.type('remember this');
  await first.until(/re-read clean/);
  first.type('/exit');
  await first.closed;
  const again = run(['-c'], home, log);
  await again.until(/back in: remember this/);
  again.type('and this');
  await again.until(/echo: and this/);
  again.type('/export');
  await again.until(/saved: /);
  again.type('/exit');
  await again.closed;
  const [file] = readdirSync(join(home, 'exports'));
  assert.match(readFileSync(join(home, 'exports', file), 'utf8'), /> remember this[\s\S]*echo: remember this[\s\S]*> and this[\s\S]*echo: and this/);
});

test('/copy puts the last reply on the clipboard with pbcopy', async () => {
  const { dir, home, log } = setup();
  const clip = join(dir, 'clip');
  const app = run([], home, log, { DYSLEXIC_PBCOPY_BIN: FAKE_PBCOPY, FAKE_CLIP: clip });
  app.type('/copy');
  await app.until(/nothing to copy yet/);
  app.type('copy me');
  await app.until(/re-read clean/);
  app.type('/copy');
  await app.until(/copied the last reply \(3 words\)/);
  assert.equal(readFileSync(clip, 'utf8'), 'echo: copy me');
  app.type('/exit');
  await app.closed;
});

test('/copy says what is missing when there is no pbcopy', async () => {
  const { dir, home, log } = setup();
  const app = run([], home, log, { DYSLEXIC_PBCOPY_BIN: join(dir, 'no-such-pbcopy') });
  app.type('hi');
  await app.until(/re-read clean/);
  app.type('/copy');
  await app.until(/copy needs the macOS pbcopy command/);
  app.type('/exit');
  await app.closed;
});

test('/test still runs a round: two answers, Enter after each, a pick, and the round is saved', async () => {
  const { home, log } = setup();
  const app = run(['--model', 'haiku'], home, log);
  app.type('/test');
  await app.until(/reading test, round 1 of 10: How does a credit score work\?[\s\S]*answer 1 of 2/);
  app.type('');
  await app.until(/answer 2 of 2/);
  app.type('');
  await app.until(/which was easier to read\?/);
  app.type('s');
  await app.until(/saved round 1/);
  app.type('/exit');
  await app.closed;
  const [round] = readFileSync(join(home, 'tests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(round.pick, 'same');
  assert.equal(round.question, 'How does a credit score work?');
  const side = (await launches(log, 3)).filter(x => !isChat(x));
  assert.equal(side.length, 2, 'one plain call and one re-read call');
  assert.ok(side.every(x => argAfter(x, '--model') === 'haiku'), 'both sides use the chosen model');
});

test('the commands that stay still work: /new, /tools, /color, /calm, /pliny, /profile', async () => {
  const { home, log } = setup();
  const app = run([], home, log);
  app.type('/new');
  await app.until(/fresh chat/);
  app.type('/tools');
  await app.until(/full access on\. fresh chat/);
  app.type('/tools');
  await app.until(/tools off, chat only\. fresh chat/);
  app.type('/color');
  await app.until(/\x1b\[0m {2}(neon|fire|ocean|toxic|sunset|candy|aurora)\n/);
  app.type('/calm');
  await app.until(/motion (off|on)/);
  app.type('/pliny');
  await app.until(/pliny mode on: 7h3 0n3 7ru3 l33t/);
  app.type('/profile');
  await app.until(/no rules yet/);
  app.type('/exit');
  await app.closed;
});
