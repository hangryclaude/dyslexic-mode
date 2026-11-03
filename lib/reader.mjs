import { ESC, spoken, faded, dim } from './style.mjs';
import { layout, paint, speechLines } from './render.mjs';
import { speak, locate } from './voice.mjs';

const GUTTER = 2;

// Reads units aloud and reports which on-screen cells each spoken word covers. say can speak
// a few words as one, like "credit card", so a word's cells may hold spaces or cross a wrap.
export function follow(units, { from = 0, rate, voice, bin, onWord }) {
  const lines = speechLines(units), upTo = new Map();
  return speak(lines, {
    from, rate, voice, bin,
    onWord: (u, start, end, word) => {
      const hit = units[u] && locate(lines[u], word, start, end, upTo.get(u) ?? 0);
      if (!hit) return;
      upTo.set(u, hit[1]);
      onWord(u, units[u].cells.slice(hit[0], hit[1]).filter(c => c.at));
    },
  });
}

// Cells → runs that sit side by side on one line, so each run can be drawn in one go.
export function runs(cells) {
  const out = [];
  for (const c of cells) {
    const run = out.at(-1), prev = run?.at(-1);
    if (prev && prev.at[0] === c.at[0] && prev.at[1] + 1 === c.at[1]) run.push(c);
    else out.push([c]);
  }
  return out;
}

// Lights up each spoken word where it already sits in the chat, so the eye and the ear stay
// on the same word. A line that has scrolled off the top is still read, just not lit.
// `below` is how many rows the prompt sits under the reply's last line.
export function readInPlace(out, { lines, units, below }, { cursorRows = () => 0, rate, voice, bin } = {}) {
  const columns = out.columns || 80;
  let lit = [];
  const rowsAfter = i => lines.slice(i + 1).reduce((s, l) => s + l.rows, 0);
  const draw = (cells, on) => {
    for (const run of runs(cells)) {
      const [i, col] = run[0].at, x = GUTTER + col;
      const up = below + cursorRows() + rowsAfter(i) + lines[i].rows - 1 - Math.floor(x / columns);
      if (up >= (out.rows || 24)) continue;
      out.write(`\x1b7${ESC}${up}A\r${x % columns ? `${ESC}${x % columns}C` : ''}${paint(run, on ? () => spoken : undefined)}\x1b8`);
    }
  };
  const ctl = follow(units, { rate, voice, bin, onWord: (u, cells) => { draw(lit, false); draw(cells, true); lit = cells; } });
  const unlight = () => { draw(lit, false); lit = []; };
  ctl.done.then(unlight, unlight);
  return {
    done: ctl.done,
    stop() { ctl.stop(); unlight(); },
  };
}

// Full-screen read-aloud. The paragraph being read stays bright and the rest fades back, the
// spoken word is lit, and the page scrolls to keep that paragraph in the top third.
// Resolves with the speed it ended on, so a change can be kept for next time.
export function readerView(out, input, text, { rate = 180, voice, width } = {}) {
  return new Promise(resolve => {
    const cols = out.columns || 80, H = Math.max(3, (out.rows || 24) - 3);
    const { lines, units } = layout(text, { width: width ?? Math.min(cols - 4, 72), columns: cols });
    // A path or link longer than the screen keeps a line to itself, so here it runs on over
    // as many rows as it needs instead of being cut at the edge.
    const step = Math.max(1, cols - GUTTER - 1);
    const screen = lines.flatMap((l, i) => Array.from({ length: Math.max(1, Math.ceil(l.cells.length / step)) }, (_, k) => ({ i, cells: l.cells.slice(k * step, (k + 1) * step) })));
    const firstRow = new Map();
    screen.forEach((row, k) => { if (!firstRow.has(row.i)) firstRow.set(row.i, k); });
    const linesOf = units.map(x => [...new Set(x.cells.filter(c => c.at).map(c => c.at[0]))]);
    let u = 0, lit = new Set(), ctl = null, finished = false, problem = '';

    const footer = () => {
      if (problem) return `  ${problem}   esc close`;
      const state = finished ? 'done, space plays it again' : ctl?.paused ? 'paused, space plays' : 'space pause';
      return `  ${state}   ← → paragraph   - + speed ${rate}   esc close   ${Math.min(u + 1, units.length)}/${units.length}`;
    };
    const frame = () => {
      const focus = new Set(linesOf[u] ?? []);
      const top = Math.max(0, Math.min((firstRow.get(linesOf[u]?.[0]) ?? 0) - Math.floor(H / 3), screen.length - H));
      let s = `${ESC}H`;
      for (let r = 0; r < H; r++) {
        const row = screen[top + r];
        s += `${ESC}2K` + (row ? ' '.repeat(GUTTER) + paint(row.cells, c => (lit.has(c) ? spoken : focus.has(row.i) ? null : faded)) : '') + '\n';
      }
      out.write(s + `${ESC}2K\n${ESC}2K` + dim(footer().slice(0, cols - 1)));
    };
    const play = from => {
      ctl?.stop();
      if (!units.length) { problem = 'nothing here to read aloud'; return frame(); }
      finished = false;
      u = from;
      lit = new Set();
      const c = follow(units, { from, rate, voice, onWord: (k, cells) => { u = k; lit = new Set(cells); frame(); } });
      ctl = c;
      c.done.then(
        whole => { if (ctl === c && whole) { finished = true; lit = new Set(); frame(); } },
        err => { if (ctl === c) { problem = err.message; frame(); } },
      );
      frame();
    };

    const saved = input.listeners('keypress');
    input.removeAllListeners('keypress');
    const close = () => {
      ctl?.stop();
      input.removeListener('keypress', onKey);
      for (const l of saved) input.on('keypress', l);
      out.write(`${ESC}?25h${ESC}?1049l`);
      resolve({ rate });
    };
    const onKey = (s, key = {}) => {
      if (['escape', 'q', 'return'].includes(key.name) || (key.ctrl && key.name === 'c')) return close();
      if (key.name === 'space') {
        if (finished || problem) play(0);
        else if (ctl.paused) ctl.resume();
        else ctl.pause();
        return frame();
      }
      if (key.name === 'left') return play(Math.max(0, u - 1));
      if (key.name === 'right' && u + 1 < units.length) return play(u + 1);
      if (s === '+' || s === '=') { rate = Math.min(360, rate + 20); return play(u); }
      if (s === '-' || s === '_') { rate = Math.max(100, rate - 20); return play(u); }
    };
    out.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
    input.on('keypress', onKey);
    input.resume();
    play(0);
  });
}
