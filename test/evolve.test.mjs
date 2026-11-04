import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES } from '../lib/thinking.mjs';
import {
  FINAL_CONDS, HOLDOUT_SEED, MAX_EXCERPT, MAX_FAILURES, MAX_STYLE, OBJECTIVE, PROPOSER_OPENING, TRAIN_SEED,
  checkStyle, describe, evolve, excerpt, holdoutItems, parseOptions, parseVariants, pickFailures, pickWinner,
  plan, proposeVariants, proposerPrompt, trainItems,
} from '../bench/evolve.mjs';
import { compare, readRows } from '../bench/stats.mjs';
import { makeItems, seedFrom } from '../bench/tasks.mjs';

const EVOLVE = fileURLToPath(new URL('../bench/evolve.mjs', import.meta.url));
const quiet = () => {};

const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'evolve-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// A style that passes every check, with a tag so a test can tell versions apart.
const good = tag => [
  `Start with the big picture before any detail (${tag}).`,
  'Sketch it as a small drawing, grid or map and reason on the drawing.',
  'Look for the hidden pattern, or something from another field that works the same way.',
  'Explore several very different ways in, then narrow down: pick the best one and check it against the picture.',
].join('\n');
const variant = (tag, name = tag) => ({ name, text: good(tag), idea: `idea ${tag}` });

// ---- checkStyle ---------------------------------------------------------------------------------

test('checkStyle lets the dyslexic styles through and throws out everything else', () => {
  for (const name of ['dyslexic', 'strong']) assert.deepEqual(checkStyle(STYLES[name]), { ok: true, reasons: [] }, name);
  assert.deepEqual(checkStyle(good('x')), { ok: true, reasons: [] });
  // "extreme" never says to explore wide and then narrow, and nothing else is wrong with it.
  const extreme = checkStyle(STYLES.extreme);
  assert.equal(extreme.ok, false);
  assert.deepEqual(extreme.reasons, ['it is not dyslexic enough: nothing about exploring wide, narrowing down']);
  assert.deepEqual(checkStyle(STYLES.base), { ok: false, reasons: ['it is empty'] });
  const careful = checkStyle(STYLES.careful);
  assert.equal(careful.ok, false);
  assert.match(careful.reasons.join(), /not dyslexic enough: nothing about the whole picture first, pictures and spatial sketches, patterns and analogies, exploring wide, narrowing down/);
  for (const empty of ['', '   \n', null, undefined, 42]) assert.deepEqual(checkStyle(empty), { ok: false, reasons: ['it is empty'] }, String(empty));
});

test('checkStyle holds a style to under 1,200 characters', () => {
  const padded = n => good('x') + ` ${'z'.repeat(n - good('x').length - 1)}`;
  assert.equal(MAX_STYLE, 1200);
  assert.equal(padded(1199).length, 1199);
  assert.equal(checkStyle(padded(1199)).ok, true);
  for (const n of [1200, 1201, 3000]) {
    const c = checkStyle(padded(n));
    assert.equal(c.ok, false, String(n));
    assert.match(c.reasons[0], new RegExp(`${n} characters`));
  }
});

test('checkStyle refuses a style that names a kind of question, quotes an answer or copies a question', () => {
  for (const phrase of [
    'keep track of the dice', 'walk it step by step', 'which way is north', 'turn left then right', 'work out the percentage',
    'count the letters', 'a classic riddle', 'the wolf and the goat', 'list the next number', 'round down', 'a number sequence',
  ]) {
    const c = checkStyle(good(phrase));
    assert.equal(c.ok, false, phrase);
    assert.match(c.reasons.join(), /names a kind of question/, phrase);
  }
  // The words that make the style dyslexic are not task words.
  assert.equal(checkStyle(good('pattern, grid, map, picture, analogy, timeline, diagram')).ok, true);

  assert.match(checkStyle(good('ANSWER: 4')).reasons.join(), /answer line/);
  assert.equal(checkStyle(good('the answer is in the picture')).ok, true);

  const shown = { answers: ['top=3, north=2', '10', 'feathers'] };
  assert.match(checkStyle(good('top=3, north=2'), shown).reasons.join(), /contains a right answer/);
  assert.equal(checkStyle(good('10'), shown).ok, true, 'an answer of one or two characters is not a giveaway');

  const question = ['Here is a sentence about nothing in particular that goes on for a while'];
  assert.match(checkStyle(good('a sentence about nothing in particular that'), { questions: question }).reasons.join(), /copies a run of words/);
  assert.equal(checkStyle(good('a sentence about nothing at all'), { questions: question }).ok, true, 'five words in a row is fine');

  const twin = good('a').toUpperCase().replace(/\n/g, '   ');
  assert.match(checkStyle(good('a'), { others: [twin] }).reasons.join(), /same as another version/);
  assert.equal(checkStyle(good('b'), { others: [good('a')] }).ok, true);
});

// ---- the proposer's reply -----------------------------------------------------------------------

test('parseVariants reads the JSON with or without a fence or a sentence around it', () => {
  const want = [{ name: 'one', text: 'T1', idea: 'because' }, { name: 'two', text: 'T2', idea: '' }];
  const json = JSON.stringify({ variants: [{ name: 'one', text: 'T1', idea: 'because' }, { name: 'two', text: 'T2' }] });
  assert.deepEqual(parseVariants(json), want);
  assert.deepEqual(parseVariants(`Sure, here you go:\n\`\`\`json\n${json}\n\`\`\`\nHope that helps.`), want);
  assert.deepEqual(parseVariants(`I wrote two.\n${json}\nDone.`), want);
  assert.deepEqual(parseVariants(JSON.stringify(JSON.parse(json).variants)), want, 'a bare list');
  assert.deepEqual(parseVariants('{"variants":[{"text":"  padded  "},{"name":"no text"},{"text":7},null]}'), [{ name: 'unnamed', text: 'padded', idea: '' }]);
  for (const junk of ['', 'no json here', '{"variants": "none"}', '{"other": []}', '{broken', null, undefined]) assert.deepEqual(parseVariants(junk), [], String(junk));
});

