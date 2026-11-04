import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPrompt, parsePlan, planMarkdown, total, PLAN_SYSTEM, MAX_STEP } from '../lib/plan.mjs';

const json = o => JSON.stringify(o);

test('the plan prompt carries the goal and the two limits: a first action under 2 minutes and steps of at most 25', () => {
  const p = planPrompt('learn to read a bus map');
  assert.match(p, /^Goal: learn to read a bus map\n/);
  assert.match(p, /"first"/);
  assert.match(p, /under 2 minutes/);
  assert.match(p, /longer than 25 minutes/);
  assert.match(p, /Output only the JSON/);
  assert.match(PLAN_SYSTEM, /JSON/);
});

test('a plan comes out of fenced JSON or JSON with chatter around it', () => {
  const body = { goal: 'map reading', first: 'Open the map', steps: [{ title: 'Find the legend', minutes: 10 }, { title: 'Trace one route', minutes: 15 }] };
  const plain = parsePlan(json(body));
  assert.deepEqual(plain, body);
  assert.deepEqual(parsePlan('```json\n' + json(body) + '\n```'), body);
  assert.deepEqual(parsePlan('Here is your plan:\n' + json(body) + '\nGood luck!'), body);
});

test('a step over 25 minutes is split into equal parts, so no time box is too long and the total holds', () => {
  const plan = parsePlan(json({ goal: 'g', first: 'f', steps: [{ title: 'Read', minutes: 40 }, { title: 'Write', minutes: 70 }, { title: 'Short', minutes: 25 }] }));
  assert.deepEqual(plan.steps, [
    { title: 'Read (1 of 2)', minutes: 20 }, { title: 'Read (2 of 2)', minutes: 20 },
    { title: 'Write (1 of 3)', minutes: 24 }, { title: 'Write (2 of 3)', minutes: 24 }, { title: 'Write (3 of 3)', minutes: 22 },
    { title: 'Short', minutes: 25 },
  ]);
  assert.ok(plan.steps.every(s => s.minutes <= MAX_STEP));
  assert.equal(plan.steps.reduce((n, s) => n + s.minutes, 0), 135);
});

test('odd minutes are made sane, steps without a title are dropped, and a first action can come as an object', () => {
  const plan = parsePlan(json({ first: { title: 'Open a page' }, steps: [{ title: 'A', minutes: '12' }, { title: 'B' }, { title: 'C', minutes: -5 }, { minutes: 9 }, null] }), 'fallback goal');
  assert.equal(plan.goal, 'fallback goal');
  assert.equal(plan.first, 'Open a page');
  assert.deepEqual(plan.steps, [{ title: 'A', minutes: 12 }, { title: 'B', minutes: 10 }, { title: 'C', minutes: 1 }]);
});

test('a broken plan fails loudly and says to try again', () => {
  assert.throws(() => parsePlan('no plan here, sorry'), /did not come back as JSON/);
  assert.throws(() => parsePlan('{ "goal": "x", '), /did not come back as JSON/);
  assert.throws(() => parsePlan('{ nope }'), /not valid JSON/);
  assert.throws(() => parsePlan(json({ goal: 'x', steps: [{ title: 'a', minutes: 5 }] })), /no first action or no steps/);
  assert.throws(() => parsePlan(json({ goal: 'x', first: 'f', steps: [] })), /no first action or no steps/);
});

test('the markdown is a checklist with the time box first on each line, and the total at the end', () => {
  const plan = { goal: 'map reading', first: 'Open the map', steps: [{ title: 'Find the legend', minutes: 10 }, { title: 'Trace one route', minutes: 15 }] };
  assert.equal(total(plan), 27);
  assert.equal(planMarkdown(plan, '2026-11-03'), [
    '# Study plan: map reading',
    '',
    '- [ ] **2 min** First: Open the map',
    '- [ ] **10 min** Find the legend',
    '- [ ] **15 min** Trace one route',
    '',
    'About 27 minutes in 3 steps. Made 2026-11-03.',
    '',
  ].join('\n'));
});
