import { mulberry32 } from '../lib/thinking.mjs';

// Every family has a key a machine can compute, so a wrong reply means the model slipped, not the key.
// An item is plain data: { id, family, prompt, ask, format, answer }. `prompt` is the whole question,
// `ask` is its last sentence alone (for a condition that shows the setup as a picture), and `format`
// is the line every condition appends so replies end in something score() can read.
export const FAMILIES = ['walk', 'dice', 'pattern', 'arith', 'letters', 'trick', 'uses'];

// FNV-1a. Item i of a family is seeded by its own name, so asking for more items never changes the
// first ones and two runs with different --per still share ids.
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)];

// Fisher-Yates with the seeded generator, so a shuffled job list or answer order can be reproduced.
export function shuffled(xs, seed) {
  const a = [...xs], rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const LINE = 'End your reply with one line in exactly this form:';

// ---- walk: turns and steps on a grid ----------------------------------------------------------

const DIRS = ['north', 'east', 'south', 'west'];
const VEC = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const steps = n => `${n} ${n === 1 ? 'step' : 'steps'}`;
const WALK_TEXT = {
  left: () => 'Turn left.',
  right: () => 'Turn right.',
  around: () => 'Turn around.',
  forward: n => `Walk forward ${steps(n)}.`,
  backward: n => `Step backward ${steps(n)}, still facing the same way.`,
  sideleft: n => `Sidestep left ${steps(n)}, still facing the same way.`,
  sideright: n => `Sidestep right ${steps(n)}, still facing the same way.`,
};
const TURNS = ['left', 'right', 'around'];

// Scale 1 is the size the brief fixes. A bigger scale stretches walk, dice, arith and letters for a
// model that already gets nearly every standard item right: a style cannot show it helps where
// there is nothing left to gain. Turn it up until the strongest model's base score is mid-range.
const sizeAt = scale => ({ moves: 12 * scale, rolls: 7 * scale, ops: 6 * scale, words: 18 * scale, cap: 4000 * scale });

function walk(rand, size) {
  const kinds = Object.keys(WALK_TEXT);
  let moves;
  // Too few turns or too few steps makes a dull item, so draw again.
  do {
    moves = Array.from({ length: size.moves }, () => ({ kind: pick(rand, kinds), n: int(rand, 1, 5) }));
  } while (moves.filter(m => TURNS.includes(m.kind)).length < size.moves / 4 || moves.filter(m => !TURNS.includes(m.kind)).length < size.moves / 3);
  let x = 0, y = 0, d = 0;
  for (const { kind, n } of moves) {
    if (kind === 'left') d = (d + 3) % 4;
    else if (kind === 'right') d = (d + 1) % 4;
    else if (kind === 'around') d = (d + 2) % 4;
    else {
      const side = { forward: d, backward: (d + 2) % 4, sideleft: (d + 3) % 4, sideright: (d + 1) % 4 }[kind];
      x += n * VEC[side][0];
      y += n * VEC[side][1];
    }
  }
  const ask = 'After the last move, what are your x and y, and which way are you facing?';
  return {
    prompt: [
      'You start at x=0, y=0, facing north. The x axis grows toward the east and the y axis grows toward the north.',
      'You make these moves, in order:',
      ...moves.map((m, i) => `${i + 1}. ${WALK_TEXT[m.kind](m.n)}`),
      ask,
    ].join('\n'),
    ask,
    format: `${LINE} ANSWER: x,y,direction (for example ANSWER: 3,-2,east). The direction is north, east, south or west.`,
    answer: `${x},${y},${DIRS[d]}`,
  };
}

// ---- dice: faces that tip over edges ----------------------------------------------------------

const ROLL = {
  north: d => ({ ...d, top: d.south, north: d.top, bottom: d.north, south: d.bottom }),
  south: d => ({ ...d, top: d.north, south: d.top, bottom: d.south, north: d.bottom }),
  east: d => ({ ...d, top: d.west, east: d.top, bottom: d.east, west: d.bottom }),
  west: d => ({ ...d, top: d.east, west: d.top, bottom: d.west, east: d.bottom }),
};

function dice(rand, size) {
  const rolls = Array.from({ length: size.rolls }, () => pick(rand, DIRS));
  let die = { top: 1, bottom: 6, north: 2, south: 5, east: 3, west: 4 };
  for (const r of rolls) die = ROLL[r](die);
  const ask = 'After the last roll, which number is on top and which number faces north?';
  return {
    prompt: [
      'A standard six-sided die has opposite faces that add up to 7.',
      'It starts on a table with 1 on top, 6 on the bottom, 2 facing north, 5 facing south, 3 facing east and 4 facing west.',
      `You roll it ${size.rolls} times, one after the other. Rolling it in a direction means it tips over its edge on that side,`,
      'so the face that was on top ends up facing that direction. For example, rolling it north puts the old top face on the north side.',
      'The rolls, in order:',
      ...rolls.map((r, i) => `${i + 1}. ${r}`),
      ask,
    ].join('\n'),
    ask,
    format: `${LINE} ANSWER: top=<n>, north=<n> (for example ANSWER: top=4, north=2).`,
    answer: `top=${die.top}, north=${die.north}`,
  };
}

// ---- pattern: number rules --------------------------------------------------------------------

const digitSum = n => [...String(Math.abs(n))].reduce((s, c) => s + Number(c), 0);

const SEQUENCES = {
  // Two arithmetic sequences taking turns.
  interleave: {
    make: rand => ({ a: int(rand, 1, 12), da: int(rand, 2, 6), b: int(rand, 15, 60), db: pick(rand, [-7, -6, -5, -4, -3, 3, 4, 5, 7, 8]) }),
    terms: (p, len) => Array.from({ length: len }, (_, i) => (i % 2 === 0 ? p.a + p.da * (i / 2) : p.b + p.db * ((i - 1) / 2))),
  },
  // The gap between terms grows by a fixed step.
  gaps: {
    make: rand => ({ a: int(rand, 1, 20), g: int(rand, 1, 5), s: int(rand, 1, 4) }),
    terms: (p, len) => Array.from({ length: len }, (_, i) => p.a + p.g * i + (p.s * i * (i - 1)) / 2),
  },
  // Times m, then plus p, then times m again.
  timesPlus: {
    make: rand => ({ a: int(rand, 1, 6), m: int(rand, 2, 3), p: int(rand, 1, 9) }),
    terms: (p, len) => {
      const t = [p.a];
      while (t.length < len) t.push(t.length % 2 === 1 ? t.at(-1) * p.m : t.at(-1) + p.p);
      return t;
    },
  },
  // Each term is the sum of the two before it, plus a constant.
  sumPlus: {
    make: rand => ({ a: int(rand, 1, 6), b: int(rand, 2, 9), c: int(rand, 1, 5) }),
    terms: (p, len) => {
      const t = [p.a, p.b];
      while (t.length < len) t.push(t.at(-1) + t.at(-2) + p.c);
      return t;
    },
  },
  // Each term adds its own digit sum.
  digitSum: {
    make: rand => ({ a: int(rand, 3, 40) }),
    terms: (p, len) => {
      const t = [p.a];
      while (t.length < len) t.push(t.at(-1) + digitSum(t.at(-1)));
      return t;
    },
  },
  // Each term is twice the one before, minus k.
  doubleMinus: {
    make: rand => { const k = int(rand, 1, 9); return { k, a: k + int(rand, 1, 8) }; },
    terms: (p, len) => {
      const t = [p.a];
      while (t.length < len) t.push(2 * t.at(-1) - p.k);
      return t;
    },
  },
};

// Every way the shown terms could continue under any of the six rules, with any parameters. An item
// is only kept when this finds exactly one continuation, so "the answer" is never a matter of taste.
export function continuations(t) {
  const found = [];
  const add = pair => {
    if (pair && !found.some(f => f[0] === pair[0] && f[1] === pair[1])) found.push(pair);
  };
  const same = (xs, f) => xs.every((x, i) => f(x, i));
  const n = t.length;

  const sub = p => t.filter((_, i) => i % 2 === p);
  const evens = sub(0), odds = sub(1);
  const step = xs => xs[1] - xs[0];
  if (same(evens, (x, i) => x === evens[0] + step(evens) * i) && same(odds, (x, i) => x === odds[0] + step(odds) * i)) {
    const next = [n % 2 === 0 ? evens.at(-1) + step(evens) : odds.at(-1) + step(odds), n % 2 === 0 ? odds.at(-1) + step(odds) : evens.at(-1) + step(evens)];
    add(next);
  }

  const gap = t.slice(1).map((x, i) => x - t[i]);
  const s = gap[1] - gap[0];
  if (same(gap, (g, i) => g === gap[0] + s * i)) add([t.at(-1) + gap.at(-1) + s, t.at(-1) + 2 * gap.at(-1) + 3 * s]);

  // Times m then plus p, or plus p then times m: step i goes from t[i] to t[i + 1].
  for (const timesFirst of [true, false]) {
    const m = timesFirst ? t[1] / t[0] : t[2] / t[1], p = timesFirst ? t[2] - t[1] : t[1] - t[0];
    if (!Number.isInteger(m) || m === 0) continue;
    const op = (x, i) => ((i + (timesFirst ? 0 : 1)) % 2 === 0 ? x * m : x + p);
    if (same(t.slice(1), (x, i) => x === op(t[i], i))) {
      const a = op(t.at(-1), n - 1);
      add([a, op(a, n)]);
    }
  }

  const c = t[2] - t[1] - t[0];
  if (same(t.slice(2), (x, i) => x === t[i + 1] + t[i] + c)) {
    const a = t.at(-1) + t.at(-2) + c;
    add([a, a + t.at(-1) + c]);
  }

  if (same(t.slice(1), (x, i) => x === t[i] + digitSum(t[i]))) {
    const a = t.at(-1) + digitSum(t.at(-1));
    add([a, a + digitSum(a)]);
  }

  const k = 2 * t[0] - t[1];
  if (same(t.slice(1), (x, i) => x === 2 * t[i] - k)) {
    const a = 2 * t.at(-1) - k;
    add([a, 2 * a - k]);
  }
  return found;
}

function pattern(rand) {
  const names = Object.keys(SEQUENCES);
  for (;;) {
    const name = pick(rand, names);
    const rule = SEQUENCES[name];
    const shown = int(rand, 7, 8);
    const all = rule.terms(rule.make(rand), shown + 2);
    if (all.some(v => v < 0 || v > 100000)) continue;
    const seen = all.slice(0, shown), answer = all.slice(shown);
    const next = continuations(seen);
    if (next.length !== 1 || next[0][0] !== answer[0] || next[0][1] !== answer[1]) continue;
    // "In order" because a model that works out both numbers right but lists them the other way round is slipping on the wording, not the rule.
    const ask = 'What are the next two numbers in the sequence, in the order they come?';
    return {
      prompt: ['The numbers below follow one fixed rule.', seen.join(', '), ask].join('\n'),
      ask,
      format: `${LINE} ANSWER: <n>, <n> (the next number first, then the one after it).`,
      answer: answer.join(', '),
    };
  }
}

// ---- arith: a story of small changes, then a fair share ----------------------------------------

const STORIES = [
  { place: 'A library', unit: 'books', bin: 'reading room' },
  { place: 'A farm', unit: 'eggs', bin: 'market stall' },
  { place: 'A shop', unit: 'apples', bin: 'basket' },
  { place: 'A school', unit: 'pencils', bin: 'classroom' },
];
const PARTS = { half: 2, third: 3, quarter: 4, fifth: 5 };
const PART_TEXT = { half: 'half', third: 'a third', quarter: 'a quarter', fifth: 'a fifth' };
const GROWTH = [10, 20, 25, 50];
const rounding = op => op.kind in PARTS || op.kind === 'grow';

function arith(rand, size) {
  for (;;) {
    const story = pick(rand, STORIES);
    const start = int(rand, 120, 400);
    let v = start;
    const ops = [];
    while (ops.length < size.ops) {
      const kinds = ['boxes', 'lose', 'half', 'third', 'quarter', 'fifth', 'grow'];
      if (v < 600) kinds.push('double');
      const kind = pick(rand, kinds);
      if (kind === 'boxes') {
        const op = { kind, b: int(rand, 2, 6), p: int(rand, 6, 24) };
        v += op.b * op.p;
        ops.push(op);
      } else if (kind === 'lose') {
        const op = { kind, n: int(rand, 8, 60) };
        if (v - op.n < 40) continue;
        v -= op.n;
        ops.push(op);
      } else if (kind === 'grow') {
        const op = { kind, pct: pick(rand, GROWTH) };
        v += Math.floor((v * op.pct) / 100);
        ops.push(op);
      } else if (kind === 'double') {
        v *= 2;
        ops.push({ kind });
      } else {
        v -= Math.floor(v / PARTS[kind]);
        ops.push({ kind });
      }
    }
    const rooms = int(rand, 3, 7);
    if (ops.filter(rounding).length < size.ops / 3 || v < rooms * 5 || v > size.cap) continue;

    const { unit, bin } = story;
    const line = op => ({
      boxes: `It receives ${op.b} boxes with ${op.p} ${unit} in each box.`,
      lose: `${op.n} ${unit} are lost.`,
      grow: `The number of ${unit} grows by ${op.pct} percent. Round the growth down.`,
      double: `The number of ${unit} doubles.`,
    }[op.kind] ?? `It gives away ${PART_TEXT[op.kind]} of its ${unit}. Round the number given away down.`);
    const ask = `How many ${unit} go in each ${bin}?`;
    return {
      prompt: [
        `${story.place} has ${start} ${unit}.`,
        'Then, one after the other:',
        ...ops.map((op, i) => `${i + 1}. ${line(op)}`),
        `Then all the ${unit} are shared equally between ${rooms} ${bin}s. Any ${unit} left over are kept aside.`,
        ask,
      ].join('\n'),
      ask,
      format: `${LINE} ANSWER: <number>`,
      answer: String(Math.floor(v / rooms)),
    };
  }
}

// ---- letters: counting inside a sentence ---------------------------------------------------------

const WORDS = [
  'time', 'year', 'people', 'way', 'day', 'man', 'thing', 'woman', 'life', 'child', 'world', 'school', 'family', 'student',
  'group', 'country', 'problem', 'hand', 'part', 'place', 'case', 'week', 'company', 'system', 'program', 'question',
  'work', 'government', 'number', 'night', 'point', 'home', 'water', 'room', 'mother', 'area', 'money', 'story', 'fact',
  'month', 'lot', 'right', 'study', 'book', 'eye', 'job', 'word', 'business', 'issue', 'side', 'kind', 'head', 'house',
  'service', 'friend', 'father', 'power', 'hour', 'game', 'line', 'end', 'member', 'law', 'car', 'city', 'community',
  'name', 'team', 'minute', 'idea', 'kid', 'body', 'information', 'back', 'parent', 'face', 'others', 'level', 'office',
  'door', 'health', 'person', 'art', 'war', 'history', 'party', 'result', 'change', 'morning', 'reason', 'research',
  'girl', 'guy', 'moment', 'air', 'teacher', 'force', 'education', 'garden', 'river', 'window', 'bridge', 'market',
  'orange', 'silver', 'quiet', 'simple', 'bright', 'little', 'heavy', 'early', 'strange', 'warm',
  'Monday', 'London', 'Sarah', 'Paris', 'Tom', 'Africa', 'Friday', 'Ellen',
];
const LETTERS = ['e', 'a', 'r', 's', 't', 'n', 'o', 'i', 'l'];

function letters(rand, size) {
  const picked = [];
  while (picked.length < size.words) {
    const w = pick(rand, WORDS);
    if (w !== picked.at(-1)) picked.push(w);
  }
  const sentence = picked.join(' ').replace(/^./, c => c.toUpperCase()) + '.';
  const letter = pick(rand, LETTERS);
  const count = [...sentence.toLowerCase()].filter(c => c === letter).length;
  const ask = `How many times does the letter "${letter}" appear in the sentence?`;
  return {
    prompt: [`Here is a sentence: "${sentence}"`, 'Count capital letters too: "E" counts as an "e".', ask].join('\n'),
    ask,
    format: `${LINE} ANSWER: <number>`,
    answer: String(count),
  };
}

// ---- trick: famous riddles with the twist changed -----------------------------------------------

// Each one is a well-known riddle with one fact altered, so the remembered answer is wrong.
// `kind` says how score() reads the answer line.
const TRICKS = [
  {
    setup: 'A farmer stands on the bank of a river with a wolf, a goat and a cabbage. His boat is big enough to carry him and all three of them at once, and nothing gets eaten while he is with them.',
    ask: 'What is the smallest number of one-way crossings of the river needed to get everything across?',
    answer: '1', kind: 'number', form: '<number>',
  },
  {
    setup: 'A bat and a ball cost $1.10 in total. The bat costs $1.00.',
    ask: 'How much does the ball cost, in cents?',
    answer: '10', kind: 'cents', form: '<number of cents>',
  },
  {
    setup: 'You have an empty 3-litre jug, an empty 5-litre jug and a tap.',
    ask: 'What is the smallest number of times you must fill a jug from the tap to have exactly 3 litres of water in one jug?',
    answer: '1', kind: 'number', form: '<number>',
  },
  {
    setup: 'Three switches outside a closed room each control one of three light bulbs inside the room. The door of the room is made of clear glass, so from the switches you can see all three bulbs at all times.',
    ask: 'What is the smallest number of times you must go into the room to know which switch controls which bulb?',
    answer: '0', kind: 'number', form: '<number>',
  },
  {
    setup: 'A dead cat is put into a sealed box together with a radioactive atom, a Geiger counter and a flask of poison. The box is opened an hour later.',
    ask: 'What is the probability, in percent, that the cat is alive?',
    answer: '0', kind: 'percent', form: '<percent>',
  },
  {
    setup: 'In a game show there are three doors. Behind one door is a car, and behind the other two doors are goats. You pick door 1. The host does not know where the car is. He opens door 3 at random, and it happens to show a goat.',
    ask: 'If you switch to door 2, what is your chance of winning the car, in percent?',
    answer: '50', kind: 'percent', form: '<percent>',
  },
  {
    setup: '',
    ask: 'Which is heavier: one kilogram of steel or two kilograms of feathers?',
    answer: 'feathers', kind: 'feathers', form: 'steel or ANSWER: feathers',
  },
  {
    setup: 'A boy and his father are in a car crash. The father is unhurt and drives the boy to the hospital. The surgeon there, who is the boy\'s father, says: "I can operate on this boy, he is my son."',
    ask: 'How is the surgeon related to the boy?',
    answer: 'father', kind: 'father', form: '<how the surgeon is related to the boy, in one or two words>',
  },
];

const OBJECTS = ['a shoelace', 'an empty glass jar', 'a broken umbrella', 'a bedsheet'];

// ---- items --------------------------------------------------------------------------------------

// At scale 1 the ids and the seed text are what they were before scale existed, so the standard
// items, and every results file made from them, never change.
const generated = (family, build) => (seed, n, scale) => Array.from({ length: n }, (_, i) => ({
  id: `${family}-${seed}${scale > 1 ? `x${scale}` : ''}-${i}`,
  family,
  ...build(mulberry32(seedFrom(`${seed}|${family}|${i}${scale > 1 ? `|x${scale}` : ''}`)), sizeAt(scale)),
}));

const MAKERS = {
  walk: generated('walk', walk),
  dice: generated('dice', dice),
  // No size to turn up, so the same items and ids whichever level is asked for.
  pattern: (seed, n) => generated('pattern', pattern)(seed, n, 1),
  arith: generated('arith', arith),
  letters: generated('letters', letters),
  // Fixed families ignore the seed: the same eight riddles and four objects every time.
  trick: (_, n) => TRICKS.slice(0, n).map((t, i) => ({
    id: `trick-${i + 1}`,
    family: 'trick',
    prompt: t.setup ? `${t.setup} ${t.ask}` : t.ask,
    ask: t.ask,
    format: `${LINE} ANSWER: ${t.form}`,
    answer: t.answer,
  })),
  uses: (_, n) => OBJECTS.slice(0, n).map((o, i) => ({
    id: `uses-${i + 1}`,
    family: 'uses',
    prompt: `List exactly 8 creative, unusual uses for ${o}.`,
    ask: `List exactly 8 creative, unusual uses for ${o}.`,
    format: 'Write a line that says ANSWER: and then the 8 uses, one per line, with nothing after them.',
    answer: null,
  })),
};

// `scale` multiplies the length of walk, dice, arith and letters. Pattern, trick and uses have no
// size to turn up, so they are the same items at every scale.
export function makeItems({ seed = 1, perFamily = 8, families = FAMILIES, scale = 1 } = {}) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`scale must be a whole number of at least 1, not ${scale}`);
  return families.flatMap(family => {
    if (!MAKERS[family]) throw new Error(`unknown family: ${family}`);
    return MAKERS[family](seed, perFamily, scale);
  });
}

