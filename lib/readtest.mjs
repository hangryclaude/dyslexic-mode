// A fixed bank asked in order, so every round is a new question and two runs stay comparable.
export const QUESTIONS = [
  'How does a credit score work?',
  'What is the difference between a virus and bacteria?',
  'How do I undo my last git commit?',
  'Why is the sky blue?',
  'How does compound interest work?',
  'What should I check before signing a phone contract?',
  'How do vaccines train the immune system?',
  'What is an API, in plain words?',
  'How does a mortgage work?',
  'Why do we have leap years?',
];
export const TARGET = QUESTIONS.length;
export const questionFor = round => QUESTIONS[round % QUESTIONS.length];

// Random order per round, so "the one I read first" can't pass for a preference.
export const order = (rng = Math.random) => (rng() < 0.5 ? ['plain', 'reread'] : ['reread', 'plain']);
export const pickOf = (key, seq) => (key === 's' ? 'same' : seq[Number(key) - 1]);

// The baseline is Claude with no reading rules: what he would get anywhere else.
export const PLAIN_SYSTEM = 'You are a helpful assistant in a terminal chat. Answer in markdown.';

export const words = text => text.split(/\s+/).filter(Boolean).length;