test('parseVariants forgives real newlines inside a string, and leaves everything else alone', () => {
  // A style written over several lines, with the lines typed into the string as they are.
  const loose = '{"variants": [{"name": "Lines", "text": "first line\nsecond line\r\n\tthird, with a \\"quote\\" before\nthe end", "idea": "a\nb"}]}';
  assert.throws(() => JSON.parse(loose), 'plain JSON refuses it');
  assert.deepEqual(parseVariants(loose), [{ name: 'Lines', text: 'first line\nsecond line\n\tthird, with a "quote" before\nthe end', idea: 'a\nb' }]);
  assert.deepEqual(parseVariants(`Here:\n\`\`\`json\n${loose}\n\`\`\``)[0].text.split('\n').length, 4);
  // Newlines between the strings are still just layout, and escapes that were right stay right.
  const tidy = '{\n  "variants": [\n    {"name": "n", "text": "one\\ntwo\\\\n", "idea": ""}\n  ]\n}';
  assert.deepEqual(parseVariants(tidy), [{ name: 'n', text: 'one\ntwo\\n', idea: '' }]);
});

test('excerpt keeps the start and the end of a long reply inside the limit', () => {
  assert.equal(MAX_EXCERPT, 1200);
  assert.equal(excerpt('  short reply \n'), 'short reply');
  const long = `${'H'.repeat(3000)}${'T'.repeat(3000)}`;
  const cut = excerpt(long);
  assert.equal(cut.length, 1200);
  assert.ok(cut.startsWith('HHHH') && cut.endsWith('TTTT'));
  assert.match(cut, /\[\.\.\. middle left out \.\.\.\]/);
  assert.ok(cut.indexOf('T') > 0 && cut.lastIndexOf('H') < cut.length / 2 + 40, 'both ends are there');
  assert.equal(excerpt('x'.repeat(1200)).length, 1200);
  assert.equal(excerpt('x'.repeat(1201)).length, 1200);
  assert.equal(excerpt('x'.repeat(500), 100).length, 100);
});

const itemsTwo = makeItems({ seed: 7, perFamily: 2, families: OBJECTIVE });
const rowFor = (item, over = {}) => ({ id: item.id, family: item.family, correct: false, error: null, text: `reply to ${item.id}\nANSWER: nope`, ...over });

test('pickFailures shows wrong answers only, one family at a time, and never more than six', () => {
  assert.equal(MAX_FAILURES, 6);
  const rows = itemsTwo.map(i => rowFor(i));
  const picked = pickFailures(itemsTwo, rows);
  assert.equal(picked.length, 6);
  assert.deepEqual(picked.map(p => p.id), OBJECTIVE.map(f => itemsTwo.find(i => i.family === f).id), 'the first of each family before any second');
  const [first] = picked;
  assert.deepEqual(Object.keys(first), ['id', 'question', 'reply', 'answer']);
  assert.equal(first.question, itemsTwo[0].prompt);
  assert.equal(first.answer, itemsTwo[0].answer);
  assert.equal(first.reply, `reply to ${itemsTwo[0].id}\nANSWER: nope`);
  assert.deepEqual(pickFailures(itemsTwo, rows), picked, 'the same every time');
  assert.equal(pickFailures(itemsTwo, rows, 8).length, 8);
  assert.equal(pickFailures(itemsTwo, rows, 20).length, 12);

  // Right answers, failed calls and questions with no row teach the proposer nothing.
  const mixed = [rowFor(itemsTwo[0], { correct: true }), rowFor(itemsTwo[1], { error: 'boom', correct: null }), rowFor(itemsTwo[2])];
  assert.deepEqual(pickFailures(itemsTwo, mixed).map(p => p.id), [itemsTwo[2].id]);
  assert.deepEqual(pickFailures(itemsTwo, []), []);

  // Two failures in one family and one in another: A, B, then A again.
  const walks = itemsTwo.filter(i => i.family === 'walk'), dice = itemsTwo.find(i => i.family === 'dice');
  const lanes = pickFailures(itemsTwo, [rowFor(walks[0]), rowFor(walks[1]), rowFor(dice)]);
  assert.deepEqual(lanes.map(p => p.id), [walks[0].id, dice.id, walks[1].id]);

  const long = pickFailures(itemsTwo, [rowFor(itemsTwo[0], { text: 'x'.repeat(9000) })]);
  assert.equal(long[0].reply.length, MAX_EXCERPT);
});

