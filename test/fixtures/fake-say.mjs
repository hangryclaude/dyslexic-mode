#!/usr/bin/env node
// Stands in for macOS `say --interactive`: reads lines on stdin and draws each one once per
// word with that word in bold, in the same bytes the real say writes, a few ms apart.
// It records its argv to SAY_LOG.
import { readFileSync, appendFileSync } from 'node:fs';

if (process.env.SAY_LOG) appendFileSync(process.env.SAY_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
const lines = readFileSync(0, 'utf8').replace(/\n$/, '').split('\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const write = s => new Promise(r => process.stdout.write(s, r));

await write('\x1b[?25l');
for (const [n, text] of lines.entries()) {
  // SAY_WORDS lets a test make some phrases one word, as real say does with "credit card".
  const words = [...text.matchAll(new RegExp(process.env.SAY_WORDS || '\\S+', 'g'))];
  for (const [i, m] of words.entries()) {
    // The first draw of every line after the first comes with no redraw mark, as in real say.
    const mark = n > 0 && i === 0 ? '' : '\r\x1b[M';
    await write(`${mark}${text.slice(0, m.index)}\x1b[1m${m[0]}\x1b(B\x1b[m${text.slice(m.index + m[0].length)}`);
    await sleep(Number(process.env.SAY_MS ?? 3));
  }
  await write(`\r\x1b[M${text}\n`);
}
await write('\x1b[?12l\x1b[?25h');