// What the uses family asks about, for the judge.
export const usesObject = id => OBJECTS[Number(id.split('-')[1]) - 1];

// ---- scoring ------------------------------------------------------------------------------------

// The reply is read from after its last "ANSWER:", in any case, so a model that quotes the format
// early and answers later is still read right. No marker: fall back to the last line, not format-ok.
export function lastAnswer(text) {
  let at = -1, len = 0;
  for (const m of text.matchAll(/answer\s*:/gi)) { at = m.index; len = m[0].length; }
  if (at >= 0) return { found: true, part: text.slice(at + len) };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return { found: false, part: lines.at(-1) ?? '' };
}

// Markdown noise and the unicode minus are what most often break a number read.
const clean = s => s.replace(/[*`_]/g, '').replace(/−/g, '-').trim();
const firstLine = part => clean(part.split('\n').map(clean).find(Boolean) ?? '');

const WORD_NUMBERS = Object.fromEntries([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
].map((w, i) => [w, i]).concat([['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90]]));

// First number in the line, with "1,234" read as one number and "three" read as 3.
function firstNumber(s) {
  const m = s.match(/-?\d[\d,]*(?:\.\d+)?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i);
  if (!m) return null;
  const raw = m[0].toLowerCase();
  return { raw, value: raw in WORD_NUMBERS ? WORD_NUMBERS[raw] : Number(raw.replace(/,/g, '')) };
}

// Cut an explanation off an answer line: "feathers (2 kg is more than 1 kg of steel)" says feathers.
const headline = s => s.split(/\(|\bbecause\b|\bsince\b|;|\s[-–—]\s/i)[0].trim();

// "$0.10" and "0.1" are dollars, "10" and "10 cents" and "10.0 cents" are cents.
const cents = s => {
  const n = firstNumber(s);
  if (!n) return null;
  return /\$/.test(s) || (/\./.test(n.raw) && n.value < 1) ? Math.round(n.value * 100) : n.value;
};

const percent = s => {
  const frac = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac && Number(frac[2])) return Math.round((1000 * Number(frac[1])) / Number(frac[2])) / 10;
  if (/\bhalf\b/i.test(s)) return 50;
  const n = firstNumber(s);
  if (!n) return null;
  return /\./.test(n.raw) && n.value <= 1 && !/%|percent/i.test(s) ? Math.round(n.value * 1000) / 10 : n.value;
};

const bare = s => s.replace(/\.$/, '').trim();

const READ = {
  walk(part, item) {
    const line = firstLine(part);
    const nums = line.match(/-?\d+/g), dir = line.match(/\b(north|east|south|west)\b/i);
    const ok = nums?.length >= 2 && !!dir;
    const got = ok ? `${Number(nums[0])},${Number(nums[1])},${dir[1].toLowerCase()}` : bare(line);
    return { got, ok, correct: got === item.answer };
  },
  dice(part, item) {
    const line = firstLine(part);
    const top = line.match(/top\D{0,6}([1-6])/i)?.[1], north = line.match(/north\D{0,6}([1-6])/i)?.[1];
    const loose = line.match(/[1-6]/g);
    const [t, n] = top && north ? [top, north] : loose?.length >= 2 ? [loose[0], loose[1]] : [null, null];
    const ok = t != null;
    const got = ok ? `top=${t}, north=${n}` : bare(line);
    return { got, ok, correct: got === item.answer };
  },
  pattern(part, item) {
    const line = firstLine(part);
    // "1,024" is one number, "13,17" is two: a comma only joins digits when exactly three follow.
    const nums = line.match(/-?\d{1,3}(?:,\d{3})+(?!\d)|-?\d+/g)?.map(x => Number(x.replace(/,/g, '')));
    const ok = nums?.length >= 2;
    const got = ok ? `${nums[0]}, ${nums[1]}` : bare(line);
    return { got, ok, correct: got === item.answer };
  },
  number(part, item) {
    const n = firstNumber(firstLine(part));
    const got = n ? String(n.value) : bare(firstLine(part));
    return { got, ok: !!n, correct: !!n && got === item.answer };
  },
  trick(part, item) {
    const line = firstLine(part);
    const kind = TRICKS[Number(item.id.split('-')[1]) - 1].kind;
    if (kind === 'feathers' || kind === 'father') {
      const said = headline(line);
      const yes = kind === 'feathers' ? /feather/i : /\b(father|dad|daddy)\b/i;
      const no = kind === 'feathers' ? /steel/i : /\b(mother|mom|mum|mommy|mummy)\b/i;
      const correct = yes.test(said) && !no.test(said);
      return { got: correct ? item.answer : bare(said).toLowerCase(), ok: said.length > 0, correct };
    }
    const value = kind === 'cents' ? cents(line) : kind === 'percent' ? percent(line) : firstNumber(line)?.value ?? null;
    const got = value == null ? bare(line) : String(value);
    return { got, ok: value != null, correct: value != null && got === item.answer };
  },
  uses(part) {
    // The first use may sit on the ANSWER line itself.
    const lines = part.split('\n').map(l => clean(l).replace(/^\s*(?:[-•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    return { got: lines.join('\n'), ok: lines.length === 8, correct: null };
  },
};

export function score(item, text) {
  const { found, part } = lastAnswer(text);
  const read = item.family === 'arith' || item.family === 'letters' ? READ.number : READ[item.family];
  if (!read) throw new Error(`unknown family: ${item.family}`);
  const r = read(part, item);
  return { correct: r.correct, got: r.got, formatOk: found && r.ok };
}
