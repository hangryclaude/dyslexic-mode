import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LENSES, STYLES, scrambled, withStyle } from '../lib/thinking.mjs';
import { CONDITIONS, majority, styled } from '../bench/conditions.mjs';
import { groups, judgeAll, judgeGroup, judgePrompt, parseRanking } from '../bench/judge.mjs';
import { analyze, renderHtml, renderMarkdown, verdict } from '../bench/report.mjs';
import { runBench, parseConc } from '../bench/run.mjs';
import { SYSTEM, backendOf, parseClaude, parseGrok, parseOpencode, runImage, runText } from '../bench/runners.mjs';
import { accuracy, compare, cost, readRows, signTest, wilson } from '../bench/stats.mjs';
import { FAMILIES, continuations, lastAnswer, makeItems, score, seedFrom, shuffled, usesObject } from '../bench/tasks.mjs';

const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const itemsOf = (family, n = 40, seed = 5, scale = 1) => makeItems({ seed, perFamily: n, families: [family], scale });
const SCALES = [1, 2, 4];
// A scaled id carries x and the scale after the seed: walk-5x2-3. A standard one does not: walk-5-3.
const scaleOf = item => Number(item.id.match(/-\d+x(\d+)-\d+$/)?.[1] ?? 1);
const body = prompt => prompt.split('\n');
const numbered = prompt => body(prompt).map(l => l.match(/^(\d+)\. (.*)$/)).filter(Boolean).map(m => m[2]);

// ---- items --------------------------------------------------------------------------------------

