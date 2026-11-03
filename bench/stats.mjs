import { existsSync, readFileSync } from 'node:fs';

export const rowKey = r => `${r.model}|${r.cond}|${r.id}`;
// A judged row is one judge's ranking of one (model, object), not a condition's answer.
export const judgeKey = r => `${r.model}|${r.id}|${r.judge}`;

// One row per job. A retried job appends a second row, and the last one wins, so a run that
// failed on quota and was started again later reads as if it had worked the first time.
export function readRows(path, key = rowKey) {
  if (!existsSync(path)) return [];
  const byKey = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim()) {
      const r = JSON.parse(line);
      byKey.set(key(r), r);
    }
  }
  return [...byKey.values()];
}

// Rows that can count toward accuracy: finished without error, and the family has a key.
export const scoredRows = rows => rows.filter(r => !r.error && typeof r.correct === 'boolean');

// Wilson 95% interval for k right out of n. Better than the plain one for the small n and the
// scores near 0 and 1 that a benchmark like this produces.
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function accuracy(rows) {
  const s = scoredRows(rows);
  const k = s.filter(r => r.correct).length;
  return { k, n: s.length, ...wilson(k, s.length) };
}

// Exact two-sided sign test: of the pairs where the two conditions disagree, how likely is a split
// at least this lopsided if each side were equally likely to win? Summed in log space so a few
// thousand pairs do not underflow.
export function signTest(aOnly, bOnly) {
  const n = aOnly + bOnly;
  if (n === 0) return 1;
  const k = Math.min(aOnly, bOnly);
  let logP = -n * Math.LN2, tail = 0;
  for (let i = 0; i <= k; i++) {
    tail += Math.exp(logP);
    logP += Math.log((n - i) / (i + 1));
  }
  return Math.min(1, 2 * tail);
}

// Condition A against condition B on the same (model, item) pairs. `aOnly` counts pairs only A got
// right, so a positive `diff` means A is ahead. `where` narrows to one model or one family.
export function compare(rows, a, b, where = () => true) {
  if (a === b) throw new Error('compare needs two different conditions');
  const pairs = new Map();
  for (const r of scoredRows(rows)) {
    if ((r.cond !== a && r.cond !== b) || !where(r)) continue;
    const key = `${r.model}|${r.id}`;
    pairs.set(key, { ...pairs.get(key), [r.cond === a ? 'a' : 'b']: r.correct });
  }
  let aOnly = 0, bOnly = 0, both = 0, neither = 0;
  for (const { a: x, b: y } of pairs.values()) {
    if (x === undefined || y === undefined) continue;
    if (x && y) both++;
    else if (!x && !y) neither++;
    else if (x) aOnly++;
    else bOnly++;
  }
  const n = both + neither + aOnly + bOnly;
  return { n, both, neither, aOnly, bOnly, p: signTest(aOnly, bOnly), diff: n ? (aOnly - bOnly) / n : 0 };
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Time, length and calls per condition: what a style costs, next to what it earns.
export function cost(rows) {
  const ok = rows.filter(r => !r.error);
  return {
    n: ok.length,
    ms: median(ok.map(r => r.ms).filter(Number.isFinite)),
    chars: median(ok.map(r => r.chars).filter(Number.isFinite)),
    calls: mean(ok.map(r => r.calls).filter(Number.isFinite)),
    outTokens: mean(ok.map(r => r.outTokens).filter(Number.isFinite)),
  };
}

export const unique = xs => [...new Set(xs)];
