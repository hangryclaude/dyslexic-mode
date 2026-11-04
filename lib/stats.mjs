import { TARGET } from './readtest.mjs';

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (n, d) => (d ? `${n} (${Math.round(100 * n / d)}%)` : '0');
const secs = ms => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const rewrote = cs => cs.filter(c => c.rewrites > 0).length;

// The numbers that say whether this works: the rewrite rate should fall as the profile grows,
// and the re-read answer should win the blind test and take less time to read.
export function summarize({ chats, tests, flags }) {
  const last = chats.slice(-10);
  const won = tests.filter(t => t.pick === 'reread').length;
  const same = tests.filter(t => t.pick === 'same').length;
  return [
    ['Replies', String(chats.length)],
    ['Needed a rewrite', share(rewrote(chats), chats.length)],
    ['Last 10 replies', share(rewrote(last), last.length)],
    ['First line shown', secs(median(chats.map(c => c.first).filter(ms => ms != null)))],
    ['Flagged hard', String(flags.length)],
    ['Test rounds', `${tests.length} of ${TARGET}`],
    ['Re-read picked', `${won} of ${tests.length}${same ? `, ${same} same` : ''}`],
    ['Read time, plain', secs(median(tests.map(t => t.plain.ms)))],
    ['Read time, re-read', secs(median(tests.map(t => t.reread.ms)))],
  ];
}

// A markdown table. The first column is text and the rest are numbers, so they line up on the
// right. `left` names the columns that hold words instead, like a status table's values.
export function table(rows, head = ['Measure', 'Value'], { left = [] } = {}) {
  const align = head.map((_, i) => (i === 0 || left.includes(i) ? 'left' : 'right'));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const cell = (c, i) => (align[i] === 'left' ? c.padEnd(w[i]) : c.padStart(w[i]));
  const line = r => `| ${r.map(cell).join(' | ')} |`;
  const rule = w.map((x, i) => (align[i] === 'left' ? `:${'-'.repeat(x + 1)}` : `${'-'.repeat(x + 1)}:`));
  return [line(head), `|${rule.join('|')}|`, ...rows.map(line)].join('\n');
}
