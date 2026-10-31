// Every control in one list: the menu shows it in this order, and numbers 1-9 pick the first nine.
export const MENU = [
  ['!', 'flag the last reply as hard to read'],
  ['/brain', 'spin the big brain'],
  ['/color', 'new colors'],
  ['/test', 'one reading test round'],
  ['/stats', 'your numbers'],
  ['/profile', 'rules it learned from you'],
  ['/tools', 'full access on or off'],
  ['/new', 'fresh chat'],
  ['/calm', 'motion on or off'],
  ['/pliny', 'l33t mode'],
  ['/exit', 'quit'],
];

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
export function resolve(typed, names) {
  if (names.includes(typed)) return typed;
  const prefixed = names.filter(n => n.startsWith(typed));
  if (prefixed.length === 1) return prefixed[0];
  const [best, next] = names.map(n => [n, distance(typed, n)]).sort((x, y) => x[1] - y[1]);
  return best[1] <= 2 && (!next || next[1] > best[1]) ? best[0] : null;
}
