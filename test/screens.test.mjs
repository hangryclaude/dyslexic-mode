import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, collapse, stillSvg } from '../tools/screens.mjs';

test('a screen with colour codes becomes cells that keep each colour', () => {
  const [row] = parse('a\x1b[38;2;255;0;0mb\x1b[1;2mc\x1b[0md', 1);
  assert.deepEqual(row.map(c => [c.ch, c.fg, c.bold, c.dim]), [
    ['a', '#e6e6e6', false, false],
    ['b', '#ff0000', false, false],
    ['c', '#ff0000', true, true],
    ['d', '#e6e6e6', false, false],
  ]);
});

test('screens that stay the same become one frame that lasts as long as all of them', () => {
  const timed = [{ text: 'a', ms: 40 }, { text: 'a', ms: 41 }, { text: 'b', ms: 40 }];
  assert.deepEqual(collapse(timed), [{ text: 'a', ms: 81 }, { text: 'b', ms: 40 }]);
  assert.equal(timed[0].ms, 40);
});

test('a still is a terminal window sized to its grid, with its text escaped', () => {
  const svg = stillSvg('<b> & c', { cols: 20, rows: 2 });
  assert.match(svg, /^<svg[^>]* width="208" height="110"/);
  assert.ok(svg.includes('&lt;b&gt; &amp; c'));
});