test('the proposer prompt carries the style, the failures, the four parts and the rules', () => {
  const failures = pickFailures(itemsTwo, itemsTwo.slice(0, 3).map(i => rowFor(i)));
  const prompt = proposerPrompt({ best: STYLES.strong, failures, score: { k: 9, n: 24 }, count: 3 });
  assert.ok(prompt.startsWith(PROPOSER_OPENING));
  assert.ok(prompt.includes(`<style>\n${STYLES.strong}\n</style>`));
  assert.match(prompt, /got 9 of 24 questions right/);
  assert.match(prompt, /Here are 3 it got wrong/);
  failures.forEach((f, i) => {
    assert.ok(prompt.includes(`<failure ${i + 1}>\nQuestion:\n${f.question}\n\nReply:\n${f.reply}\n\nRight answer: ${f.answer}\n</failure ${i + 1}>`), `failure ${i + 1}`);
  });
  for (const part of ['whole picture first', 'pictures and spatial sketches', 'patterns and analogies', 'explore wide, then narrow']) assert.ok(prompt.includes(part), part);
  assert.match(prompt, /Write 3 new versions/);
  assert.match(prompt, /Under 1,200 characters/);
  assert.match(prompt, /differ from each other and from the current style in what they ask the model to do, not only in wording/);
  assert.match(prompt, /Do not mention any kind of question, any answer, or any checklist/);
  assert.match(prompt, /Reply with JSON only[\s\S]*\{"variants": \[\{"name"[\s\S]*"text"[\s\S]*"idea"/);
  assert.ok(!prompt.includes('thrown out'));

  // The instructions name no kind of question: only the failures do.
  const rules = prompt.replace(/<failure \d+>[\s\S]*?<\/failure \d+>/g, '');
  assert.equal(checkStyle(rules, {}).reasons.some(r => /names a kind of question/.test(r)), false);

  const one = proposerPrompt({ best: '', failures: failures.slice(0, 1), score: { k: 0, n: 6 }, count: 1 });
  assert.match(one, /Here is one it got wrong/);
  assert.match(one, /Write 1 new version of the style/);
  assert.ok(one.includes('<style>\n(none)\n</style>'));

  const clean = proposerPrompt({ best: STYLES.strong, failures: [], score: { k: 24, n: 24 }, count: 2 });
  assert.match(clean, /none wrong/);
  assert.ok(!clean.includes('<failure'));

  const retry = proposerPrompt({ best: STYLES.strong, failures, score: { k: 9, n: 24 }, count: 2, rejected: [{ name: 'Too long', reasons: ['it is 1500 characters', 'it names a kind of question ("dice")'] }] });
  assert.match(retry, /Your last try was thrown out/);
  assert.ok(retry.includes('- "Too long": it is 1500 characters; it names a kind of question ("dice")'));
});

function ask(replies) {
  const calls = [];
  const runText = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const reply = replies[calls.length - 1];
    return { text: typeof reply === 'string' ? reply : JSON.stringify({ variants: reply ?? [] }), ms: 1, outTokens: 1 };
  };
  return { calls, runText };
}
const shownFailures = pickFailures(itemsTwo, itemsTwo.slice(0, 2).map(i => rowFor(i)));
const propose = (f, over = {}) => proposeVariants({ proposer: 'claude:p', runText: f.runText, best: STYLES.strong, failures: shownFailures, score: { k: 1, n: 12 }, count: 3, ...over });

test('the proposer is asked again, with the reasons, until enough versions are valid', async () => {
  const tooLong = { name: 'Long', text: `${good('long')} ${'z'.repeat(1300)}`, idea: '' };
  const twin = { name: 'Twin', text: STYLES.strong, idea: '' };
  const f = ask([[variant('one'), tooLong, twin], [variant('two'), variant('three'), variant('four')]]);
  const { accepted, rejected } = await propose(f);
  assert.deepEqual(accepted.map(a => a.name), ['one', 'two', 'three'], 'stops at three, the fourth is never read');
  assert.deepEqual(rejected.map(r => r.name), ['Long', 'Twin']);
  assert.match(rejected[0].reasons.join(), /1[0-9]{3} characters/);
  assert.match(rejected[1].reasons.join(), /same as another version/);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.model === 'claude:p'));
  assert.match(f.calls[0].prompt, /Write 3 new versions/);
  assert.match(f.calls[1].prompt, /Write 2 new versions/, 'only the missing ones are asked for');
  assert.match(f.calls[1].prompt, /"Long": it is 1[0-9]{3} characters/);
  assert.match(f.calls[1].prompt, /"Twin": it is the same as another version/);
});

test('the proposer is asked once when the first answer is enough, and twice at most', async () => {
  const enough = ask([[variant('a'), variant('b'), variant('c')]]);
  assert.equal((await propose(enough)).accepted.length, 3);
  assert.equal(enough.calls.length, 1);

  // The same wording twice in one answer counts once.
  const dupes = ask([[variant('a'), variant('a', 'again')], [variant('a')]]);
  const res = await propose(dupes, { count: 2 });
  assert.deepEqual(res.accepted.map(a => a.name), ['a']);
  assert.equal(dupes.calls.length, 2);

  const prose = ask(['I could not decide, sorry.', JSON.stringify({ variants: [variant('late')] })]);
  const late = await propose(prose, { count: 1 });
  assert.equal(late.accepted[0].name, 'late');
  assert.match(prose.calls[1].prompt, /"reply": it was not JSON in the shape asked for/);

  const hopeless = ask(['nope', 'still nope', 'never asked']);
  const none = await propose(hopeless);
  assert.deepEqual(none.accepted, []);
  assert.equal(hopeless.calls.length, 2);
});

test('versions that copy a shown question or answer are thrown out', async () => {
  const [item] = shownFailures;
  const quote = item.question.split(/\s+/).slice(0, 8).join(' ');
  const f = ask([[
    { name: 'Quotes', text: good(quote), idea: '' },
    { name: 'Leaks', text: good(`it is ${item.answer} here`), idea: '' },
    variant('fine'),
  ]]);
  const { accepted, rejected } = await propose(f, { count: 3, tries: 1 });
  assert.deepEqual(accepted.map(a => a.name), ['fine']);
  assert.deepEqual(rejected.map(r => r.name), ['Quotes', 'Leaks']);
  assert.match(rejected[1].reasons.join(), /right answer|names a kind of question/);
});

// ---- items, plan, winner ------------------------------------------------------------------------

test('each round has its own seed, the final check has another, and the loop never touches uses', () => {
  assert.equal(TRAIN_SEED, 1000);
  assert.equal(HOLDOUT_SEED, 9000);
  assert.deepEqual(OBJECTIVE, ['walk', 'dice', 'pattern', 'arith', 'letters', 'trick']);
  for (const round of [0, 1, 2, 5]) {
    const items = trainItems({ round, train: 3 });
    assert.deepEqual(items, makeItems({ seed: 1000 + round, perFamily: 3, families: OBJECTIVE }));
    assert.equal(items.length, 18);
    assert.ok(items.every(i => i.family !== 'uses'));
  }
  const a = trainItems({ round: 0, train: 3 }).filter(i => i.family !== 'trick'), b = trainItems({ round: 1, train: 3 }).filter(i => i.family !== 'trick');
  assert.equal(new Set([...a, ...b].map(i => i.id)).size, 30, 'every seeded question is new each round');
  assert.ok(a.every(x => !b.some(y => y.prompt === x.prompt)));
  assert.match(trainItems({ round: 2, train: 1, scale: 3 })[0].id, /^walk-1002x3-0$/);
});

