import { spawn } from 'node:child_process';

const REDRAW = '\r\x1b[M', ON = '\x1b[1m', OFF = '\x1b(B\x1b[m';
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\([A-Z0-9]/g, '');
const len = s => [...s].length;

// `say --interactive` draws the line it is reading once per word, with that word in bold.
// A redraw starts with "\r ESC[M", except the first draw of each new line, which follows the
// last line's newline straight away. So a draw is whatever sits between two of those marks,
// and each newline moves on a line. This turns the stream into word events:
// (line, start, end, word), with offsets counted in characters of the line say was given.
export function wordParser(onWord) {
  let buf = '', draw = '', said = false, line = 0;
  const word = () => {
    const on = draw.indexOf(ON), off = on < 0 ? -1 : draw.indexOf(OFF, on);
    if (said || off < 0) return;
    said = true;
    const before = strip(draw.slice(0, on)), w = strip(draw.slice(on + ON.length, off));
    onWord(line, len(before), len(before) + len(w), w);
  };
  return chunk => {
    buf += chunk;
    for (;;) {
      const marks = [buf.indexOf('\n'), buf.indexOf(REDRAW)].filter(i => i >= 0);
      if (!marks.length) {
        // Hold back a tail that could be a redraw mark split across two chunks.
        const cr = buf.lastIndexOf('\r'), keep = cr >= 0 && REDRAW.startsWith(buf.slice(cr)) ? cr : buf.length;
        draw += buf.slice(0, keep);
        buf = buf.slice(keep);
        return word();
      }
      const cut = Math.min(...marks), isLine = buf[cut] === '\n';
      draw += buf.slice(0, cut);
      word();
      draw = '';
      said = false;
      if (isLine) line++;
      buf = buf.slice(cut + (isLine ? 1 : REDRAW.length));
    }
  };
}

// Reads lines aloud with macOS `say`, from line `from` on, and reports each word as it is
// spoken. pause() freezes the voice mid-word and resume() carries on from there.
export function speak(lines, { from = 0, rate, voice, onWord, bin = process.env.DYSLEXIC_SAY_BIN || 'say' } = {}) {
  const args = ['--interactive=bold'];
  if (rate) args.push('-r', String(rate));
  if (voice) args.push('-v', voice);
  // say only marks words when it thinks it is drawing to a terminal it knows.
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, TERM: 'xterm-256color' } });
  let paused = false, stopped = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', wordParser((line, start, end, word) => { if (!stopped) onWord?.(line + from, start, end, word); }));
  const done = new Promise((resolve, reject) => {
    child.on('error', err => reject(err.code === 'ENOENT' ? new Error('read aloud needs the macOS say command') : err));
    child.on('close', () => resolve(!stopped));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(lines.slice(from).join('\n') + '\n');
  return {
    done,
    get paused() { return paused; },
    pause() { if (!paused && !stopped) { child.kill('SIGSTOP'); paused = true; } },
    resume() { if (paused && !stopped) { child.kill('SIGCONT'); paused = false; } },
    // A stopped process only takes a kill once it is running again.
    stop() {
      if (stopped) return;
      stopped = true;
      if (paused) child.kill('SIGCONT');
      child.kill();
    },
  };
}

// Where a spoken word sits in its line. say's offset is tried first. If say spelled the
// line differently, the word is found by its text, searching on from the last word.
export function locate(text, word, start, end, after = 0) {
  const chars = [...text], w = word.trim();
  if (chars.slice(start, end).join('').trim() === w) return [start, end];
  const at = text.indexOf(w, [...chars.slice(0, after)].join('').length);
  return at < 0 ? null : [len(text.slice(0, at)), len(text.slice(0, at)) + len(w)];
}