test('items are deterministic, ids are unique, and asking for more never changes the first ones', () => {
  const a = makeItems({ seed: 3, perFamily: 8 }), b = makeItems({ seed: 3, perFamily: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(makeItems({ seed: 4, perFamily: 8 }).filter(i => i.family === 'walk'), a.filter(i => i.family === 'walk'));
  assert.equal(new Set(a.map(i => i.id)).size, a.length);
  const count = f => a.filter(i => i.family === f).length;
  for (const f of ['walk', 'dice', 'pattern', 'arith', 'letters', 'trick']) assert.equal(count(f), 8, f);
  assert.equal(count('uses'), 4);
  for (const item of makeItems({ seed: 3, perFamily: 3 })) assert.deepEqual(item, a.find(i => i.id === item.id), item.id);
  for (const item of a) {
    assert.deepEqual(Object.keys(item), ['id', 'family', 'prompt', 'ask', 'format', 'answer']);
    assert.ok(item.prompt.endsWith(item.ask), `${item.id}: ask is the last sentence of the prompt`);
    assert.match(item.format, /ANSWER:/);
    if (item.family === 'uses') assert.equal(item.answer, null);
    else assert.equal(typeof item.answer, 'string');
  }
  assert.throws(() => makeItems({ families: ['nope'] }), /unknown family/);
});

test('standard items are pinned, and a larger scale is a separate, longer set', () => {
  // The pilot results in bench/results were made from these. A change to a generator that moves
  // any of them would quietly make every old results file stale, so it fails here first.
  const first = Object.fromEntries(makeItems({ seed: 1, perFamily: 1 }).map(i => [i.family, i.answer]));
  assert.deepEqual(first, { walk: '-4,-3,south', dice: 'top=3, north=2', pattern: '58, 29', arith: '10', letters: '6', trick: '1', uses: null });
  assert.deepEqual(makeItems({ seed: 1, perFamily: 4 }), makeItems({ seed: 1, perFamily: 4, scale: 1 }));

  const standard = makeItems({ seed: 1, perFamily: 5 });
  for (const scale of [2, 3, 8]) {
    const big = makeItems({ seed: 1, perFamily: 5, scale });
    assert.deepEqual(big, makeItems({ seed: 1, perFamily: 5, scale }), 'deterministic');
    for (const family of ['walk', 'dice', 'arith', 'letters']) {
      const ids = big.filter(i => i.family === family).map(i => i.id);
      assert.deepEqual(ids, [0, 1, 2, 3, 4].map(i => `${family}-1x${scale}-${i}`));
      assert.ok(ids.every(id => !standard.some(s => s.id === id)), 'no id is shared with the standard set');
      assert.ok(big.filter(i => i.family === family).every((b, i) => b.prompt !== standard.filter(s => s.family === family)[i].prompt));
    }
    // Pattern, trick and uses have no size, so they are the very same items under the same ids.
    for (const family of ['pattern', 'trick', 'uses']) {
      assert.deepEqual(big.filter(i => i.family === family), standard.filter(i => i.family === family), family);
    }
    // Every key still reads back, and the prompts still end with their question.
    for (const item of big) {
      if (item.family !== 'uses') assert.equal(score(item, `ANSWER: ${item.answer}`).correct, true, item.id);
      assert.ok(item.prompt.endsWith(item.ask), item.id);
    }
  }
  for (const bad of [0, -1, 1.5, '2', NaN]) assert.throws(() => makeItems({ scale: bad }), /scale must be a whole number/, String(bad));
});

// A complex number as [re, im]: facing north is i, east is 1. Turning right multiplies by -i.
const mul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
function walkByComplex(prompt) {
  let pos = [0, 0], face = [0, 1];
  const add = (p, v, k) => [p[0] + k * v[0], p[1] + k * v[1]];
  const left = [0, 1], right = [0, -1];
  for (const move of numbered(prompt)) {
    let m;
    if (move === 'Turn left.') face = mul(face, left);
    else if (move === 'Turn right.') face = mul(face, right);
    else if (move === 'Turn around.') face = mul(face, [-1, 0]);
    else if ((m = move.match(/^Walk forward (\d+) steps?\.$/))) pos = add(pos, face, Number(m[1]));
    else if ((m = move.match(/^Step backward (\d+) steps?, still facing the same way\.$/))) pos = add(pos, face, -Number(m[1]));
    else if ((m = move.match(/^Sidestep left (\d+) steps?, still facing the same way\.$/))) pos = add(pos, mul(face, left), Number(m[1]));
    else if ((m = move.match(/^Sidestep right (\d+) steps?, still facing the same way\.$/))) pos = add(pos, mul(face, right), Number(m[1]));
    else assert.fail(`unreadable move: ${move}`);
  }
  const name = { '0,1': 'north', '1,0': 'east', '0,-1': 'south', '-1,0': 'west' }[face.join(',')];
  return `${pos[0] + 0},${pos[1] + 0},${name}`;
}

test('walk answers match an independent walk with complex numbers', () => {
  // The instrument first, on a walk worked out by hand: right, 3 forward, left, 2 sideways left,
  // 4 back, around, 1 sideways right ends at (0,-4) facing south.
  const byHand = ['1. Turn right.', '2. Walk forward 3 steps.', '3. Turn left.', '4. Sidestep left 2 steps, still facing the same way.',
    '5. Step backward 4 steps, still facing the same way.', '6. Turn around.', '7. Sidestep right 1 step, still facing the same way.'].join('\n');
  assert.equal(walkByComplex(byHand), '0,-4,south');
  for (const scale of SCALES) {
    const items = itemsOf('walk', 40, 5, scale);
    for (const item of items) {
      assert.equal(numbered(item.prompt).length, 12 * scale, item.id);
      assert.equal(walkByComplex(item.prompt), item.answer, item.id);
    }
    assert.ok(new Set(items.map(i => i.answer.split(',')[2])).size >= 3, 'all four directions turn up');
  }
});

// A die as a rotation: each face has a normal vector, and a roll turns the world 90 degrees about a horizontal axis.
const times = (A, B) => A.map(row => [0, 1, 2].map(j => row.reduce((s, x, k) => s + x * B[k][j], 0)));
const apply = (A, v) => A.map(row => row.reduce((s, x, k) => s + x * v[k], 0));
const ROTATE = {
  north: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  south: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  east: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  west: [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
};
const NORMAL = { 1: [0, 0, 1], 6: [0, 0, -1], 2: [0, 1, 0], 5: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0] };
function diceByMatrix(prompt) {
  let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const roll of numbered(prompt)) R = times(ROTATE[roll], R);
  const facing = v => Object.keys(NORMAL).find(f => apply(R, NORMAL[f]).every((x, i) => x === v[i]));
  return `top=${facing([0, 0, 1])}, north=${facing([0, 1, 0])}`;
}

test('dice answers match rotation matrices', () => {
  // Rolling north once tips the die over its north edge: the old top (1) faces north, the old south face (5) comes up.
  assert.equal(diceByMatrix('1. north'), 'top=5, north=1');
  assert.equal(diceByMatrix('1. north\n2. north'), 'top=6, north=5');
  assert.equal(diceByMatrix('1. east'), 'top=4, north=2');
  for (const scale of SCALES) {
    for (const item of itemsOf('dice', 40, 5, scale)) {
      assert.equal(numbered(item.prompt).length, 7 * scale, item.id);
      assert.match(item.prompt, new RegExp(`You roll it ${7 * scale} times`));
      assert.equal(diceByMatrix(item.prompt), item.answer, item.id);
    }
  }
});

// Brute force over every rule and a wider range of settings than the generator draws from.
function allContinuations(t) {
  const found = new Map();
  const tryRule = terms => {
    if (terms.slice(0, t.length).every((x, i) => x === t[i])) found.set(terms.slice(t.length).join(', '), true);
  };
  const len = t.length + 2, range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const digits = n => [...String(n)].reduce((s, c) => s + Number(c), 0);
  for (const d1 of range(-30, 30)) for (const d2 of range(-30, 30)) tryRule(Array.from({ length: len }, (_, i) => (i % 2 ? t[1] + d2 * ((i - 1) / 2) : t[0] + d1 * (i / 2))));
  for (const g of range(-30, 30)) for (const s of range(-10, 10)) tryRule(Array.from({ length: len }, (_, i) => t[0] + g * i + (s * i * (i - 1)) / 2));
  for (const m of range(-5, 9)) for (const p of range(-30, 30)) for (const timesFirst of [true, false]) {
    const seq = [t[0]];
    while (seq.length < len) seq.push((seq.length % 2 === 1) === timesFirst ? seq.at(-1) * m : seq.at(-1) + p);
    tryRule(seq);
  }
  for (const c of range(-30, 30)) {
    const seq = [t[0], t[1]];
    while (seq.length < len) seq.push(seq.at(-1) + seq.at(-2) + c);
    tryRule(seq);
  }
  { const seq = [t[0]]; while (seq.length < len) seq.push(seq.at(-1) + digits(seq.at(-1))); tryRule(seq); }
  for (const k of range(-30, 30)) { const seq = [t[0]]; while (seq.length < len) seq.push(2 * seq.at(-1) - k); tryRule(seq); }
  return [...found.keys()];
}

test('pattern answers are the only continuation any of the six rules allows', () => {
  const items = itemsOf('pattern', 60);
  for (const item of items) {
    const shown = body(item.prompt)[1].split(', ').map(Number);
    assert.ok(shown.length === 7 || shown.length === 8, item.id);
    assert.deepEqual(allContinuations(shown), [item.answer], item.id);
    const own = continuations(shown);
    assert.equal(own.length, 1, item.id);
    assert.equal(own[0].join(', '), item.answer, item.id);
  }
  // Both solvers see 1, 2, 4, 8, 16 two ways, doubling or adding the digit sum, so it can never be an item.
  const both = ['23, 28', '32, 64'];
  assert.deepEqual(continuations([1, 2, 4, 8, 16]).map(p => p.join(', ')).sort(), both);
  assert.deepEqual(allContinuations([1, 2, 4, 8, 16]).sort(), both);
  // With seven terms the digit sum has fallen away and only one reading is left.
  assert.deepEqual(continuations([1, 2, 4, 8, 16, 32, 64]), [[128, 256]]);
  assert.deepEqual(allContinuations([1, 2, 4, 8, 16, 32, 64]), ['128, 256']);
  assert.deepEqual(continuations([3, 5, 7, 9, 11, 13, 15]), [[17, 19]]);
  assert.deepEqual(continuations([0, 1, 4, 9, 16, 25, 36]), [[49, 64]]);
  assert.ok(new Set(items.map(i => i.answer)).size > 50, 'the answers vary');
});

test('arith answers match a re-reading of the story in exact integers', () => {
  const FRACTION = { half: 2n, 'a third': 3n, 'a quarter': 4n, 'a fifth': 5n };
  const items = [...itemsOf('arith', 80), ...itemsOf('arith', 40, 5, 2), ...itemsOf('arith', 40, 5, 4)];
  for (const item of items) {
    const lines = body(item.prompt);
    const start = lines[0].match(/^A (library|farm|shop|school) has (\d+) (books|eggs|apples|pencils)\.$/);
    assert.ok(start, item.id);
    let v = BigInt(start[2]);
    assert.ok(v >= 120n && v <= 400n, item.id);
    const ops = numbered(item.prompt);
    assert.equal(ops.length, 6 * scaleOf(item), item.id);
    let m;
    for (const op of ops) {
      if ((m = op.match(/^It receives (\d+) boxes with (\d+) \w+ in each box\.$/))) v += BigInt(m[1]) * BigInt(m[2]);
      else if ((m = op.match(/^(\d+) \w+ are lost\.$/))) v -= BigInt(m[1]);
      else if ((m = op.match(/^It gives away (half|a third|a quarter|a fifth) of its \w+\. Round the number given away down\.$/))) v -= v / FRACTION[m[1]];
      else if ((m = op.match(/^The number of \w+ grows by (10|20|25|50) percent\. Round the growth down\.$/))) v += (v * BigInt(m[1])) / 100n;
      else if (/^The number of \w+ doubles\.$/.test(op)) { assert.ok(v < 600n, `${item.id}: doubling only under 600`); v *= 2n; }
      else assert.fail(`unreadable step: ${op}`);
      assert.ok(v > 0n, `${item.id}: every value stays positive`);
    }
    const share = lines.find(l => l.startsWith('Then all the')).match(/shared equally between (\d+) /);
    const rooms = BigInt(share[1]);
    assert.ok(rooms >= 3n && rooms <= 7n, item.id);
    assert.equal(String(v / rooms), item.answer, item.id);
  }
});

test('letters answers match a recount, capitals included', () => {
  for (const item of [...itemsOf('letters', 60), ...itemsOf('letters', 30, 5, 2), ...itemsOf('letters', 30, 5, 4)]) {
    const sentence = item.prompt.match(/Here is a sentence: "(.+)"/)[1];
    const letter = item.ask.match(/the letter "(.)"/)[1];
    assert.equal(sentence.split(' ').length, 18 * scaleOf(item), item.id);
    assert.ok('earsntoil'.includes(letter));
    let n = 0;
    for (const ch of sentence) if (ch.toLowerCase() === letter) n++;
    assert.equal(String(n), item.answer, item.id);
  }
  assert.ok(itemsOf('letters', 60).some(i => /[A-Z]/.test(i.prompt.match(/sentence: "(.+)"/)[1].slice(1))), 'some capitals are not at the start');
});

// ---- scoring ------------------------------------------------------------------------------------

const trick = n => makeItems({ perFamily: 8, families: ['trick'] })[n - 1];
const right = (item, reply) => score(item, reply).correct;

test('the trick riddles have the twisted answers', () => {
  const items = makeItems({ families: ['trick'] });
  assert.deepEqual(items.map(i => i.answer), ['1', '10', '1', '0', '0', '50', 'feathers', 'father']);
  assert.match(items[0].prompt, /wolf, a goat and a cabbage/);
  assert.match(items[5].prompt, /does not know where the car is/);
  assert.match(items[7].prompt, /who is the boy's father/);
});

test('score reads money, fractions, words and the two word riddles', () => {
  const bat = trick(2);
  for (const ok of ['$0.10', '0.10', '0.1', '10', '10 cents', '10c'.replace('c', '¢'), '$0.10 (10 cents)', '10.0 cents']) assert.equal(right(bat, `ANSWER: ${ok}`), true, ok);
  for (const no of ['5', '5 cents', '$0.05', '$1.00']) assert.equal(right(bat, `ANSWER: ${no}`), false, no);

  const monty = trick(6);
  for (const ok of ['1/2', '50%', '50', '0.5', '50 percent', 'half', 'fifty percent']) assert.equal(right(monty, `ANSWER: ${ok}`), true, ok);
  for (const no of ['2/3', '66.7%', '67', '1/3']) assert.equal(right(monty, `ANSWER: ${no}`), false, no);

  const cat = trick(5);
  for (const ok of ['0', '0%', 'zero', '0 percent']) assert.equal(right(cat, `ANSWER: ${ok}`), true, ok);
  assert.equal(right(cat, 'ANSWER: 50%'), false);

  for (const [n, ok] of [[1, '1'], [1, 'one'], [3, '1'], [4, '0']]) assert.equal(right(trick(n), `ANSWER: ${ok}`), true, `${n} ${ok}`);
  for (const [n, no] of [[1, '7'], [3, '4'], [4, '1']]) assert.equal(right(trick(n), `ANSWER: ${no}`), false, `${n} ${no}`);

  const weight = trick(7);
  for (const ok of ['feathers', 'Two kilograms of feathers', '**feathers**', 'feathers (2 kg is more than 1 kg of steel)']) assert.equal(right(weight, `ANSWER: ${ok}`), true, ok);
  for (const no of ['steel', 'The steel', 'steel or feathers', 'they weigh the same']) assert.equal(right(weight, `ANSWER: ${no}`), false, no);

  const surgeon = trick(8);
  for (const ok of ['father', 'His dad', 'The boy\'s father', 'father (not the mother)']) assert.equal(right(surgeon, `ANSWER: ${ok}`), true, ok);
  for (const no of ['mother', 'his mom', 'mother or father', 'stepfather?'.replace('stepfather?', 'the boy\'s mother')]) assert.equal(right(surgeon, `ANSWER: ${no}`), false, no);

  assert.equal(score(weight, 'ANSWER: feathers').got, 'feathers');
  assert.equal(score(weight, 'ANSWER: steel').got, 'steel');
});

test('score reads the text after the last ANSWER:, in any case, through markdown', () => {
  const [walk] = itemsOf('walk', 1);
  const ok = answer => ({ ...walk, answer });
  assert.deepEqual(lastAnswer('a\nANSWER: 1\nb\nanswer: 2'), { found: true, part: ' 2' });
  assert.deepEqual(lastAnswer('only a last line\n\n  7 books  '), { found: false, part: '7 books' });
  const number = { id: 'letters-1-0', family: 'letters', answer: '7' };
  for (const reply of ['ANSWER: 7', 'answer: 7', 'Answer : 7', '**ANSWER: 7**', '**ANSWER:** 7', '`ANSWER: 7`', 'x\nANSWER: 3\nmore\nANSWER: 7', 'ANSWER:\n7', 'ANSWER: 7.']) {
    assert.deepEqual(score(number, reply), { correct: true, got: '7', formatOk: true }, reply);
  }
  assert.deepEqual(score(number, 'ANSWER: 1,234'), { correct: false, got: '1234', formatOk: true });
  // No marker: the last line is read, but the format was not followed.
  assert.deepEqual(score(number, 'I count them.\nSo it is 7'), { correct: true, got: '7', formatOk: false });
  assert.deepEqual(score(number, 'ANSWER: many'), { correct: false, got: 'many', formatOk: false });

  assert.deepEqual(score(ok('3,-2,east'), 'ANSWER: 3,-2,east'), { correct: true, got: '3,-2,east', formatOk: true });
  assert.equal(score(ok('3,-2,east'), 'ANSWER: 3, −2, East').got, '3,-2,east');
  assert.equal(score(ok('3,-2,east'), 'ANSWER: x=3, y=-2, facing east').correct, true);
  assert.equal(score(ok('3,-2,east'), 'ANSWER: 3,-2,west').correct, false);
  assert.equal(score(ok('3,-2,east'), 'ANSWER: 3,-2').formatOk, false);

  const [dice] = itemsOf('dice', 1);
  const d = answer => ({ ...dice, answer });
  assert.equal(score(d('top=4, north=2'), 'ANSWER: top=4, north=2').correct, true);
  assert.equal(score(d('top=4, north=2'), 'ANSWER: top: 4 north: 2').correct, true);
  assert.equal(score(d('top=4, north=2'), 'ANSWER: 4, 2').correct, true);
  assert.equal(score(d('top=4, north=2'), 'ANSWER: top=2, north=4').correct, false);

  const [pattern] = itemsOf('pattern', 1);
  const p = answer => ({ ...pattern, answer });
  assert.equal(score(p('58, 29'), 'ANSWER: 58, 29').correct, true);
  assert.equal(score(p('58, 29'), 'ANSWER: 58,29').correct, true);
  assert.equal(score(p('1024, 2048'), 'ANSWER: 1,024, 2,048').correct, true);
  assert.equal(score(p('58, 29'), 'ANSWER: 58').formatOk, false);
});

test('score counts eight uses and leaves them unmarked', () => {
  const [item] = makeItems({ families: ['uses'] });
  assert.equal(usesObject(item.id), 'a shoelace');
  const eight = Array.from({ length: 8 }, (_, i) => `use ${i + 1}`);
  assert.deepEqual(score(item, `ANSWER:\n${eight.join('\n')}`), { correct: null, got: eight.join('\n'), formatOk: true });
  assert.equal(score(item, `Sure!\nANSWER:\n${eight.map((u, i) => `${i + 1}. ${u}`).join('\n')}`).formatOk, true);
  assert.equal(score(item, `ANSWER:\n${eight.map(u => `- **${u}**`).join('\n')}`).got, eight.join('\n'));
  assert.equal(score(item, `ANSWER: ${eight[0]}\n${eight.slice(1).join('\n')}`).formatOk, true, 'the first use may share the ANSWER line');
  assert.equal(score(item, `ANSWER:\n${eight.slice(1).join('\n')}`).formatOk, false);
  assert.equal(score(item, `ANSWER:\n${eight.join('\n')}\nnine`).formatOk, false);
  assert.equal(score(item, eight.join('\n')).formatOk, false, 'no marker');
});

test('every key reads back as correct through score, and a wrong key does not', () => {
  for (const item of makeItems({ seed: 11, perFamily: 30 })) {
    if (item.family === 'uses') continue;
    assert.deepEqual(score(item, `thinking...\nANSWER: ${item.answer}`), { correct: true, got: item.answer, formatOk: true }, item.id);
  }
  const [walk] = itemsOf('walk', 1);
  assert.equal(score(walk, 'ANSWER: 99,99,north').correct, false);
});

// ---- stats --------------------------------------------------------------------------------------

test('wilson gives the textbook intervals', () => {
  const near = (x, y) => assert.ok(Math.abs(x - y) < 6e-4, `${x} vs ${y}`);
  const w = wilson(8, 10);
  near(w.lo, 0.4902); near(w.hi, 0.9433); near(w.p, 0.8);
  near(wilson(0, 10).lo, 0); near(wilson(0, 10).hi, 0.2775);
  near(wilson(10, 10).lo, 0.7225); near(wilson(10, 10).hi, 1);
  assert.deepEqual(wilson(0, 0), { p: null, lo: null, hi: null });
  assert.ok(wilson(50, 100).hi - wilson(50, 100).lo < wilson(5, 10).hi - wilson(5, 10).lo);
});

test('the sign test is exact and two-sided', () => {
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-12, `${x} vs ${y}`);
  near(signTest(9, 1), 22 / 1024);
  near(signTest(1, 9), 22 / 1024);
  near(signTest(10, 0), 2 / 1024);
  near(signTest(8, 2), 112 / 1024);
  near(signTest(5, 5), 1);
  near(signTest(0, 0), 1);
  near(signTest(5, 0), 2 / 32);
  near(signTest(3, 0), 0.25);
  assert.equal(signTest(2000, 2000), 1);
  assert.ok(Number.isFinite(signTest(4000, 3900)));
  // Another instrument: the same tail summed in exact integers, then divided by 2^n.
  const exact = (a, b) => {
    const n = BigInt(a + b);
    let c = 1n, sum = 0n;
    for (let i = 0n; i <= BigInt(Math.min(a, b)); i++) { sum += c; c = (c * (n - i)) / (i + 1n); }
    return Math.min(1, Number((2n * sum * 10n ** 30n) / 2n ** n) / 1e30);
  };
  for (const [a, b] of [[20, 5], [37, 21], [150, 100], [600, 400], [510, 490], [1500, 1400]]) {
    const want = exact(a, b);
    assert.ok(Math.abs(signTest(a, b) - want) / want < 1e-9, `${a} v ${b}: ${signTest(a, b)} vs ${want}`);
  }
});

test('compare pairs the same (model, question) under two conditions', () => {
  const row = (model, cond, id, correct) => ({ model, cond, id, family: 'walk', correct, formatOk: true });
  const rows = [
    row('m1', 'a', 'q1', true), row('m1', 'b', 'q1', false),
    row('m1', 'a', 'q2', true), row('m1', 'b', 'q2', true),
    row('m1', 'a', 'q3', false), row('m1', 'b', 'q3', true),
    row('m1', 'a', 'q4', false), row('m1', 'b', 'q4', false),
    row('m2', 'a', 'q1', true), row('m2', 'b', 'q1', false),
    row('m2', 'a', 'q9', true),
    { ...row('m2', 'a', 'q5', true), error: 'boom', correct: null },
    { ...row('m2', 'b', 'q5', true) },
    { ...row('m1', 'a', 'q7', null), family: 'uses' },
  ];
  const all = compare(rows, 'a', 'b');
  assert.deepEqual({ n: all.n, both: all.both, neither: all.neither, aOnly: all.aOnly, bOnly: all.bOnly }, { n: 5, both: 1, neither: 1, aOnly: 2, bOnly: 1 });
  assert.equal(all.p, signTest(2, 1));
  assert.ok(Math.abs(all.diff - 0.2) < 1e-12);
  assert.deepEqual(compare(rows, 'a', 'b', r => r.model === 'm2'), { n: 1, both: 0, neither: 0, aOnly: 1, bOnly: 0, p: 1, diff: 1 });
  assert.equal(compare(rows, 'b', 'a').aOnly, all.bOnly);
  assert.throws(() => compare(rows, 'a', 'a'), /two different/);
  assert.deepEqual(accuracy(rows.filter(r => r.cond === 'a' && r.model === 'm1')).k, 2);
  assert.equal(accuracy(rows.filter(r => r.cond === 'a' && r.model === 'm2')).n, 2, 'errors and unkeyed rows are not counted');
});

// ---- conditions ---------------------------------------------------------------------------------

function fake(replies = []) {
  const calls = [];
  const runText = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const text = typeof replies === 'function' ? replies(prompt, calls.length - 1) : replies[calls.length - 1] ?? 'ANSWER: 4';
    return { text, ms: 1, outTokens: 3 };
  };
  return { calls, runText };
}
const walkItem = itemsOf('walk', 1)[0];

