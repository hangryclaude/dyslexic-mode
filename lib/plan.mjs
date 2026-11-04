// A study plan: the goal, one tiny first action, then steps with a time box each.
export const MAX_STEP = 25;
export const FIRST_MINUTES = 2;

export const PLAN_SYSTEM = 'You turn a goal into a study plan for one dyslexic learner. Output only the JSON that is asked for, with no other text.';

export function planPrompt(goal) {
  return [
    `Goal: ${goal}`,
    '',
    'Make a study plan for this goal as JSON in exactly this shape:',
    '{ "goal": "<the goal in a few plain words>", "first": "<the very first action>", "steps": [{ "title": "<what to do>", "minutes": <number> }] }',
    '',
    'Rules:',
    `- "first" takes under ${FIRST_MINUTES} minutes. It is a tiny action like opening a page or writing one line, not studying.`,
    `- Give 3 to 7 steps. No step is longer than ${MAX_STEP} minutes. Split a bigger job into several steps.`,
    '- Each title starts with a verb, uses short plain words, and is at most 8 words.',
    '- Each step does one thing. The steps go in the order you do them.',
    '- Output only the JSON.',
  ].join('\n');
}

// A step over the limit is split into equal parts, so the plan keeps its total time and no
// time box is longer than the limit.
const split = ({ title, minutes }) => {
  const parts = Math.ceil(minutes / MAX_STEP), each = Math.ceil(minutes / parts);
  if (parts === 1) return [{ title, minutes }];
  return Array.from({ length: parts }, (_, i) => ({ title: `${title} (${i + 1} of ${parts})`, minutes: Math.min(each, minutes - each * i) }));
};

// The model's reply → a plan. Models wrap JSON in fences or a sentence, so the text from the
// first { to the last } is what gets parsed. Anything else fails loudly, so a bad plan is never saved.
export function parsePlan(text, fallbackGoal = '') {
  const open = text.indexOf('{'), close = text.lastIndexOf('}');
  if (open < 0 || close < open) throw new Error('the plan did not come back as JSON. try /plan again');
  let raw;
  try { raw = JSON.parse(text.slice(open, close + 1)); } catch (err) { throw new Error(`the plan was not valid JSON (${err.message}). try /plan again`); }
  const first = String(typeof raw.first === 'string' ? raw.first : raw.first?.title ?? '').trim();
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map(s => ({ title: String(s?.title ?? '').trim(), minutes: Math.max(1, Math.round(Number(s?.minutes)) || 10) }))
    .filter(s => s.title)
    .flatMap(split);
  if (!first || !steps.length) throw new Error('the plan had no first action or no steps. try /plan again');
  return { goal: String(raw.goal ?? '').trim() || fallbackGoal, first, steps };
}

export const total = plan => FIRST_MINUTES + plan.steps.reduce((sum, s) => sum + s.minutes, 0);

// The plan as markdown. On screen it is a checklist with the time box first on each line.
export function planMarkdown(plan, date) {
  return [
    `# Study plan: ${plan.goal}`,
    '',
    `- [ ] **${FIRST_MINUTES} min** First: ${plan.first}`,
    ...plan.steps.map(s => `- [ ] **${s.minutes} min** ${s.title}`),
    '',
    `About ${total(plan)} minutes in ${plan.steps.length + 1} steps. Made ${date}.`,
    '',
  ].join('\n');
}
