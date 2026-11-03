import { plain, bold, code, marker, heading, link, dim } from './style.mjs';

// Markdown → screen lines made of cells. Each cell knows its style, whether it is read aloud,
// and, once on screen, where it sits, so a spoken word can be lit up in place.
const GUTTER = '  ';
const cell = (ch, style = plain, say = true) => ({ ch, style, say });
const each = (s, style, say) => Array.from(s, ch => cell(ch, style, say));
export const textOf = cs => cs.map(c => c.ch).join('');

// Cells → one string, styling each run of same-styled cells once instead of every letter.
// `over` can restyle a cell, such as the word being read aloud.
export function paint(cs, over = () => null) {
  let s = '', run = '', style = null;
  for (const c of cs) {
    const st = over(c) ?? c.style;
    if (st !== style && run) { s += style(run); run = ''; }
    style = st;
    run += c.ch;
  }
  return run ? s + style(run) : s;
}

const FENCE = /^\s*(```|~~~)/;
const ROW = /^\s*\|/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

// Inline markdown → cells: **bold**, `code`, [text](url) and bare links. Italics lose their
// stars and stay roman, because italics read worse. Links are shown but not read aloud:
// a spoken URL is letters and slashes.
export function inline(text, base = plain) {
  const out = [];
  let i = 0, m;
  while (i < text.length) {
    const rest = text.slice(i), after = !/\w/.test(text[i - 1] ?? '');
    if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
      out.push(...inline(m[1], s => bold(base(s))));
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      out.push(...each(m[1], code));
    } else if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest))) {
      out.push(...inline(m[1], link), ...each(` ${m[2]}`, dim, false));
    } else if (after && (m = /^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/.exec(rest))) {
      out.push(...each(m[0], link, false));
    } else if (after && (m = /^\*([^*\s](?:[^*\n]*[^*\s])?)\*/.exec(rest))) {
      out.push(...inline(m[1], base));
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i));
      out.push(cell(ch, base));
      i += ch.length;
      continue;
    }
    i += m[0].length;
  }
  return out;
}

// Greedy wrap with a hanging indent. A word wider than the line keeps a line to itself,
// whole, so a long path or link still copies in one piece.
function wrap(cs, width, indent) {
  const lines = [];
  let cur = [], word = [];
  const flush = () => {
    if (cur.length && cur.length + word.length > width) {
      lines.push(cur);
      cur = each(' '.repeat(indent), plain, false);
      while (word[0]?.ch === ' ') word.shift();
    }
    cur.push(...word);
    word = [];
  };
  for (const c of cs) { if (c.ch === ' ') flush(); word.push(c); }
  flush();
  lines.push(cur);
  return lines;
}

// One source line of prose → its cells and the hanging indent its wrapped lines take.
function prose(raw, tx) {
  let m;
  if ((m = HEAD.exec(raw))) return { cells: [cell('▍', marker, false), cell(' ', plain, false), ...inline(tx(m[2]), heading)], indent: 2 };
  if ((m = QUOTE.exec(raw))) return { cells: [cell('│', marker, false), cell(' ', plain, false), ...inline(tx(m[1]))], indent: 2 };
  if ((m = LIST.exec(raw))) {
    const [, lead, mk, box, rest] = m, num = /\d/.test(mk);
    // Step numbers are read aloud, because "two" says where you are. Bullets are not.
    const head = [...each(lead, plain, false), ...each(box ? (/x/i.test(box) ? '☑' : '☐') : num ? mk : '•', marker, num), cell(' ', plain, num)];
    return { cells: [...head, ...inline(tx(rest))], indent: head.length };
  }
  const lead = raw.match(/^\s*/)[0];
  return { cells: [...each(lead, plain, false), ...inline(tx(raw.slice(lead.length)))], indent: lead.length };
}

function splitRow(raw) {
  let s = raw.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

const ALIGN = /^:?-+:?$/;
const isAlign = r => r.every(c => ALIGN.test(c));
const NUMBER = /^[~≈<>±+\-−$£€]?\s?\d[\d,]*(\.\d+)?\s?(%|×|x|[A-Za-z]{1,4})?$/;

// A markdown table as a box. Each column takes the room its text needs. When that is wider
// than the line, the widest columns give up room first and their cells wrap, with a rule
// between rows so each row still reads as one. Numbers right-align so their digits line up.
// With too many columns to fit even then, each row becomes a short list instead.
function table(raws, width, tx) {
  const parsed = raws.map(splitRow);
  const head = parsed.length > 1 && isAlign(parsed[1]) ? parsed[0] : null;
  const aligns = head ? parsed[1].map(c => (c.endsWith(':') && !c.startsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null)) : [];
  const body = parsed.filter((r, i) => !isAlign(r) && !(head && i === 0));
  const n = Math.max(...[head, ...body].filter(Boolean).map(r => r.length));
  const row = r => Array.from({ length: n }, (_, i) => inline(tx(r[i] ?? '')));
  const H = head && row(head).map(cs => cs.map(c => ({ ...c, style: s => bold(c.style(s)) })));
  const B = body.map(row), all = H ? [H, ...B] : B;
  const sum = xs => xs.reduce((s, x) => s + x, 0);
  const longestWord = cs => Math.max(1, ...textOf(cs).split(' ').map(x => [...x].length));
  const w = Array.from({ length: n }, (_, i) => Math.max(1, ...all.map(r => r[i].length)));
  const floor = Array.from({ length: n }, (_, i) => Math.max(...all.map(r => longestWord(r[i]))));
  const room = width - (3 * n + 1);
  if (sum(floor) > room) {
    return { raw: body.flatMap(([first = '', ...rest]) => [`- **${first}**`, ...rest.map((v, i) => (v ? `  - ${head?.[i + 1] ? `${head[i + 1]}: ` : ''}${v}` : '')).filter(Boolean)]) };
  }
  // The widest column gives up one character at a time, never below its longest word.
  while (sum(w) > room) {
    let i = -1;
    for (let k = 0; k < n; k++) if (w[k] > floor[k] && (i < 0 || w[k] > w[i])) i = k;
    w[i]--;
  }
  const right = w.map((_, i) => aligns[i] === 'right' || (!aligns[i] && B.length > 0 && B.every(r => !r[i].length || NUMBER.test(textOf(r[i])))));
  const box = s => each(s, dim, false);
  const edge = (l, mid, r) => box(l + w.map(x => '─'.repeat(x + 2)).join(mid) + r);
  const rowLines = r => {
    const parts = r.map((cs, i) => wrap(cs, w[i], 0));
    return Array.from({ length: Math.max(...parts.map(p => p.length)) }, (_, k) => [...box('│'), ...parts.flatMap((p, i) => {
      const cs = p[k] ?? [], pad = each(' '.repeat(w[i] - cs.length), plain, false);
      return [cell(' ', plain, false), ...(right[i] ? [...pad, ...cs] : [...cs, ...pad]), cell(' ', plain, false), ...box('│')];
    })]);
  };
  const tall = B.some(r => r.some((cs, i) => cs.length > w[i]));
  // A row is read aloud as its cells with a short pause between. The commas are never drawn.
  const units = all
    .map(r => r.filter(cs => cs.some(c => c.say && c.ch.trim())).flatMap((cs, i) => (i ? [cell(','), cell(' '), ...cs] : cs)).filter(c => c.say))
    .filter(cs => cs.length)
    .map(cells => ({ cells }));
  return {
    lines: [
      edge('╭', '┬', '╮'),
      ...(H ? [...rowLines(H), edge('├', '┼', '┤')] : []),
      ...B.flatMap((r, k) => [...(tall && k ? [edge('├', '┼', '┤')] : []), ...rowLines(r)]),
      edge('╰', '┴', '╯'),
    ],
    units,
  };
}

// Markdown arriving in pieces → finished screen lines, each written once its source line is
// complete, so nothing on screen ever changes under the reader's eye. Tables wait for their
// last row so the columns can be sized. Code is shown but never read aloud.
export function stream(write, { width = 72, columns = 80, styled = true, transform = s => s } = {}) {
  const lines = [], units = [];
  let buf = '', inCode = false, rows = [], lastBlank = true, from = { lines: 0, units: 0 };

  function put(cs) {
    const at = lines.length;
    cs.forEach((c, col) => { c.at = [at, col]; });
    lines.push({ cells: cs, rows: Math.max(1, Math.ceil((GUTTER.length + cs.length) / columns)) });
    lastBlank = !cs.length;
    write(cs.length ? GUTTER + (styled ? paint(cs) : textOf(cs)) : '');
  }
  const speak = cs => {
    const said = cs.filter(c => c.say);
    if (/\S/.test(textOf(said))) units.push({ cells: said });
  };

  function flushTable() {
    if (!rows.length) return;
    const t = table(rows, width, transform);
    rows = [];
    if (t.raw) return t.raw.forEach(line);
    t.lines.forEach(put);
    units.push(...t.units);
  }

  function line(raw) {
    raw = raw.replace(/\r$/, '');
    if (FENCE.test(raw)) { flushTable(); inCode = !inCode; return; }
    if (inCode) return put([cell('│', marker, false), cell(' ', plain, false), ...each(raw, code, false)]);
    if (ROW.test(raw)) { rows.push(raw); return; }
    flushTable();
    if (!raw.trim()) { if (!lastBlank) put([]); return; }
    if (RULE.test(raw)) return put(each('─'.repeat(Math.min(width, 36)), dim, false));
    const { cells, indent } = prose(raw, transform);
    wrap(cells, width, indent).forEach(put);
    // Built from the cells before wrapping, so the space at each wrap point is still read.
    speak(cells);
  }

  function push(text) {
    buf += text;
    for (let nl; (nl = buf.indexOf('\n')) >= 0;) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      line(raw);
    }
  }
  // Writes out a line still waiting for its newline, as when a tool call cuts the text off.
  function flush() {
    if (buf) { const raw = buf; buf = ''; line(raw); }
    flushTable();
  }
  // Text after this point is the answer. Text before it was notes written between tool calls.
  function mark() { flush(); from = { lines: lines.length, units: units.length }; }
  function end() { flush(); return { lines, units: units.slice(from.units), from: from.lines }; }
  return { push, flush, mark, end, lines };
}

export function layout(text, opts) {
  const s = stream(() => {}, opts);
  s.push(text);
  return s.end();
}

export function print(out, text, opts) {
  const s = stream(l => out.write(l + '\n'), opts);
  s.push(text);
  return s.end();
}

// What `say` gets: one line per unit, so its line count says which unit it is reading.
// "[[" starts an embedded speech command, so it is swapped for a look-alike of the same length.
// Every swap is one character for one, so say's word offsets still point at the right cells.
export const speechLines = units => units.map(u => textOf(u.cells).replaceAll('[[', '((').replace(/\s/g, ' '));