test('the plain and style conditions send the question, the style and the format line', async () => {
  for (const name of ['base', 'careful', 'dyslexic', 'strong', 'extreme']) {
    const f = fake();
    const res = await CONDITIONS[name]({ model: 'claude:haiku', item: walkItem, runText: f.runText });
    assert.equal(f.calls.length, 1, name);
    assert.equal(f.calls[0].model, 'claude:haiku');
    assert.equal(f.calls[0].prompt, `${withStyle(name, walkItem.prompt)}\n\n${walkItem.format}`, name);
    assert.deepEqual(res, { text: 'ANSWER: 4', calls: 1 });
  }
  const f = fake();
  await CONDITIONS.base({ model: 'm', item: walkItem, runText: f.runText });
  assert.equal(f.calls[0].prompt, `${walkItem.prompt}\n\n${walkItem.format}`);
});

test('styled(text) lays a custom style out exactly like a named one', async () => {
  const asked = async (cond, item = walkItem) => { const f = fake(); await cond({ model: 'm', item, runText: f.runText }); return f.calls[0].prompt; };
  assert.equal(await asked(styled(STYLES.dyslexic)), await asked(CONDITIONS.dyslexic));
  assert.equal(await asked(styled(STYLES.careful)), await asked(CONDITIONS.careful));
  assert.equal(await asked(styled('')), await asked(CONDITIONS.base));
  const custom = await asked(styled('Think in blue.'));
  assert.match(custom, /^How to think:\nThink in blue\.\n\nQuestion:\n/);
  assert.ok(custom.endsWith(walkItem.format));
});

