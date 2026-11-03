// /compact asks the running chat for a summary of itself, because only that session holds
// everything said so far, tool results included. A fresh session then starts with the summary
// as its first turn, so the model carries on from it and not from the long chat.
export const COMPACT_ASK = [
  'Summarize this chat so it can carry on in a fresh chat that has no other memory.',
  'Keep what the person wants, what was decided, the key facts, names, numbers and file paths, and what is still open.',
  'Drop small talk and anything that is finished.',
  'Do not use any tools. Plain text, under 400 words. Output only the summary.',
].join('\n');

export const carryPrompt = summary => [
  'This chat carries on from an earlier one. Here is a summary of it.',
  '<summary>',
  summary.trim(),
  '</summary>',
  'Use it as memory for what comes next. Reply with only the word: ready',
].join('\n');