test('the final check holds no question the loop used, even the riddles that ignore the seed', () => {
  const settings = { rounds: 4, train: 4, holdout: 8 };
  const { items, dropped } = holdoutItems(settings);
  const used = new Set(Array.from({ length: 5 }, (_, round) => trainItems({ round, train: 4 })).flat().map(i => i.id));
  assert.ok(items.every(i => !used.has(i.id)));
  assert.deepEqual(dropped, ['trick-1', 'trick-2', 'trick-3', 'trick-4']);
  assert.deepEqual(items.filter(i => i.family === 'trick').map(i => i.id), ['trick-5', 'trick-6', 'trick-7', 'trick-8']);
  assert.equal(items.length, 5 * 8 + 4);
  assert.ok(items.filter(i => i.family !== 'trick').every(i => i.id.includes('-9000-')));
  assert.deepEqual(holdoutItems({ ...settings, rounds: 1 }).items, items, 'it does not depend on how many rounds ran');

  const small = holdoutItems({ rounds: 1, train: 1, holdout: 1 });
  assert.equal(small.items.length, 5);
  assert.deepEqual(small.dropped, ['trick-1']);
  const none = holdoutItems({ rounds: 1, train: 8, holdout: 8 });
  assert.equal(none.items.filter(i => i.family === 'trick').length, 0);
  assert.equal(holdoutItems({ rounds: 1, train: 1, holdout: 1, scale: 2 }).items[0].id, 'walk-9000x2-0');
});

test('plan counts the most calls a run can make', () => {
  assert.deepEqual(plan({ rounds: 4, variants: 3, train: 4, holdout: 8 }), {
    questions: 24, loop: 24 + 4 * 4 * 24, proposer: 8, final: 5 * 44, finalQuestions: 44, dropped: ['trick-1', 'trick-2', 'trick-3', 'trick-4'], total: 408 + 8 + 220,
  });
  const pilot = plan({ rounds: 1, variants: 2, train: 1, holdout: 1 });
  assert.equal(pilot.loop, 6 + 3 * 6);
  assert.equal(pilot.final, 25);
  assert.equal(pilot.total, 24 + 2 + 25);
  assert.equal(plan({ rounds: 4, variants: 3, train: 4, holdout: 8, scale: 3 }).total, 636, 'scale changes the length of a question, not how many');
});

test('pickWinner takes the most right, then the shorter text, then the earlier one', () => {
  const c = (name, k, chars) => ({ name, k, chars });
  assert.equal(pickWinner([c('best', 5, 900), c('a', 6, 1100), c('b', 4, 100)]).name, 'a');
  assert.equal(pickWinner([c('best', 5, 900), c('a', 5, 800), c('b', 5, 850)]).name, 'a', 'a tie goes to the shorter');
  assert.equal(pickWinner([c('best', 5, 900), c('a', 5, 900), c('b', 5, 900)]).name, 'best', 'equal length keeps the best so far');
  assert.equal(pickWinner([c('best', 5, 900), c('a', 5, 950)]).name, 'best');
  assert.equal(pickWinner([c('best', 5, 900), c('a', 6, 1190), c('b', 6, 1000)]).name, 'b');
});

// ---- the loop, against a model that is only as good as the tag in its style ---------------------------

const EVERY = new Map();
for (const seed of [1000, 1001, 1002, 1003, 1004, 1005, 1006, 9000]) {
  for (const scale of [1, 2]) for (const item of makeItems({ seed, perFamily: 8, families: OBJECTIVE, scale })) EVERY.set(item.id, item);
}
const itemIn = prompt => [...EVERY.values()].find(i => prompt.includes(i.prompt));
const styleIn = prompt => (prompt.startsWith('How to think:\n') ? prompt.slice('How to think:\n'.length, prompt.indexOf('\n\nQuestion:\n')) : '');

// How often each style is right: alpha always, bravo half the time, anything else a quarter, except the
// careful and dyslexic styles, which are better. The length is in the hash so no two styles are right on
// the same questions, and a sign test against the wrong style shows.
const chance = style => (style.includes('alpha') ? 1 : style.includes('bravo') ? 0.5 : style === STYLES.careful ? 0.5 : style === STYLES.dyslexic ? 0.75 : 0.25);
const byTag = (style, item) => (seedFrom(`${item.id}|${style.length}`) % 100) / 100 < chance(style);

// A stand-in for the target model and the proposer at once, told apart the way the real run has to
// tell them apart: by what the prompt says, because both may be the same model.
function world({ skill = byTag, proposals = [], broken = () => null } = {}) {
  const log = { answers: [], proposals: [] };
  const runText = async ({ model, prompt }) => {
    if (prompt.startsWith(PROPOSER_OPENING)) {
      log.proposals.push({ model, prompt });
      const reply = proposals[log.proposals.length - 1] ?? [];
      return { text: typeof reply === 'string' ? reply : JSON.stringify({ variants: reply }), ms: 1, outTokens: 1 };
    }
    const item = itemIn(prompt), style = styleIn(prompt);
    const err = broken(item, style);
    log.answers.push({ model, id: item.id, style, ok: !err });
    if (err) throw err;
    return { text: `thinking about it\nANSWER: ${skill(style, item) ? item.answer : 'nope'}`, ms: 1, outTokens: 5, modelId: 'fake-model-1' };
  };
  return { log, runners: { runText, runImage: runText } };
}
const BASE = { model: 'claude:target', proposer: 'claude:proposer', start: 'strong', train: 2, holdout: 3, log: quiet };
const idsOf = (rows, cond) => rows.filter(r => r.cond === cond).map(r => r.id).sort();