test('scrambled jumbles the same way for every model and ends with the format line', async () => {
  const run = async model => { const f = fake(); await CONDITIONS.scrambled({ model, item: walkItem, runText: f.runText }); return f.calls[0].prompt; };
  const a = await run('claude:haiku'), b = await run('grok');
  assert.equal(a, b);
  assert.equal(a, `${scrambled(walkItem.prompt, seedFrom(walkItem.id))}\n\n${walkItem.format}`);
  assert.match(a, /jumbled/);
  assert.notEqual(a, `${walkItem.prompt}\n\n${walkItem.format}`);
  const other = itemsOf('walk', 2)[1];
  const f = fake();
  await CONDITIONS.scrambled({ model: 'm', item: other, runText: f.runText });
  assert.notEqual(f.calls[0].prompt, scrambled(other.prompt, seedFrom(walkItem.id)) + '\n\n' + other.format, 'the seed comes from the item');
});

test('explorer makes four calls: three drafts, then one that weighs them', async () => {
  const f = fake((prompt, i) => (prompt.startsWith('Three thinkers') ? 'weighed\nANSWER: 9' : `draft ${i}`));
  const res = await CONDITIONS.explorer({ model: 'claude:sonnet', item: walkItem, runText: f.runText });
  assert.equal(res.calls, 4);
  assert.equal(f.calls.length, 4);
  assert.equal(res.text, 'weighed\nANSWER: 9');
  const how = Object.values(LENSES);
  for (const how_ of how) assert.equal(f.calls.filter(c => c.prompt.startsWith(how_)).length, 1);
  for (const c of f.calls) assert.ok(c.prompt.endsWith(walkItem.format), 'every call ends with the format line');
  const last = f.calls.at(-1).prompt;
  assert.ok(last.startsWith('Three thinkers'));
  for (const c of f.calls.slice(0, 3)) assert.ok(c.prompt.includes(walkItem.prompt));
});

test('vote3 makes three plain calls and takes the most common readable answer', async () => {
  const [letters] = itemsOf('letters', 1);
  const vote = async replies => {
    const f = fake(replies);
    const res = await CONDITIONS.vote3({ model: 'm', item: letters, runText: f.runText });
    assert.equal(res.calls, 3);
    assert.equal(f.calls.length, 3);
    for (const c of f.calls) assert.equal(c.prompt, `${letters.prompt}\n\n${letters.format}`);
    return res.text;
  };
  assert.equal(await vote(['A\nANSWER: 4', 'B\nANSWER: 5', 'C\nANSWER: 5']), 'B\nANSWER: 5');
  assert.equal(await vote(['A\nANSWER: 4', 'B\nANSWER: 5', 'C\nANSWER: 4']), 'A\nANSWER: 4');
  assert.equal(await vote(['A\nANSWER: 4', 'B\nANSWER: 5', 'C\nANSWER: 6']), 'A\nANSWER: 4', 'a three-way tie goes to the first');
  assert.equal(await vote(['no idea', 'B\nANSWER: 5', 'still none']), 'B\nANSWER: 5', 'unreadable replies do not vote');
  assert.equal(await vote(['x', 'y', 'z']), 'x', 'nothing readable: the first');
  assert.equal(majority(['ANSWER: 1', 'ANSWER: 2', 'ANSWER: 2'], letters), 'ANSWER: 2');
});

// ---- runBench -----------------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeRunners({ fail = () => false, delay = 3, items = ITEMS } = {}) {
  const inflight = {}, peak = {}, calls = [];
  const runText = async ({ model, prompt }) => {
    const b = backendOf(model);
    calls.push({ model, prompt });
    inflight[b] = (inflight[b] ?? 0) + 1;
    peak[b] = Math.max(peak[b] ?? 0, inflight[b]);
    try {
      await sleep(delay);
      const err = fail(model, prompt);
      if (err) throw err;
      const it = items.find(i => prompt.includes(i.prompt));
      return { text: `ok\nANSWER: ${it.answer ?? 'x'}`, ms: delay, outTokens: 5, modelId: `${model}-id` };
    } finally {
      inflight[b]--;
    }
  };
  return { runners: { runText, runImage: runText }, peak, calls };
}
const ITEMS = makeItems({ seed: 1, perFamily: 2, families: ['walk', 'letters', 'uses'] });
const COND = { base: CONDITIONS.base, vote3: CONDITIONS.vote3 };
const quiet = () => {};

test('runBench runs every job once, caps each backend, and records the fields', async t => {
  const out = join(tmp(t), 'r.jsonl');
  const { runners, peak } = makeRunners();
  const models = ['claude:haiku', 'opencode:go/x', 'grok'];
  const res = await runBench({ models, conds: COND, items: ITEMS, out, conc: { claude: 2, opencode: 1, grok: 1 }, runners, log: quiet });
  const rows = readRows(out);
  assert.equal(rows.length, 3 * 2 * ITEMS.length);
  assert.equal(res.errors, 0);
  assert.ok(peak.claude <= 2 && peak.opencode <= 1 && peak.grok <= 1, JSON.stringify(peak));
  assert.ok(peak.claude === 2, 'the cap is used');
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).slice(0, 14), ['model', 'cond', 'id', 'family', 'answer', 'got', 'correct', 'formatOk', 'ms', 'calls', 'chars', 'text', 'error', 'outTokens']);
    assert.equal(r.error, null);
    assert.equal(r.calls, r.cond === 'vote3' ? 3 : 1);
    assert.equal(r.chars, r.text.length);
    assert.equal(r.modelId, `${r.model}-id`);
    assert.equal(r.outTokens, 5 * r.calls);
    if (r.family === 'uses') assert.equal(r.correct, null);
    else assert.equal(r.correct, true);
  }
});

