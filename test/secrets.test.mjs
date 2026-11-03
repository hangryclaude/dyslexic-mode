import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'test/secrets.test.mjs';

// Fragments are joined at runtime so this file never contains a full key shape itself.
const PATTERNS = [
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-project', /sk-proj-[A-Za-z0-9_-]{20,}/],
  ['openai', /\bsk-[A-Za-z0-9]{32,}/],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/],
  ['github', /\b(?:ghp|gho)_[A-Za-z0-9]{30,}/],
  ['github-pat', /github_pat_[A-Za-z0-9_]{30,}/],
  ['slack', /xox[abpr]-[A-Za-z0-9-]{10,}/],
  ['google', /AIza[0-9A-Za-z_-]{35}/],
  ['xai', /\bxai-[A-Za-z0-9]{20,}/],
  ['private-key', new RegExp('-----BEGIN (?:[A-Z]+ )*PRIVATE ' + 'KEY-----')],
  ['generic', /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_\-./+]{24,}["']/i],
];

const mask = s => (s.length <= 8 ? '****' : s.slice(0, 4) + '****' + s.slice(-2));

export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      const m = re.exec(line);
      if (m) hits.push({ line: i + 1, name, masked: mask(m[0]) });
    }
  });
  return hits;
}

test('scanner flags a synthetic key and masks it', () => {
  const fake = 'x = "sk-ant-' + 'a'.repeat(30) + '"';
  const hits = scanText(fake);
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].masked.includes('a'.repeat(10)));
});

test('no API keys in tracked or untracked-unignored files', () => {
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n').filter(Boolean).filter(f => f !== SELF);
  const found = [];
  for (const f of files) {
    let buf;
    try { buf = readFileSync(join(ROOT, f)); } catch { continue; } // deleted but still indexed
    if (buf.includes(0)) continue;
    for (const h of scanText(buf.toString('utf8'))) found.push(`${f}:${h.line} ${h.name} ${h.masked}`);
  }
  assert.deepEqual(found, [], 'possible secrets:\n' + found.join('\n'));
});