test('the loop keeps the best version, scores every version on the same fresh questions, and stops after two rounds with no gain', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  const w = world({ proposals: [
    [variant('alpha'), variant('bravo')],
    [variant('alpha2'), variant('al')],
    [variant('alpha3'), variant('alpha4')],
    [variant('never asked')],
  ] });
  const res = await evolve({ ...BASE, rounds: 6, variants: 2, out, runners: w.runners });

  assert.equal(res.stopped, 'no gain in 2 rounds in a row');
  assert.deepEqual(res.rounds.map(r => r.round), [0, 1, 2, 3]);
  assert.deepEqual(res.rounds.map(r => r.seed), [1000, 1001, 1002, 1003]);
  assert.equal(w.log.proposals.length, 3, 'rounds 1, 2 and 3 asked; there was no round 4');
  assert.deepEqual(res.rounds.map(r => r.gain), [null, true, false, false]);

  const [r0, r1, r2, r3] = res.rounds;
  assert.deepEqual(r0.candidates.map(c => c.role), ['start']);
  assert.deepEqual(r1.candidates.map(c => c.role), ['best', 'variant', 'variant']);
  assert.deepEqual(r1.candidates.map(c => c.name), ['strong', 'alpha', 'bravo']);
  assert.equal(r1.candidates[1].k, r1.candidates[1].n, 'alpha is always right');
  assert.ok(r1.candidates[0].k < r1.candidates[0].n);
  assert.equal(res.styles[r1.winner].text, good('alpha'));
  assert.equal(res.styles[r2.winner].text, good('alpha'), 'alpha2 ties on right answers but is longer');
  assert.equal(r2.candidates[1].k, r2.candidates[0].k);
  assert.equal(res.styles[res.best].text, good('alpha'));
  assert.equal(res.stale, 2);

  // Every style in a round was asked exactly the questions that round drew, and rounds do not share seeded ones.
  const rows = readRows(out);
  for (const round of res.rounds) {
    const want = trainItems({ round: round.round, train: 2 }).map(i => i.id).sort();
    assert.equal(round.questions, want.length);
    for (const c of round.candidates) assert.deepEqual(idsOf(rows, c.cond), want, `${c.cond} in round ${round.round}`);
    assert.ok(round.candidates.every(c => c.cond.startsWith(`r${round.round}-`)));
  }
  const loopIds = rows.filter(r => /^r\d/.test(r.cond)).map(r => r.id);
  const seeded = (round) => new Set(loopIds.filter(id => id.includes(`-${1000 + round}-`)));
  assert.equal(seeded(1).size, 10);
  assert.ok([...seeded(1)].every(id => !seeded(2).has(id) && !seeded(3).has(id)));

  // What the proposer was shown: the best style's own wrong answers, and nothing the best got right.
  const [p1, p2] = w.log.proposals.map(p => p.prompt);
  const start = rows.filter(r => r.cond === r0.candidates[0].cond);
  const shown = start.filter(r => p1.includes(EVERY.get(r.id).prompt));
  assert.ok(shown.length >= 1 && shown.length <= 6);
  assert.ok(shown.every(r => r.correct === false));
  assert.ok(start.filter(r => r.correct).every(r => !p1.includes(EVERY.get(r.id).prompt)));
  assert.ok(p1.includes('ANSWER: nope'), 'it saw the reply too');
  assert.ok(p1.includes(`got ${r0.candidates[0].k} of ${r0.candidates[0].n} questions right`));
  assert.ok(p1.includes(`<style>\n${STYLES.strong}\n</style>`));
  assert.ok(p2.includes(`<style>\n${good('alpha')}\n</style>`), 'the next round starts from the winner');
  assert.match(p2, /none wrong/, 'alpha got everything right, so there is nothing to show');

  // The final check: five styles, one set of questions, none of them from the loop.
  const finalRows = rows.filter(r => !/^r\d/.test(r.cond));
  const finalIds = idsOf(finalRows, 'evolved');
  assert.deepEqual([...new Set(finalRows.map(r => r.cond))].sort(), [...FINAL_CONDS].sort());
  for (const cond of FINAL_CONDS) assert.deepEqual(idsOf(finalRows, cond), finalIds, cond);
  assert.deepEqual(finalIds, holdoutItems({ rounds: 6, train: 2, holdout: 3 }).items.map(i => i.id).sort());
  assert.equal(finalIds.filter(id => loopIds.includes(id)).length, 0);
  assert.deepEqual(res.final.dropped, ['trick-1', 'trick-2']);

  // The files hold what the table says.
  const styleFile = readFileSync(join(out, '..', 'evolved-style.txt'), 'utf8');
  assert.equal(styleFile, `${good('alpha')}\n`);
  const saved = JSON.parse(readFileSync(join(out, '..', 'evolve-summary.json'), 'utf8'));
  assert.equal(saved.complete, true);
  assert.deepEqual(saved.final, res.final);
  assert.deepEqual(saved.rounds, res.rounds);
  assert.equal(saved.settings.model, 'claude:target');
  assert.equal(saved.settings.proposer, 'claude:proposer');
  assert.deepEqual(saved.modelIds, ['fake-model-1']);
  assert.deepEqual(res.paths, { rows: out, summary: join(out, '..', 'evolve-summary.json'), style: join(out, '..', 'evolved-style.txt') });

  const evolved = res.final.table.find(r => r.cond === 'evolved');
  for (const row of res.final.table) {
    const mine = finalRows.filter(r => r.cond === row.cond);
    assert.equal(row.k, mine.filter(r => r.correct).length, row.cond);
    assert.equal(row.n, finalIds.length);
    assert.equal(row.errors, 0);
    assert.equal(row.chars, { base: 0, careful: STYLES.careful.length, dyslexic: STYLES.dyslexic.length, start: STYLES.strong.length, evolved: good('alpha').length }[row.cond]);
    assert.ok(row.lo <= row.rate && row.rate <= row.hi);
    assert.equal(Object.values(row.byFamily).reduce((s, f) => s + f.k, 0), row.k);
    assert.equal(Object.values(row.byFamily).reduce((s, f) => s + f.n, 0), row.n);
  }
  assert.equal(evolved.k, evolved.n);
  assert.deepEqual(Object.keys(res.final.tests), ['base', 'careful', 'start', 'dyslexic']);
  for (const [other, test] of Object.entries(res.final.tests)) {
    const want = compare(finalRows, 'evolved', other);
    assert.deepEqual({ n: test.n, both: test.both, neither: test.neither, aOnly: test.aOnly, bOnly: test.bOnly, p: test.p }, { n: want.n, both: want.both, neither: want.neither, aOnly: want.aOnly, bOnly: want.bOnly, p: want.p }, other);
    assert.equal(test.bOnly, 0, `nothing the ${other} style got right that alpha missed`);
  }
  assert.equal(res.final.tests.base.verdict, 'clearly better');
  assert.equal(res.final.tests.careful.verdict, 'clearly better');
  assert.ok(res.final.tests.dyslexic.aOnly < res.final.tests.careful.aOnly && res.final.tests.careful.aOnly < res.final.tests.base.aOnly);
  assert.equal(saved.pending, null);
  assert.equal(res.pending, null);
  assert.equal(res.final.evolvedIsStart, false);
  assert.ok(!describe(res).includes('same text run twice'));

  // The calls went to the right models.
  assert.ok(w.log.answers.every(a => a.model === 'claude:target'));
  assert.ok(w.log.proposals.every(p => p.model === 'claude:proposer'));

  const text = describe(res);
  for (const word of ['final check', 'evolved against', 'base', 'careful', 'dyslexic', 'start', 'evolved', 'stopped: no gain', 'cut: trick-1 trick-2']) assert.ok(text.includes(word), word);
  assert.ok(!/undefined|NaN|null/.test(text), text);
  assert.ok(text.split('\n').every(l => l.length < 100));
});