test('runBench is resumable, and a failed job is tried again later', async t => {
  const out = join(tmp(t), 'r.jsonl');
  let broken = true;
  const { runners, calls } = makeRunners({ fail: model => (broken && model === 'grok' ? new Error('boom') : null) });
  const args = { models: ['claude:haiku', 'grok'], conds: { base: CONDITIONS.base }, items: ITEMS, out, conc: { claude: 2, grok: 2 }, runners, log: quiet };
  const first = await runBench(args);
  assert.equal(first.errors, ITEMS.length);
  assert.equal(readRows(out).filter(r => r.error).length, ITEMS.length);
  assert.ok(readRows(out).find(r => r.error).error.includes('boom'));
  const lines = readFileSync(out, 'utf8').trim().split('\n').length;

  // Same arguments, nothing broken: only the failed jobs run, and their new rows replace the errors.
  broken = false;
  const before = calls.length;
  const second = await runBench(args);
  assert.equal(second.finished, ITEMS.length);
  assert.equal(calls.length - before, ITEMS.length);
  assert.equal(readRows(out).filter(r => r.error).length, 0);
  assert.equal(readFileSync(out, 'utf8').trim().split('\n').length, lines + ITEMS.length);

  const third = await runBench(args);
  assert.equal(third.finished, 0);
  assert.equal(third.skipped, 2 * ITEMS.length);
  assert.equal(calls.length - before, ITEMS.length);
});

test('runBench stops asking a model that keeps hitting its quota', async t => {
  const out = join(tmp(t), 'r.jsonl');
  const quota = Object.assign(new Error('Go usage limit exceeded'), { fatal: true });
  const items = makeItems({ seed: 1, perFamily: 4, families: ['walk', 'letters'] });
  const { runners, calls } = makeRunners({ items, fail: model => (model === 'opencode:go/x' ? quota : null) });
  const res = await runBench({ models: ['opencode:go/x', 'claude:haiku'], conds: { base: CONDITIONS.base }, items, out, conc: { opencode: 1, claude: 2 }, runners, log: quiet });
  assert.equal(res.errors, items.length);
  assert.equal(calls.filter(c => c.model === 'opencode:go/x').length, 3, 'three tries, then the rest are skipped');
  const errs = readRows(out).filter(r => r.model === 'opencode:go/x').map(r => r.error);
  assert.equal(errs.filter(e => e.startsWith('skipped')).length, items.length - 3);
  assert.equal(readRows(out).filter(r => r.model === 'claude:haiku' && !r.error).length, items.length);
});

test('a backend that reports no token counts leaves outTokens null, not zero', async t => {
  const out = join(tmp(t), 'r.jsonl');
  const runText = async ({ prompt }) => ({ text: `ANSWER: ${ITEMS.find(i => prompt.includes(i.prompt)).answer ?? 'x'}`, ms: 1, outTokens: null });
  await runBench({ models: ['grok'], conds: { base: CONDITIONS.base, vote3: CONDITIONS.vote3 }, items: ITEMS, out, runners: { runText }, log: quiet });
  const rows = readRows(out);
  assert.equal(rows.length, 2 * ITEMS.length);
  assert.ok(rows.every(r => r.outTokens === null && r.modelId === null && !r.error));
  const k = cost(rows);
  assert.equal(k.outTokens, null, 'the report shows a dash, not 0');
});

test('runBench shuffles jobs by seed so no model or condition goes first', async t => {
  const order = async seed => {
    const out = join(tmp(t), `s${seed}-${Math.random()}.jsonl`);
    const { runners } = makeRunners({ delay: 0 });
    await runBench({ models: ['claude:a', 'claude:b'], conds: COND, items: ITEMS, out, conc: { claude: 1 }, seed, runners, log: quiet });
    return readFileSync(out, 'utf8').trim().split('\n').map(l => { const r = JSON.parse(l); return `${r.model}|${r.cond}|${r.id}`; });
  };
  const a = await order(1), again = await order(1), b = await order(2);
  assert.deepEqual(a, again);
  assert.notDeepEqual(a, b);
  assert.deepEqual([...a].sort(), [...b].sort());
  const firstHalf = a.slice(0, a.length / 2);
  assert.ok(firstHalf.some(k => k.startsWith('claude:a')) && firstHalf.some(k => k.startsWith('claude:b')));
  assert.ok(firstHalf.some(k => k.includes('|base|')) && firstHalf.some(k => k.includes('|vote3|')));
  assert.deepEqual(shuffled([1, 2, 3, 4, 5, 6], 9), shuffled([1, 2, 3, 4, 5, 6], 9));
});

test('--conc parses, and rejects nonsense', () => {
  assert.deepEqual(parseConc('claude=3,grok=1'), { claude: 3, opencode: 6, grok: 1 });
  assert.deepEqual(parseConc(undefined), { claude: 6, opencode: 6, grok: 3 });
  assert.throws(() => parseConc('gemini=2'), /bad --conc/);
  assert.throws(() => parseConc('claude=0'), /bad --conc/);
});

// ---- runners ------------------------------------------------------------------------------------

// A stand-in for a CLI: it answers with a report of how it was called, so the test can check the flags.
function fakeBin(dir, name, source) {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\nconst { readFileSync, writeFileSync, appendFileSync } = require('node:fs');\n${source}\n`);
  chmodSync(path, 0o755);
  return path;
}
const readStdin = 'const stdin = readFileSync(0, "utf8");';

async function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('backendOf names the backend and refuses the rest', () => {
  assert.equal(backendOf('claude:haiku'), 'claude');
  assert.equal(backendOf('opencode:opencode-go/gpt-6-luna'), 'opencode');
  assert.equal(backendOf('grok'), 'grok');
  assert.equal(backendOf('grok:grok-4.6'), 'grok');
  for (const bad of ['claude', 'opencode', 'gemini:pro', '', 'haiku']) assert.throws(() => backendOf(bad), /unknown model/, bad);
});

test('claude is called with no tools, no settings, the plain system prompt and the bridge guard', async t => {
  const dir = tmp(t);
  const bin = fakeBin(dir, 'claude', `${readStdin}
const out = { type: 'result', subtype: 'success', is_error: false, usage: { output_tokens: 7 }, modelUsage: { 'claude-test-1': {} },
  result: JSON.stringify({ argv: process.argv.slice(2), bridge: process.env.CODEX_BRIDGE, cwd: process.cwd(), stdin }) };
console.log(JSON.stringify(out));`);
  await withEnv({ DYSLEXIC_CLAUDE_BIN: bin }, async () => {
    const res = await runText({ model: 'claude:opus', prompt: '-leading dash\nsecond line' });
    const seen = JSON.parse(res.text);
    const arg = flag => seen.argv[seen.argv.indexOf(flag) + 1];
    assert.equal(seen.argv[0], '-p');
    assert.equal(arg('--model'), 'opus');
    assert.equal(arg('--tools'), '');
    assert.equal(arg('--setting-sources'), '');
    assert.equal(arg('--system-prompt'), SYSTEM);
    assert.equal(arg('--output-format'), 'json');
    assert.ok(seen.argv.includes('--no-session-persistence'));
    assert.equal(seen.bridge, '1');
    assert.match(seen.cwd, /bench[/\\]\.work[/\\]empty$/);
    assert.equal(seen.stdin, '-leading dash\nsecond line', 'the prompt goes on stdin, so a leading dash is never a flag');
    assert.equal(res.outTokens, 7);
    assert.equal(res.modelId, 'claude-test-1');
    assert.ok(res.ms >= 0);
  });
});

test('a failed call is tried once more, a quota error is not, and a hung call is killed', async t => {
  const dir = tmp(t);
  const counter = join(dir, 'count'), pidfile = join(dir, 'pid');
  const bin = fakeBin(dir, 'claude', `${readStdin}
appendFileSync(${JSON.stringify(counter)}, 'x');
const n = readFileSync(${JSON.stringify(counter)}, 'utf8').length;
const mode = stdin.trim();
if (mode === 'flaky' && n < 2) process.exit(1);
if (mode === 'quota') { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached' })); process.exit(0); }
if (mode === 'hang') { writeFileSync(${JSON.stringify(pidfile)}, String(process.pid)); setTimeout(() => {}, 60000); return; }
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'fine', usage: { output_tokens: 1 } }));`);
  const tries = () => (existsSync(counter) ? readFileSync(counter, 'utf8').length : 0);
  const reset = () => writeFileSync(counter, '');
  await withEnv({ DYSLEXIC_CLAUDE_BIN: bin, BENCH_RETRY_MS: '0' }, async () => {
    reset();
    assert.equal((await runText({ model: 'claude:haiku', prompt: 'flaky' })).text, 'fine');
    assert.equal(tries(), 2, 'one retry');

    reset();
    await assert.rejects(runText({ model: 'claude:haiku', prompt: 'quota' }), err => err.fatal === true && /usage limit/.test(err.message));
    assert.equal(tries(), 1, 'no retry for a limit');

    reset();
    const t0 = Date.now();
    await assert.rejects(runText({ model: 'claude:haiku', prompt: 'hang', timeoutMs: 400 }), /timed out after 400 ms/);
    // Two waits of 400 ms, one for each try, whether or not a try got as far as counting itself:
    // on a busy machine node can need longer than that to start.
    const took = Date.now() - t0;
    assert.ok(took >= 780 && took < 5000, `a timeout is retried once too (took ${took} ms)`);
    assert.ok(tries() <= 2, 'and no more than once');
    if (existsSync(pidfile)) {
      const pid = Number(readFileSync(pidfile, 'utf8'));
      let alive = true;
      for (let i = 0; i < 40 && alive; i++) {
        try { process.kill(pid, 0); await sleep(50); } catch { alive = false; }
      }
      assert.equal(alive, false, 'the hung process is gone');
    }
  });
  await withEnv({ DYSLEXIC_CLAUDE_BIN: join(dir, 'missing') }, async () => {
    await assert.rejects(runText({ model: 'claude:haiku', prompt: 'x' }), err => err.fatal === true && /ENOENT/.test(err.message));
  });
});

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('runImage sends one user message with an image block and a text block', async t => {
  const dir = tmp(t);
  const png = join(dir, 'p.png');
  writeFileSync(png, PNG);
  const bin = fakeBin(dir, 'claude', `${readStdin}
