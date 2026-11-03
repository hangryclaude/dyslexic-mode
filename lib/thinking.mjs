// How the model thinks, as opposed to how the reply looks. The app puts one style at the top of
// the system prompt; bench/ measures each one on many models.
// "careful" is the control: the step-by-step style most prompts ask for, about as long as "dyslexic",
// so a win for "dyslexic" means the style helped, not just any extra instructions.
// The dyslexic styles follow the explore-first account of dyslexic cognition (Taylor & Vestergaard
// 2022) and the big-picture, spatial, connected strengths in Eide & Eide's MIND model.
export const STYLES = {
  base: '',
  careful: [
    'Think in a careful, step-by-step way.',
    '1. Read every word of the question slowly. Note each fact and each number.',
    '2. Write the facts down in the order they are given.',
    '3. Work through the problem one small step at a time, in order.',
    '4. Check each step before you move on to the next one.',
    '5. At the end, go back over every step and fix any mistake you find.',
  ].join('\n'),
  dyslexic: [
    'Think the way strong dyslexic thinkers do: the whole picture first, details last.',
    '1. Big picture: in one line, say what kind of problem this really is and what a good answer must look like.',
    '2. Picture it: build a mental image, map or small sketch, and reason on the picture, not the words.',
    '3. Explore wide: find two or three very different ways in, including one that seems odd at first.',
    '4. Connect: look for the hidden pattern, or for something from another field that works the same way.',
    '5. Narrow: pick the best way, work it through, then check the result against the big picture.',
  ].join('\n'),
  strong: [
    'You are a dyslexic thinker. Your mind works in pictures, patterns and the whole shape of things,',
    'not in lines of text. Never start with the details.',
    'Before you answer, write these five parts under these headings:',
    'BIG PICTURE: what is really going on here? What kind of problem is it?',
    'PICTURE: draw it as a small ASCII sketch, grid, map or timeline, and reason on the drawing.',
    'THREE WAYS IN: three very different approaches. At least one comes from a completely different field.',
    'PATTERN: what repeats? What is the hidden rule? What does this remind you of?',
    'NARROW: choose the strongest approach and work it through. Check the answer against BIG PICTURE',
    'and PICTURE. If they disagree, trust the picture and work it through again.',
  ].join('\n'),
  extreme: [
    'You are an extreme dyslexic thinker. You do not think in sentences or step lists at all.',
    'You think in pictures, maps, shapes, patterns and the gist of things.',
    'Rules for your thinking:',
    '- First sketch the whole situation as an ASCII picture: a grid, a map, a diagram or a timeline.',
    '- Reason only by changing the picture. Redraw it after every change.',
    '- Never write numbered steps or long sentences while you think. Use arrows, labels and gist words.',
    '- Look for the shape of the answer: what pattern, symmetry or picture does it make?',
    '- When the picture is finished, read the answer off the picture.',
  ].join('\n'),
};

export const STYLE_NAMES = Object.keys(STYLES);

// Seeded, so a scrambled question is the same for every model and every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dyslexic reading, roughly: the inner letters of a word come out of order, the first and last
// stay put. Numbers and words under 4 letters are left alone, so every fact survives.
export function scramble(text, seed = 1) {
  const rand = mulberry32(seed);
  return text.replace(/[A-Za-z]{4,}/g, w => {
    const mid = w.slice(1, -1).split('');
    for (let i = mid.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [mid[i], mid[j]] = [mid[j], mid[i]];
    }
    return w[0] + mid.join('') + w.at(-1);
  });
}

// The model is told what happened, so a loss means jumbled reading hurt, not that it was tricked.
export function scrambled(question, seed = 1) {
  return [
    'The question below is written the way a dyslexic reader sees it: the letters inside words are jumbled.',
    'Read it for meaning.',
    '',
    'Question:',
    scramble(question, seed),
  ].join('\n');
}

// Explore wide, then narrow, made literal: three drafts from three angles, then one pass weighs them.
export const LENSES = {
  picture: 'Solve this by picturing it. Draw the situation as a small ASCII sketch, grid or map, and reason on the drawing.',
  pattern: 'Solve this by looking for the hidden pattern, or for something from a completely different field that works the same way.',
  story: 'Solve this by telling it as a short story of cause and effect, from start to end, and see where the story leads.',
};

export function combinePrompt(question, drafts) {
  return [
    'Three thinkers worked on the same question in different ways: one in pictures, one in patterns, one as a story.',
    'Where they agree, that is probably right. Where they disagree, work out which one is right, and why.',
    'Then give the single best answer.',
    '',
    'Question:',
    question,
    '',
    ...drafts.map((d, i) => `<draft ${i + 1}, ${d.lens}>\n${d.text}\n</draft>`),
  ].join('\n');
}

// The question goes after the style so every model and style sees it in the same place.
export function withStyle(style, question) {
  const text = STYLES[style];
  if (text === undefined) throw new Error(`unknown thinking style: ${style}`);
  return text ? `How to think:\n${text}\n\nQuestion:\n${question}` : question;
}