test('a tie on right answers goes to the shorter style and does not count as a gain', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  const w = world({
    skill: () => true,
    proposals: [[variant('short'), variant(`longer-${'x'.repeat(100)}`)], [variant('y'.repeat(300)), variant('z'.repeat(310))]],
  });
  const res = await evolve({ ...BASE, rounds: 4, variants: 2, out, runners: w.runners });
  const [, r1, r2] = res.rounds;
  assert.ok(r1.candidates.every(c => c.k === c.n), 'a model that is always right ties every style');
  assert.ok(good('short').length < good(`longer-${'x'.repeat(100)}`).length && good('short').length < STYLES.strong.length);
  assert.equal(res.styles[r1.winner].text, good('short'), 'the shortest of three ties');
  assert.equal(r1.gain, false, 'the same score is not a gain');
  assert.equal(res.rounds[0].winner === r1.winner, false, 'but the best did move to the shorter text');
  assert.equal(res.styles[r2.winner].text, good('short'), 'a longer text that ties does not take the place');
  assert.equal(r2.gain, false);
  assert.equal(res.stopped, 'no gain in 2 rounds in a row');
  assert.equal(w.log.proposals.length, 2);
});

test('when no version ever wins, evolved is the start style asked again, and the report says so', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  const w = world({ proposals: ['no json', 'no json either', 'still none', 'nothing at all'] });
  const res = await evolve({ ...BASE, rounds: 5, variants: 2, out, runners: w.runners });
  assert.deepEqual(res.rounds.map(r => r.gain), [null, false, false]);
  assert.equal(res.stopped, 'no gain in 2 rounds in a row', 'two empty rounds in a row end it');
  assert.equal(w.log.proposals.length, 4, 'two tries a round');
  assert.equal(res.best, res.rounds[0].winner);
  assert.equal(res.final.evolvedIsStart, true);
  const start = res.final.table.find(r => r.cond === 'start'), evolved = res.final.table.find(r => r.cond === 'evolved');
  assert.equal(start.chars, evolved.chars);
  assert.equal(readRows(out).filter(r => r.cond === 'evolved').length, res.final.questions, 'it is still scored, as a replicate');
  assert.match(describe(res), /"evolved" and "start" are the same text run twice/);
  assert.equal(readFileSync(join(out, '..', 'evolved-style.txt'), 'utf8'), `${STYLES.strong}\n`);
});

test('a round where nothing valid comes back scores nothing, counts as no gain, and the next one carries on', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  const dice = { name: 'About dice', text: good('keep track of the dice'), idea: '' };
  const w = world({ proposals: [[dice, { name: 'Empty', text: '', idea: '' }], 'sorry, no JSON today', [variant('alpha'), variant('bravo')]] });
  const res = await evolve({ ...BASE, rounds: 2, variants: 2, out, runners: w.runners });
  const [, r1, r2] = res.rounds;
  assert.equal(w.log.proposals.length, 3, 'two tries for round 1, one for round 2');
  assert.deepEqual(r1.candidates, []);
  assert.equal(r1.gain, false);
  assert.equal(r1.winner, res.rounds[0].winner, 'the best is unchanged');
  assert.deepEqual(r1.proposed.map(p => p.accepted), [false, false]);
  assert.match(r1.proposed[0].reasons.join(), /names a kind of question/);
  assert.match(w.log.proposals[1].prompt, /"About dice": it names a kind of question/);
  assert.equal(readRows(out).filter(r => r.cond.startsWith('r1-')).length, 0, 'no calls were spent on a round with nothing to compare');
  assert.equal(res.styles[r2.winner].text, good('alpha'));
  assert.equal(r2.gain, true);
  assert.equal(res.stale, 0);
  assert.equal(res.stopped, 'all rounds done');
  // Round 2 shows the failures the start style made in round 0, the last time it was scored.
  assert.ok(w.log.proposals[2].prompt.includes('<failure 1>'));
  assert.ok(describe(res).includes('nothing to score'));
});

