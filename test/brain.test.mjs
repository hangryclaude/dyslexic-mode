import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrain, field, wordSkin, DOT } from '../lib/brain.mjs';
import { paint, brainLines, TURN } from '../lib/anim.mjs';

const visible = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the brain is solid inside and empty far away', () => {
  assert.ok(field(0.3, 0.1, 0) < 0);
  assert.ok(field(0, 0, 3) > 0);
});

test('a frame fills the middle and leaves the corners empty', () => {
  const g = renderBrain({ cols: 34, rows: 15 });
  assert.equal(g.length, 15);
  assert.ok(g.every(r => r.length === 34));
  assert.ok(g[7][17]);
  assert.equal(g[0][0], null);
  assert.equal(g[14][33], null);
  const share = g.flat().filter(Boolean).length / (34 * 15);
  assert.ok(share > 0.25 && share < 0.8, `brain covers ${share}`);
});

test('the same angle draws the same frame, and a new angle changes it', () => {
  const chars = g => g.map(r => r.map(c => (c ? c.ch : ' ')).join('')).join('\n');
  const a = chars(renderBrain({ cols: 30, rows: 12, angle: 0.5 }));
  assert.equal(a, chars(renderBrain({ cols: 30, rows: 12, angle: 0.5 })));
  assert.notEqual(a, chars(renderBrain({ cols: 30, rows: 12, angle: 1.5 })));
});

test('cells carry a shading character, a light level and a hue', () => {
  for (const c of renderBrain({ cols: 30, rows: 12, pulse: 0.5 }).flat().filter(Boolean)) {
    assert.match(c.ch, /^[.:\-=+*#%@]$/);
    assert.ok(c.lum >= 0 && c.lum <= 1);
    assert.ok(Number.isFinite(c.hue));
  }
});

test('paint keeps every row exactly as wide as the grid', () => {
  const rows = paint(renderBrain({ cols: 40, rows: 14, angle: 1 }));
  assert.ok(rows.every(r => visible(r).length === 40));
});

test('a full-screen frame renders fast enough to animate', () => {
  const t = performance.now();
  renderBrain({ cols: 160, rows: 45, angle: 0.3, pulse: 0.2 });
  const ms = performance.now() - t;
  assert.ok(ms < 250, `${ms.toFixed(0)}ms`);
});

const WORDS = [
  { name: 'Claude Opus', color: [217, 119, 87] },
  { name: 'GPT-5', color: [16, 163, 127] },
  { name: 'Gemini 4 Argon', color: [66, 133, 244] },
  { name: 'Grok 4.7', color: [200, 200, 200] },
];

// The names on a frame: each run of cells that share one word colour.
const namesOn = frame => frame.flatMap(row => {
  const found = [];
  let run = null;
  for (const c of [...row, null]) {
    if (c && c.rgb !== DOT && run && c.rgb === run.rgb) run.text += c.ch;
    else {
      if (run) found.push(run);
      run = c && c.rgb !== DOT ? { text: c.ch, rgb: c.rgb } : null;
    }
  }
  return found;
});

test('a brain written in names shows every name whole, in its own colour', () => {
  const skin = wordSkin(WORDS, { cols: 76, rows: 30 });
  for (const angle of [0, 1, 2.5, 4]) {
    const names = namesOn(skin(renderBrain({ cols: 76, rows: 30, angle }), { angle }));
    assert.ok(names.length >= 3, `only ${names.length} names at angle ${angle}`);
    for (const { text, rgb } of names) assert.ok(WORDS.some(w => w.name === text && w.color === rgb), `"${text}" is not a whole name`);
  }
});

test('the same turn writes the same names in the same places', () => {
  const draw = () => wordSkin(WORDS, { cols: 60, rows: 24 })(renderBrain({ cols: 60, rows: 24, angle: 1.2 }), { angle: 1.2 });
  assert.deepEqual(draw(), draw());
});

test('the brain turns once in TURN frames, so a recording of them loops without a seam', () => {
  const at = f => brainLines({ cols: 60, rows: 24, f, words: WORDS, caption: [['turn your agent dyslexic', s => s]] });
  assert.deepEqual(at(TURN), at(0));
  assert.notDeepEqual(at(1), at(0));
  assert.equal(at(0).length, 24);
  assert.equal(visible(at(0).at(-1)).trim(), 'turn your agent dyslexic');
});
