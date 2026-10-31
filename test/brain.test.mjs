import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrain, field } from '../lib/brain.mjs';
import { paint } from '../lib/anim.mjs';

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
