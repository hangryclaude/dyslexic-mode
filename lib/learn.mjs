import { append, readProfile, writeProfile } from './store.mjs';

const SYSTEM = 'You maintain a short reading profile for one dyslexic reader. Output only what is asked.';
const MAX_RULES = 10;

export function distillPrompt(profile, { reply, note }) {
  return [
    'Current profile:',
    '<profile>', profile || '(empty)', '</profile>',
    '',
    'The reader just flagged this reply as hard to read.',
    note ? `Their note: ${note}` : 'They left no note. Infer the most likely trip point from the reply.',
    '<reply>', reply, '</reply>',
    '',
    `Rewrite the profile as at most ${MAX_RULES} short rules, one per line, each starting with "- ".`,
    'Each rule says what to do, not what went wrong.',
    // One complaint is one data point; letting it spawn five rules overfits the profile to one reply.
    'Add at most one new rule for this flag, the one that best explains it.',
    'Keep earlier rules unless the new note contradicts them. Merge rules that say the same thing.',
    'Output only the rules.',
  ].join('\n');
}

// One flag, one profile rewrite. The model turns a single complaint into a general rule,
// so "that table" becomes "keep tables to two columns" and shapes every later reply.
export async function learn(ask, { reply, note }, { model = 'haiku' } = {}) {
  append('flags.jsonl', { ts: Date.now(), note: note ?? null, reply });
  const { text } = await ask(distillPrompt(readProfile(), { reply, note }), { system: SYSTEM, model });
  const rules = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ')).slice(0, MAX_RULES);
  if (!rules.length) throw new Error('profile update came back with no rules, so the old profile was kept');
  writeProfile(rules.join('\n'));
  return rules;
}
