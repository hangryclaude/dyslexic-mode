// Every control, in groups. /help shows the groups, and the arrow menu shows them as one list in
// this order, where numbers 1-9 pick the first nine.
export const GROUPS = [
  ['Chat', [
    ['!', 'flag the last reply as hard to read'],
    ['/new', 'fresh chat'],
    ['/clear', 'fresh chat, same as /new'],
    ['/resume', 'go back to an old chat'],
    ['/compact', 'shrink this chat to a summary and carry on'],
    ['/plan', 'study plan from a goal: /plan <goal>'],
    ['/export', 'save this chat as a markdown file'],
    ['/copy', 'copy the last reply'],
  ]],
  ['Model and tools', [
    ['/model', 'pick any AI: a company, then a model. or /model <name>'],
    ['/think', 'how it thinks: off, dyslexic, strong, extreme, explorer'],
    ['/context', 'how full the context window is'],
    ['/status', 'model, thinking, tools, context, session'],
    ['/tools', 'full access on or off'],
  ]],
  ['Your reading', [
    ['/test', 'one reading test round'],
    ['/stats', 'your numbers'],
    ['/profile', 'rules it learned from you'],
  ]],
  ['Looks and sound', [
    ['/color', 'new colors'],
    ['/brain', 'spin the big brain'],
    ['/calm', 'motion on or off'],
    ['/pliny', 'l33t mode'],
    ['/voice', 'talk with ChatGPT voice, on or off'],
    ['/key', 'save your OpenAI key for voice'],
  ]],
  ['Other', [
    ['/help', 'every command, grouped'],
    ['/exit', 'quit'],
  ]],
];

export const MENU = GROUPS.flatMap(([, items]) => items);

// Optimal string alignment distance: a swapped pair of letters costs 1, not 2,
// because that is the slip a dyslexic typist makes most.
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The command a typed word meant: exact, then a unique prefix, then the one closest spelling
// within 2 edits. Null when nothing is clearly meant, so a guess never runs the wrong thing.
// A start that several commands share, like /co, says nothing about which one was meant.
export function resolve(typed, names) {
  if (names.includes(typed)) return typed;
  const prefixed = names.filter(n => n.startsWith(typed));
  if (prefixed.length > 1) return null;
  if (prefixed.length === 1) return prefixed[0];
  const [best, next] = names.map(n => [n, distance(typed, n)]).sort((x, y) => x[1] - y[1]);
  return best[1] <= 2 && (!next || next[1] > best[1]) ? best[0] : null;
}