test('a failed call counts as a miss, and a run that loses more than a tenth of its calls stops', async t => {
  const dir = tmp(t), out = join(dir, 'evolve.jsonl');
  const first = trainItems({ round: 1, train: 2 }).find(i => i.family === 'dice').id;
  const held = holdoutItems({ rounds: 1, train: 2, holdout: 3 }).items[0].id;
  const w = world({
    proposals: [[variant('alpha'), variant('bravo')]],
    broken: (item, style) => ((style.includes('alpha') && item.id === first) || (style === '' && item.id === held) ? new Error('one call timed out') : null),
  });
  const lines = [];
  const res = await evolve({ ...BASE, rounds: 1, variants: 2, out, runners: w.runners, log: line => lines.push(line) });
  const alpha = res.rounds[1].candidates.find(c => c.name === 'alpha');
  assert.equal(alpha.errors, 1);
  assert.equal(alpha.k, alpha.n - 1, 'the call that failed is a miss, not a skipped question');
  assert.equal(alpha.n, 12);
  assert.equal(res.rounds[1].candidates.find(c => c.name === 'bravo').errors, 0);
  assert.equal(w.log.answers.filter(a => !a.ok && a.style.includes('alpha')).length, 2, 'tried twice, then counted');

  // In the final check too: the base style lost a call, and the pair still counts, as a miss.
  const base = res.final.table.find(r => r.cond === 'base');
  assert.equal(base.errors, 1);
  assert.equal(base.k, readRows(out).filter(r => r.cond === 'base' && r.correct).length);
  assert.equal(res.final.tests.base.n, res.final.questions, 'no pair is dropped for a failed call');
  assert.equal(res.final.tests.careful.n, res.final.questions);
  assert.equal(res.final.table.find(r => r.cond === 'evolved').errors, 0);
  assert.equal(lines.filter(l => /\b1 failed$/.test(l)).length, 1, 'the log says which style lost a call');
  assert.ok(lines.find(l => /\b1 failed$/.test(l)).includes(alpha.cond));
  assert.ok(lines.includes('  kept "alpha": idea alpha'), 'the log says what each kept version is trying');

  const dead = tmp(t), outDead = join(dead, 'evolve.jsonl');
  const down = world({ proposals: [[variant('alpha'), variant('bravo')]], broken: (item, style) => (style.includes('alpha') ? new Error('network down') : null) });
  await assert.rejects(
    evolve({ ...BASE, rounds: 1, variants: 2, out: outDead, runners: down.runners }),
    /12 of 36 calls failed \(first error: network down\)\. The rows so far are saved/,
  );

  // Out of quota: runBench gives up after three and marks the rest "skipped". The message names the cause.
  const quota = Object.assign(new Error('Claude AI usage limit reached'), { fatal: true });
  const out3 = join(tmp(t), 'evolve.jsonl');
  const limited = world({ broken: () => quota });
  await assert.rejects(
    evolve({ ...BASE, rounds: 1, variants: 2, out: out3, runners: limited.runners }),
    /12 of 12 calls failed \(first error: Claude AI usage limit reached\)/,
  );
  assert.ok(readRows(out3).some(r => r.error.startsWith('skipped')), 'the skipped rows are there, and not what the message quotes');
});

test('a run that dies carries on where it stopped: same versions, no call made twice', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  let down = true;
  const w = world({
    proposals: [[variant('alpha'), variant('bravo')], [variant('alpha2'), variant('al')]],
    broken: (item, style) => (down && style.includes('alpha') ? new Error('network down') : null),
  });
  const args = { ...BASE, rounds: 2, variants: 2, out, runners: w.runners };
  await assert.rejects(evolve(args), /calls failed/);

  const saved = JSON.parse(readFileSync(join(out, '..', 'evolve-summary.json'), 'utf8'));
  assert.equal(saved.complete, false);
  assert.deepEqual(saved.rounds.map(r => r.round), [0]);
  assert.equal(saved.pending.round, 1);
  assert.deepEqual(saved.pending.accepted.map(a => a.name), ['alpha', 'bravo']);
  assert.equal(w.log.proposals.length, 1);

  // Another setting is another run: refuse, rather than mix two runs' rows.
  await assert.rejects(evolve({ ...args, variants: 3 }), /other settings/);
  await assert.rejects(evolve({ ...args, holdout: 4 }), /other settings/);

  down = false;
  const res = await evolve(args);
  assert.equal(res.complete, true);
  assert.equal(w.log.proposals.length, 2, 'round 1 was not asked again; round 2 was asked once');
  assert.deepEqual(res.rounds.map(r => r.round), [0, 1, 2]);
  assert.deepEqual(res.rounds[1].proposed.map(p => p.name), ['alpha', 'bravo']);
  assert.equal(res.styles[res.best].text, good('alpha'));
  assert.equal(readRows(out).filter(r => r.error).length, 0, 'the failed calls were tried again');

  const kept = w.log.answers.filter(a => a.ok && !a.id.startsWith('trick')).map(a => `${a.style}|${a.id}`);
  assert.equal(new Set(kept).size, kept.length, 'no question was answered twice by the same style');

  // A finished run, started again, does nothing new and says the same thing.
  const calls = [w.log.answers.length, w.log.proposals.length];
  const again = await evolve(args);
  assert.deepEqual([w.log.answers.length, w.log.proposals.length], calls);
  assert.deepEqual(again.final.table, res.final.table);
  assert.deepEqual(again.final.tests, res.final.tests);
});

test('the proposer and the target can be the same model, and a bigger scale reaches every question set', async t => {
  const out = join(tmp(t), 'evolve.jsonl');
  const w = world({ proposals: [[variant('alpha')]] });
  const res = await evolve({ ...BASE, model: 'claude:both', proposer: undefined, rounds: 1, variants: 1, train: 1, holdout: 1, scale: 2, out, runners: w.runners });
  assert.equal(res.settings.proposer, 'claude:both');
  assert.ok(w.log.answers.every(a => a.model === 'claude:both') && w.log.proposals.every(p => p.model === 'claude:both'));
  assert.equal(w.log.proposals.length, 1);
  const rows = readRows(out);
  assert.ok(rows.some(r => r.id === 'walk-1000x2-0') && rows.some(r => r.id === 'walk-1001x2-0') && rows.some(r => r.id === 'walk-9000x2-0'));
  assert.ok(rows.every(r => !/^walk-\d+-/.test(r.id)), 'nothing at the standard size');
  assert.equal(res.settings.scale, 2);
});

test('the start style can be a text file, and the summary records which', async t => {
  const dir = tmp(t), out = join(dir, 'run', 'evolve.jsonl');
  writeFileSync(join(dir, 'mine.txt'), `${good('mine')}\n`);
  const w = world({ proposals: [[variant('alpha')]] });
  const res = await evolve({ ...BASE, start: join(dir, 'mine.txt'), rounds: 1, variants: 1, out, runners: w.runners });
  assert.equal(res.styles[res.rounds[0].winner].text, good('mine'));
  assert.equal(res.final.table.find(r => r.cond === 'start').chars, good('mine').length);
  assert.ok(existsSync(join(dir, 'run', 'evolved-style.txt')), 'the output folder is made');
  await assert.rejects(evolve({ ...BASE, start: 'nope', rounds: 1, variants: 1, out, runners: w.runners }), /--start must be one of/);
});