const events = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} },
  { type: 'result', subtype: 'success', is_error: false, usage: { output_tokens: 4 }, result: JSON.stringify({ argv: process.argv.slice(2), lines: stdin.trim().split('\\n') }) }];
for (const e of events) console.log(JSON.stringify(e));`);
  await withEnv({ DYSLEXIC_CLAUDE_BIN: bin }, async () => {
    const res = await runImage({ model: 'claude:haiku', pngPath: png, prompt: 'What colour?' });
    const seen = JSON.parse(res.text);
    for (const [flag, value] of [['--input-format', 'stream-json'], ['--output-format', 'stream-json']]) assert.equal(seen.argv[seen.argv.indexOf(flag) + 1], value);
    assert.ok(seen.argv.includes('--verbose'));
    assert.equal(seen.argv[seen.argv.indexOf('--tools') + 1], '');
    assert.equal(seen.lines.length, 1, 'one message');
    const msg = JSON.parse(seen.lines[0]);
    assert.equal(msg.type, 'user');
    assert.equal(msg.message.role, 'user');
    assert.deepEqual(msg.message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
    assert.deepEqual(msg.message.content[1], { type: 'text', text: 'What colour?' });
    assert.equal(res.outTokens, 4);
    await assert.rejects(async () => runImage({ model: 'grok', pngPath: png, prompt: 'x' }), /only wired for claude/);
  });
});

test('opencode runs as a private agent with every tool denied, from a closed stdin', async t => {
  const dir = tmp(t);
  const bin = fakeBin(dir, 'opencode', `
// An open stdin would hang here: the real CLI waits for it to end.
let stdinEnded = false;
process.stdin.on('data', () => {});
process.stdin.on('end', () => { stdinEnded = true; });
setTimeout(() => {
  const config = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, 'utf8'));
  const report = { argv: process.argv.slice(2), stdinEnded, config,
    env: { project: process.env.OPENCODE_DISABLE_PROJECT_CONFIG, claude: process.env.OPENCODE_DISABLE_CLAUDE_CODE }, cwd: process.cwd() };
  for (const e of [{ type: 'step_start', part: {} }, { type: 'text', part: { type: 'text', text: JSON.stringify(report) } },
    { type: 'step_finish', part: { tokens: { input: 9, output: 11, reasoning: 4 } } }]) console.log(JSON.stringify(e));
}, 100);`);
  await withEnv({ DYSLEXIC_OPENCODE_BIN: bin }, async () => {
    const res = await runText({ model: 'opencode:opencode-go/gpt-6-luna', prompt: 'Q?\nsecond line' });
    const seen = JSON.parse(res.text);
    assert.deepEqual(seen.argv, ['run', '--standalone', '--agent', 'bench', '-m', 'opencode-go/gpt-6-luna', '--format', 'json', 'Q?\nsecond line']);
    assert.equal(seen.stdinEnded, true);
    assert.deepEqual(seen.config.agents.bench, { mode: 'primary', system: SYSTEM, permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
    assert.equal(seen.env.project, '1');
    assert.equal(seen.env.claude, '1');
    assert.match(seen.cwd, /bench[/\\]\.work[/\\]empty$/);
    assert.equal(res.outTokens, 15, 'output plus reasoning');
  });
});

test('opencode output: a reply, a quota error, a tool call and an empty run', () => {
  const run = events => ({ stdout: events.map(e => JSON.stringify(e)).join('\n') + '\n', stderr: '', code: 0, timedOut: false });
  const quota = { type: 'error', error: { type: 'provider.quota', message: 'Go usage limit exceeded', status: 429, retryAfterMs: 444211000 } };
  assert.deepEqual(parseOpencode(run([{ type: 'text', part: { text: 'a' } }, { type: 'text', part: { text: 'b' } }])), { text: 'a\n\nb', outTokens: null }, 'no step_finish, no count');
  assert.equal(parseOpencode(run([{ type: 'text', part: { text: 'a' } }, { type: 'step_finish', part: { tokens: { output: 0 } } }])).outTokens, 0, 'a reported zero is a zero');
  assert.throws(() => parseOpencode(run([{ type: 'step_start' }, quota])), err => err.fatal === true && /Go usage limit exceeded, retry in 123 h/.test(err.message));
  assert.throws(() => parseOpencode(run([{ type: 'error', error: { type: 'provider.free-limit', message: 'Free usage limit reached', status: 429 } }])), err => err.fatal === true);
  assert.throws(() => parseOpencode(run([{ type: 'error', error: { type: 'provider.quota', message: 'Insufficient account funds', status: 402 } }])), err => err.fatal === true);
  assert.throws(() => parseOpencode(run([{ type: 'error', error: { type: 'unknown', message: 'Agent not found: "bench"' } }])), err => err.fatal === false);
  assert.throws(() => parseOpencode(run([{ type: 'tool_use', part: { tool: 'shell' } }, { type: 'text', part: { text: 'done' } }])), /used a tool/);
  assert.throws(() => parseOpencode(run([{ type: 'step_start' }])), /no text/);
  assert.throws(() => parseOpencode({ stdout: '', stderr: '\u001b[31mboom\u001b[0m', code: 1, timedOut: false }), err => /boom/.test(err.message) && !err.message.includes('\u001b'));
  assert.throws(() => parseOpencode({ stdout: '', stderr: '', code: null, timedOut: true }, 500), /timed out after 500 ms/);
  assert.equal(parseOpencode({ stdout: '\u001b[1mplain\u001b[0m\n', stderr: '', code: 0, timedOut: false }).text, 'plain', 'an old build that prints plain text');
});

test('grok is called with every tool removed, one turn, no permission asks and the plain prompt', async t => {
  const dir = tmp(t);
  const bin = fakeBin(dir, 'grok', `
