import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reply, hardHits } from '../lib/filter.mjs';

const EVALS = new URL('../skill/references/evals/', import.meta.url);
const read = name => readFileSync(new URL(name, EVALS), 'utf8');

// The app only calls analyze(text), so the new rules must reach it with no extra wiring.
test('a comparison written as repeated bullet labels is rewritten once, with the table hint', async () => {
  const good = 'RAM is fast.\n\n|       | RAM  |\n|-------|------|\n| Speed | Fast |\n';
  const calls = [];
  const ask = async p => { calls.push(p); return { text: calls.length === 1 ? read('11-bad.md') : good, sessionId: 's' }; };
  const r = await reply(ask, 'electric vs petrol', {});
  assert.equal(calls.length, 2);
  assert.match(calls[1], /repeated-label, "electric" starts 3 bullets, like a grid → put the rows in a table/);
  assert.deepEqual({ rewrites: r.rewrites, hard: r.hard }, { rewrites: 1, hard: 0 });
});

test('a study plan with a long step, a slow start and no breaks is a hard hit in the app', () => {
  const rules = hardHits(read('09-bad.md')).map(f => f.rule);
  for (const rule of ['plan-first-step', 'plan-time-box', 'plan-break']) assert.ok(rules.includes(rule), rule);
  assert.deepEqual(hardHits(read('09-fixed.md')), []);
});

test('a reply that opens with a heading or a pleasantry is caught, a short answer is not', () => {
  assert.ok(hardHits('# Why your laptop fan gets loud\n\nIt is the processor.\n').some(f => f.rule === 'first-line'));
  assert.deepEqual(hardHits('The fan is loud because the processor is hot.\n\n- **Dust:** blocked vents.\n'), []);
});

test('the evals still split cleanly: every fixed file is clean for the app, every bad file is not', () => {
  for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
    assert.deepEqual(hardHits(read(`${n}-fixed.md`)), [], `${n}-fixed`);
    assert.ok(hardHits(read(`${n}-bad.md`)).length > 0, `${n}-bad`);
  }
});
