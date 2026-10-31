import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU, distance, resolve } from '../lib/commands.mjs';
import { PALETTES, NAMES, grad, setPalette, nextPalette, randomPalette, palette } from '../lib/palette.mjs';
import { renderBrain, LOBES } from '../lib/brain.mjs';

const NAMES_TYPED = MENU.map(([n]) => n).filter(n => n !== '!');

test('a swapped pair of letters is one slip, not two', () => {
  assert.equal(distance('/calm', '/clam'), 1);
  assert.equal(distance('/brain', '/brian'), 1);
  assert.equal(distance('/test', '/test'), 0);
  assert.equal(distance('', 'abc'), 3);
});

test('typed commands forgive slips but never guess between two', () => {
  assert.equal(resolve('/clam', NAMES_TYPED), '/calm');
  assert.equal(resolve('/tset', NAMES_TYPED), '/test');
  assert.equal(resolve('/brian', NAMES_TYPED), '/brain');
  assert.equal(resolve('/stast', NAMES_TYPED), '/stats');
  assert.equal(resolve('/prof', NAMES_TYPED), '/profile');
  assert.equal(resolve('/t', NAMES_TYPED), null);
  assert.equal(resolve('/zzzzzz', NAMES_TYPED), null);
});

test('the menu covers every command once, with the flag first', () => {
  assert.equal(MENU[0][0], '!');
  assert.equal(new Set(MENU.map(([n]) => n)).size, MENU.length);
});

test('palettes: ends match the stops, and the hue ping-pongs instead of jumping', () => {
  for (const name of NAMES) {
    setPalette(name);
    const stops = PALETTES[name];
    assert.deepEqual(grad(0), stops[0]);
    assert.deepEqual(grad(1), stops[stops.length - 1]);
    assert.deepEqual(grad(1.2), grad(0.8));
    assert.deepEqual(grad(-0.3), grad(0.3));
  }
});

test('palettes: /color steps through all of them, and a bad name says what exists', () => {
  setPalette(NAMES[0]);
  const seen = new Set(NAMES.map(() => nextPalette()));
  assert.equal(seen.size, NAMES.length);
  assert.throws(() => setPalette('beige'), /Try: neon/);
  assert.equal(randomPalette(() => 0.999), NAMES[NAMES.length - 1]);
  assert.equal(palette(), NAMES[NAMES.length - 1]);
});

test('the brain is coloured by lobe, and a side view shows at least four of them', () => {
  const parts = new Set(renderBrain({ cols: 70, rows: 28, angle: Math.PI / 2 }).flat().filter(Boolean).map(c => c.part));
  assert.ok(parts.size >= 4, [...parts].join(','));
  for (const p of parts) assert.ok(p in LOBES);
});