const report = { argv: process.argv.slice(2), env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GROK_'))) };
console.log(JSON.stringify({ text: JSON.stringify(report), stopReason: 'end_turn', num_turns: 1, usage: { output_tokens: 6, reasoning_tokens: 30 }, modelUsage: { 'grok-test': {} } }));`);
  await withEnv({ DYSLEXIC_GROK_BIN: bin }, async () => {
    const res = await runText({ model: 'grok', prompt: 'Q?' });
    const seen = JSON.parse(res.text);
    const arg = flag => seen.argv[seen.argv.indexOf(flag) + 1];
    assert.equal(arg('-p'), 'Q?');
    assert.equal(arg('--output-format'), 'json');
    for (const tool of ['run_terminal_command', 'read_file', 'search_replace', 'write', 'spawn_subagent', 'web_search']) assert.ok(arg('--disallowed-tools').split(',').includes(tool), tool);
    assert.equal(arg('--permission-mode'), 'dontAsk');
    assert.equal(arg('--max-turns'), '1');
    assert.equal(arg('--system-prompt-override'), SYSTEM);
    for (const flag of ['--no-subagents', '--disable-web-search', '--no-plan']) assert.ok(seen.argv.includes(flag), flag);
    assert.ok(!seen.argv.includes('-m'), 'the default model is used for plain "grok"');
    assert.ok(!seen.argv.includes('--tools'), '--tools "" does nothing in grok');
    for (const k of ['GROK_CLAUDE_AGENTS_ENABLED', 'GROK_CLAUDE_RULES_ENABLED', 'GROK_CLAUDE_SKILLS_ENABLED', 'GROK_TURN_SUMMARY', 'GROK_TITLE_REFRESH', 'GROK_PROMPT_SUGGESTIONS', 'GROK_MEMORY']) assert.equal(seen.env[k], '0', k);
    assert.equal(res.outTokens, 36);
    assert.equal(res.modelId, 'grok-test');
    const named = JSON.parse((await runText({ model: 'grok:grok-4.6', prompt: 'Q?' })).text);
    assert.equal(named.argv[named.argv.indexOf('-m') + 1], 'grok-4.6');
  });
});

test('grok output: a reply, a second turn, an error and plain text', () => {
  const run = (stdout, code = 0) => ({ stdout, stderr: 'warn: x', code, timedOut: false });
  assert.deepEqual(parseGrok(run(JSON.stringify({ text: 'hi', num_turns: 1, usage: { output_tokens: 2 } }))), { text: 'hi', outTokens: 2, modelId: null });
  assert.throws(() => parseGrok(run(JSON.stringify({ text: 'hi', num_turns: 3 }))), /more than one turn/);
  assert.throws(() => parseGrok(run('', 1)), /grok exited 1/);
  assert.throws(() => parseGrok(run(JSON.stringify({ error: { message: 'not logged in' } }))), err => err.fatal === true);
  assert.equal(parseGrok(run('just text\n')).text, 'just text');
});

test('claude output: a result, an error result, and no result at all', () => {
  const run = (ev, code = 0) => ({ stdout: ev ? JSON.stringify(ev) : '', stderr: 'oops', code, timedOut: false });
  assert.equal(parseClaude(run({ subtype: 'success', is_error: false, result: 'x', usage: { output_tokens: 3 } })).outTokens, 3);
  assert.throws(() => parseClaude(run({ subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' })), err => err.fatal === false);
  assert.throws(() => parseClaude(run({ subtype: 'error_max_turns', is_error: false })), /error_max_turns/);
  assert.throws(() => parseClaude(run(null, 1)), /claude exited 1 with no result: oops/);
  assert.throws(() => parseClaude(run({ subtype: 'success', is_error: false, result: '' })), /empty reply/);
});

// ---- judge --------------------------------------------------------------------------------------

const usesRow = (cond, lines, extra = {}) => ({ model: 'claude:haiku', cond, id: 'uses-1', family: 'uses', got: lines.join('\n'), correct: null, formatOk: lines.length === 8, error: null, ...extra });
const list = tag => Array.from({ length: 8 }, (_, i) => `${tag} use ${i + 1}`);

test('the judge sees shuffled, labelled lists and never a condition name', () => {
  const prompt = judgePrompt('a shoelace', [{ label: 'A', lines: list('first') }, { label: 'B', lines: list('second') }]);
  assert.match(prompt, /two lists of unusual uses for a shoelace|2 lists of unusual uses for a shoelace/);
  assert.match(prompt, /List A\n1\. first use 1/);
  assert.match(prompt, /RANKING: A > B$/);
  for (const name of ['base', 'careful', 'dyslexic', 'explorer', 'claude']) assert.ok(!prompt.includes(name), name);
});

test('parseRanking wants every label exactly once after the last RANKING:', () => {
  const L = ['A', 'B', 'C'];
  assert.deepEqual(parseRanking('Good.\nRANKING: B > A > C', L), ['B', 'A', 'C']);
  assert.deepEqual(parseRanking('ranking: c, a, b', L), ['C', 'A', 'B']);
  assert.deepEqual(parseRanking('**RANKING:** B > C > A', L), ['B', 'C', 'A']);
  assert.deepEqual(parseRanking('RANKING: A > B > C\nlater\nRANKING: C > B > A', L), ['C', 'B', 'A']);
  assert.equal(parseRanking('RANKING: A > B', L), null);
  assert.equal(parseRanking('RANKING: A > A > B', L), null);
  assert.equal(parseRanking('RANKING: A > B > C > D', L), null);
  assert.equal(parseRanking('no ranking here', L), null);
});

test('judgeGroup maps a ranking back to conditions, with a different order for each judge', async () => {
  const rows = [usesRow('base', list('b')), usesRow('careful', list('c')), usesRow('dyslexic', list('d')), usesRow('explorer', list('e')), usesRow('vote3', list('v'))];
  const [group] = groups(rows);
  assert.equal(group.lists.length, 5);
  const run = async (judge, ask = (labels) => labels.join(' > ')) => {
    const seen = [];
    const runText = async ({ prompt }) => {
      seen.push(prompt);
      const labels = [...prompt.matchAll(/^List ([A-Z])$/gm)].map(m => m[1]);
      return { text: `Fine.\nRANKING: ${ask(labels)}` };
    };
    return { row: await judgeGroup({ group, judge, runText }), seen };
  };
  const a = await run('claude:sonnet'), b = await run('opencode:x/y'), again = await run('claude:sonnet');
  assert.deepEqual(a.row.labels, again.row.labels, 'the same judge gets the same order every time');
  assert.notDeepEqual(a.row.labels, b.row.labels, 'another judge gets another order');
  // The judge ranked in label order, so the first label's condition has rank 1.
  const byRank = Object.entries(a.row.ranks).sort((x, y) => x[1] - y[1]).map(e => e[0]);
  assert.deepEqual(byRank, 'ABCDE'.split('').map(l => a.row.labels[l]));
  assert.equal(a.row.object, 'a shoelace');
  assert.equal(a.row.error, null);
  const first = a.seen[0].match(/List A\n1\. (\w) use/)[1];
  assert.equal(first, a.row.labels.A[0] === 'v' ? 'v' : { base: 'b', careful: 'c', dyslexic: 'd', explorer: 'e', vote3: 'v' }[a.row.labels.A]);
  await assert.rejects(judgeGroup({ group, judge: 'j', runText: async () => ({ text: 'RANKING: A > B' }) }), /no usable ranking/);
});

test('groups keeps only well-formed lists and judgeAll is resumable', async t => {
  const rows = [
    usesRow('base', list('b')), usesRow('careful', list('c')), usesRow('dyslexic', list('d')),
    usesRow('strong', list('s').slice(0, 5)), usesRow('extreme', list('x'), { error: 'boom' }),
    { ...usesRow('base', list('z')), id: 'uses-2' },
    { model: 'claude:haiku', cond: 'base', id: 'walk-1-0', family: 'walk', got: '1,2,north', correct: true, formatOk: true, error: null },
  ];
  const gs = groups(rows);
  assert.equal(gs.length, 1, 'a single list cannot be ranked');
  assert.deepEqual(gs[0].lists.map(l => l.cond), ['base', 'careful', 'dyslexic']);

  const out = join(tmp(t), 'j.judge.jsonl');
  let calls = 0, failFirst = true;
  const runText = async ({ prompt }) => {
    calls++;
    if (failFirst && calls === 1) return { text: 'cannot decide' };
    return { text: `RANKING: ${[...prompt.matchAll(/^List ([A-Z])$/gm)].map(m => m[1]).reverse().join(' > ')}` };
  };
  const first = await judgeAll({ rows, judges: ['j1', 'j2'], runText, out, log: quiet });
  assert.deepEqual({ groups: first.groups, calls: first.calls, errors: first.errors }, { groups: 1, calls: 2, errors: 1 });
  assert.equal(readRows(out, r => `${r.model}|${r.id}|${r.judge}`).length, 2, 'both judges keep their own row');
  failFirst = false;
  const second = await judgeAll({ rows, judges: ['j1', 'j2'], runText, out, log: quiet });
  assert.equal(second.calls, 1, 'only the failed judge is asked again');
  const third = await judgeAll({ rows, judges: ['j1', 'j2'], runText, out, log: quiet });
  assert.equal(third.calls, 0);
  assert.ok(third.rows.every(r => !r.error && r.ranks));
  assert.equal((await judgeAll({ rows, judges: ['j3'], runText, out, limit: 0, log: quiet })).calls, 0, '--limit 0 asks for nothing');
});

// ---- report -------------------------------------------------------------------------------------

function sampleRows() {
  const rows = [];
  const put = (model, cond, id, family, correct, extra = {}) => rows.push({
    model, cond, id, family, answer: 'x', got: 'x', correct, formatOk: true, ms: 1000, calls: 1, chars: 200, text: 't', error: null, outTokens: 50, modelId: `${model}-id`, ...extra,
  });
  // base gets 6 of 10, dyslexic 9 of 10 (3 only dyslexic, 0 only base), careful 5 of 10.
  for (let i = 0; i < 10; i++) {
    for (const model of ['claude:haiku', 'claude:opus']) {
      const fam = i < 5 ? 'walk' : 'dice';
      put(model, 'base', `q${i}`, fam, i < 6);
      put(model, 'careful', `q${i}`, fam, i < 5);
      put(model, 'dyslexic', `q${i}`, fam, i < 9, { ms: 2000, calls: 1 });
      put(model, 'vote3', `q${i}`, fam, i < 6, { calls: 3, ms: 1500 });
    }
  }
  put('claude:haiku', 'base', 'qerr', 'walk', null, { error: 'quota gone', formatOk: false });
  for (const cond of ['base', 'careful', 'dyslexic', 'vote3']) put('claude:haiku', cond, 'uses-1', 'uses', null, { formatOk: cond !== 'careful', got: 'a\nb' });
  return rows;
}

test('report: the numbers in the tables are the numbers in the rows', () => {
  const a = analyze(sampleRows());
  assert.deepEqual(a.conds, ['base', 'careful', 'dyslexic', 'vote3']);
  assert.deepEqual(a.models, ['claude:haiku', 'claude:opus']);
  assert.deepEqual(a.families, ['walk', 'dice', 'uses']);
  assert.equal(a.counts.errors, 1);
  assert.equal(a.errorsBy['claude:haiku'], 1);
  assert.deepEqual([a.pooled.base.all.k, a.pooled.base.all.n], [12, 20]);
  assert.deepEqual([a.pooled.dyslexic.all.k, a.pooled.dyslexic.all.n], [18, 20]);
  assert.deepEqual([a.pooled.dyslexic['claude:opus'].k, a.pooled.dyslexic['claude:opus'].n], [9, 10]);
  assert.deepEqual([a.byFamily.walk.base.all.k, a.byFamily.walk.base.all.n], [10, 10]);
  assert.deepEqual([a.byFamily.dice.base.all.k, a.byFamily.dice.base.all.n], [2, 10]);
  assert.equal(a.byFamily.uses, undefined);
  const t = a.tests.base.dyslexic.all;
  assert.deepEqual([t.n, t.aOnly, t.bOnly], [20, 6, 0]);
  assert.equal(t.p, signTest(6, 0));
  assert.equal(verdict(t), 'clearly better');
  assert.equal(verdict(a.tests.base.careful.all), 'too few to tell');
  assert.equal(verdict({ aOnly: 5, bOnly: 0, p: 0.0625, diff: 0.5 }), 'too few to tell', 'five to nothing is still p = 0.06');
  assert.equal(verdict({ aOnly: 4, bOnly: 4, p: 1, diff: 0 }), 'no clear difference');
  assert.equal(verdict({ aOnly: 8, bOnly: 8, p: 1, diff: 0 }), 'no clear difference');
  assert.equal(verdict({ aOnly: 1, bOnly: 9, p: 0.02, diff: -0.4 }), 'clearly worse');
  assert.equal(a.tests.base.base, undefined, 'a condition is not tested against itself');
  assert.equal(a.cost.vote3.calls, 3 * 20 / 21 + (1 / 21), 'calls: twenty jobs of three and one use list of one');
  assert.equal(a.cost.dyslexic.ms, 2000);
  assert.equal(a.cost.careful.formatOk, 20 / 21);
  assert.deepEqual(a.uses.formatOk.careful, { k: 0, n: 1 });
  assert.deepEqual(a.modelIds['claude:opus'], ['claude:opus-id']);
});

test('report: markdown has every table and no stray undefined or NaN', () => {
  const judge = [
    { model: 'claude:haiku', id: 'uses-1', judge: 'claude:sonnet', ranks: { base: 3, careful: 4, dyslexic: 1, vote3: 2 }, error: null },
    { model: 'claude:haiku', id: 'uses-1', judge: 'opencode:x/y', ranks: { base: 2, careful: 3, dyslexic: 1, vote3: 4 }, error: null },
    { model: 'claude:haiku', id: 'uses-1', judge: 'bad', ranks: null, error: 'boom' },
  ];
  const md = renderMarkdown(analyze(sampleRows(), judge));
  for (const h of ['# Does thinking', '## All families together', '## walk', '## dice', '## Against base', '## Against careful', '## Time and length', '## Creative uses', '## Read this carefully']) assert.ok(md.includes(h), h);
  assert.match(md, /\| base\s+\| +6\/10 \(60%\) \| +6\/10 \(60%\) \| +12\/20 \(60%\) \|/);
  assert.match(md, /\| dyslexic\s+\| +9\/10 \(90%\) \| +9\/10 \(90%\) \| +18\/20 \(90%\) \|/);
  assert.match(md, /\| base\s+\| +5\/5 \| +5\/5 \| +10\/10 \|/, 'family tables show right/total only');
  assert.match(md, /\+6 \/ -0, p 0\.031/);
  assert.match(md, /\| dyslexic\s+\| +2 \| +1\.00 \| +2 \| +1\.00 \| +1\.00 \|/, 'ranked first by both judges');
  assert.match(md, /\| base\s+\| +2 \| +2\.50 \| +0 \| +3\.00 \| +2\.00 \|/, 'ranks 3 and 2 make 2.5');
  assert.match(md, /Failed jobs by model: claude:haiku 1, claude:opus 0\. For example: "quota gone"/);
  assert.match(md, /claude:haiku \(claude:haiku-id\)/);
  assert.ok(!/undefined|NaN/.test(md));
  assert.ok(md.endsWith('\n'));
  const noJudge = renderMarkdown(analyze(sampleRows()));
  assert.match(noJudge, /No judge file was given/);
});

test('report: the page is readable on its own and says the verdict in words', () => {
  const html = renderHtml(analyze(sampleRows()));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /font-variant-numeric:tabular-nums/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /Best score: dyslexic, 90% right\./);
  assert.match(html, /base scored 60%\./);
  assert.match(html, /▲ dyslexic against base: clearly better\./);
  assert.match(html, /6 questions better, 0 worse \(p = 0\.031\)\./);
  assert.match(html, /<div class="verdict good">/);
  assert.match(html, /<td class="good">clearly better<\/td>/);
  assert.match(html, /▲ dyslexic/);
  assert.match(html, /<div class="bar"><span style="width:90\.0%"><\/span><i class="tick" style="left:60\.0%"><\/i><i class="ci" style="left:69\.9%;width:27\.3%"><\/i><\/div>/, 'bar, base tick and the Wilson interval for 18 of 20');
  assert.ok(!/undefined|NaN/.test(html));
  // One matrix, tinted against base, with an arrow so the colour is never the only signal.
  assert.match(html, /<h2>Where it helps<\/h2>/);
  assert.match(html, /<td class="good">▲ 8\/10<\/td>/, 'dyslexic on dice: 8 of 10 against base 2 of 10');
  assert.match(html, /<td class="bad">▼ 0\/10<\/td>/, 'careful is below base on dice');
  assert.match(html, /<td class="">10\/10<\/td>/, 'level with base on walk: no tint, no arrow');
  assert.match(html, /<th title="claude:haiku">haiku<\/th>/, 'short model names, full name on hover');
  assert.ok(!html.includes('<th>claude:haiku</th>'));
  assert.ok(!/<script/.test(html), 'no scripts, nothing to load');
  // Text typed into a result cannot break the page.
  const evil = sampleRows().map(r => ({ ...r, cond: r.cond === 'vote3' ? '<b>vote3</b>' : r.cond }));
  const page = renderHtml(analyze(evil));
  assert.ok(!page.includes('<b>vote3</b>'));
  assert.ok(page.includes('&lt;b&gt;vote3&lt;/b&gt;'));
  assert.match(renderHtml(analyze([])), /Not enough finished jobs/);
});

test('the families list is the seven the brief names', () => {
  assert.deepEqual(FAMILIES, ['walk', 'dice', 'pattern', 'arith', 'letters', 'trick', 'uses']);
  assert.equal(seedFrom('a'), seedFrom('a'));
  assert.notEqual(seedFrom('walk-1-0'), seedFrom('walk-1-1'));
  const c = cost([{ ms: 10, chars: 5, calls: 1, outTokens: 2 }, { ms: 30, chars: 15, calls: 3, outTokens: 4 }, { error: 'x', ms: 1e9 }]);
  assert.deepEqual(c, { n: 2, ms: 20, chars: 10, calls: 2, outTokens: 3 });
});
