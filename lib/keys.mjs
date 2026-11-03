import { spawnSync } from 'node:child_process';

const SERVICE = 'dyslexic-mode', ACCOUNT = 'openai';

// The OpenAI key is never in the repo or in a file of ours. The environment wins, then the macOS
// Keychain. `run` stands in for spawnSync, so the tests never touch the real Keychain.
export function openaiKey({ env = process.env, run = spawnSync } = {}) {
  const fromEnv = env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const r = run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { encoding: 'utf8' });
  // A missing item makes security exit non-zero, and a machine without it fails to start it.
  // Either way there is no key yet.
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

// -U replaces an existing item, so saving a new key over an old one just works.
export function saveOpenaiKey(key, { run = spawnSync } = {}) {
  const secret = String(key ?? '').trim();
  if (!secret) throw new Error('no key to save');
  const r = run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-w', secret], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    // security's own words help, but never with the key in them, in case it echoes its input.
    const why = String(r.error?.message ?? r.stderr ?? '').split(secret).join('[key]').trim();
    throw new Error(`could not save the key to the Keychain${why ? `: ${why}` : ''}`);
  }
}