// ---- the command line ---------------------------------------------------------------------------

test('parseOptions fills in the brief\'s numbers and refuses nonsense', () => {
  const o = parseOptions([]);
  assert.deepEqual({ ...o, conc: undefined }, {
    model: 'claude:haiku', proposer: 'claude:haiku', start: 'strong', rounds: 4, variants: 3, train: 4, holdout: 8, scale: 1,
    out: 'bench/results/evolve.jsonl', conc: undefined, timeoutMs: undefined, dry: false,
  });
  assert.deepEqual(o.conc, { claude: 6, opencode: 6, grok: 3 });
  const full = parseOptions('--model claude:opus --proposer claude:sonnet --rounds 2 --variants 5 --train 3 --holdout 7 --start dyslexic --out x/e.jsonl --scale 3 --conc claude=2 --timeout 90 --dry'.split(' '));
  assert.deepEqual({ ...full, conc: full.conc.claude }, {
    model: 'claude:opus', proposer: 'claude:sonnet', start: 'dyslexic', rounds: 2, variants: 5, train: 3, holdout: 7, scale: 3,
    out: 'x/e.jsonl', conc: 2, timeoutMs: 90000, dry: true,
  });
  assert.equal(parseOptions(['--model', 'claude:opus']).proposer, 'claude:opus', 'the proposer defaults to the model');
  for (const bad of [['--rounds', '0'], ['--rounds', '1.5'], ['--variants', 'x'], ['--train=-2'], ['--holdout', ''], ['--scale', '0']]) {
    assert.throws(() => parseOptions(bad), /must be a whole number of at least 1/, bad.join(' '));
  }
  assert.throws(() => parseOptions(['--model', 'gemini']), /unknown model/);
  assert.throws(() => parseOptions(['--proposer', 'haiku']), /unknown model/);
  assert.throws(() => parseOptions(['--start', 'nope']), /--start must be one of/);
  assert.throws(() => parseOptions(['--conc', 'gemini=2']), /bad --conc/);
  assert.throws(() => parseOptions(['--nope']), /Unknown option/);
  assert.throws(() => parseOptions(['--train', '-2']), /ambiguous/);
});

// A stand-in for the claude CLI, so the whole command runs through the real runners and files.
function fakeClaude(dir) {
  const path = join(dir, 'claude');
  writeFileSync(path, `#!${process.execPath}
const { readFileSync, appendFileSync } = require('node:fs');
const stdin = readFileSync(0, 'utf8');
appendFileSync(process.env.FAKE_LOG, stdin.startsWith(${JSON.stringify(PROPOSER_OPENING)}) ? 'P' : 'A');
const result = stdin.startsWith(${JSON.stringify(PROPOSER_OPENING)}) ? process.env.FAKE_VARIANTS : 'thinking\\nANSWER: 1';
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, usage: { output_tokens: 3 }, modelUsage: { 'fake-claude-1': {} } }));
`);
  chmodSync(path, 0o755);
  return path;
}

test('the command runs the whole loop through the real runners and prints a table', t => {
  const dir = tmp(t), out = join(dir, 'out', 'evolve.jsonl'), log = join(dir, 'calls');
  writeFileSync(log, '');
  const env = { ...process.env, DYSLEXIC_CLAUDE_BIN: fakeClaude(dir), FAKE_LOG: log, FAKE_VARIANTS: JSON.stringify({ variants: [variant('one'), variant('two')] }) };
  const args = ['--model', 'claude:fake', '--proposer', 'claude:fake', '--rounds', '1', '--variants', '2', '--train', '1', '--holdout', '1', '--out', out, '--conc', 'claude=3'];
  const run = spawnSync(process.execPath, [EVOLVE, ...args], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  const p = plan({ rounds: 1, variants: 2, train: 1, holdout: 1 });
  const calls = readFileSync(log, 'utf8');
  assert.equal(calls.split('').filter(c => c === 'P').length, 1);
  assert.equal(calls.split('').filter(c => c === 'A').length, p.loop + p.final, 'six, then three styles on six questions, then five on five');
  assert.equal(readRows(out).length, p.loop + p.final);
  for (const word of ['round  seed', 'final check: seed 9000, 5 questions', 'evolved against', 'stopped: all rounds done', 'the evolved style:\n']) assert.ok(run.stdout.includes(word), `${word}\n${run.stdout}`);
  assert.match(run.stderr, /summary .*evolve-summary\.json/);
  const summary = JSON.parse(readFileSync(join(dir, 'out', 'evolve-summary.json'), 'utf8'));
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.modelIds, ['fake-claude-1']);
  assert.ok(existsSync(join(dir, 'out', 'evolved-style.txt')));

  // Run it again: nothing is called, and the answer is the same.
  const before = readFileSync(log, 'utf8').length;
  const again = spawnSync(process.execPath, [EVOLVE, ...args], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(log, 'utf8').length, before);
  assert.equal(again.stdout, run.stdout);
});

test('--dry prints the plan and calls nobody, and a bad option exits with 2', t => {
  const dir = tmp(t), log = join(dir, 'calls');
  const env = { ...process.env, DYSLEXIC_CLAUDE_BIN: fakeClaude(dir), FAKE_LOG: log };
  const dry = spawnSync(process.execPath, [EVOLVE, '--dry', '--model', 'claude:opus', '--rounds', '4', '--variants', '3', '--train', '4', '--holdout', '8'], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /4 rounds, 3 versions each, 4 questions per family \(24 a round\), 8 in the final check \(44 after cuts\)/);
  assert.match(dry.stdout, /model claude:opus, proposer claude:opus, start strong/);
  assert.match(dry.stdout, /most calls: 408 loop \+ 8 proposer \+ 220 final = 636/);
  assert.match(dry.stdout, /cut from the final check, because the loop used them: trick-1 trick-2 trick-3 trick-4/);
  assert.equal(existsSync(log), false, 'the fake claude was never started');

  const bad = spawnSync(process.execPath, [EVOLVE, '--rounds', '0'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--rounds must be a whole number of at least 1/);
  assert.equal(existsSync(log), false);
});
