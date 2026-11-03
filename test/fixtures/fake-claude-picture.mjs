#!/usr/bin/env node
// Stands in for `claude -p` as bench/runners.mjs calls it for the picture conditions, and records
// argv, the bridge marker and its cwd to FAKE_LOG. JSON mode prints one result object, as the real
// CLI does, and answers a request to draw with a small SVG. Stream mode reads one user message and
// describes the blocks in it, so a test can tell that a PNG arrived as an image block. A prompt
// that starts with FAIL fails the way the CLI does: a JSON error, exit 1.
import { readFileSync, appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_LOG) {
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, bridge: process.env.CODEX_BRIDGE ?? null, cwd: process.cwd() }) + '\n');
}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');

const input = readFileSync(0, 'utf8');
let prompt = input, note = '';
if (argv.includes('--input-format')) {
  const { message } = JSON.parse(input.split('\n')[0]);
  const image = message.content.find(b => b.type === 'image');
  const bytes = Buffer.from(image.source.data, 'base64');
  prompt = message.content.find(b => b.type === 'text').text;
  note = `image ${image.source.media_type} png=${bytes.subarray(1, 4).toString() === 'PNG'} bytes=${bytes.length}; `;
  emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
}
const bad = prompt.startsWith('FAIL');
const draws = prompt.startsWith('Turn the question below into ONE SVG');
emit({
  type: 'result', subtype: bad ? 'error_during_execution' : 'success', is_error: bad,
  result: bad ? 'boom' : draws ? '<svg viewBox="0 0 800 800"><rect width="10" height="10"/></svg>' : `${note}echo: ${prompt}`,
  session_id: 'sess-1',
});
process.exitCode = bad ? 1 : 0;
