import { spawn } from 'node:child_process';

// Puts text on the macOS clipboard. DYSLEXIC_PBCOPY_BIN swaps in a stand-in for tests.
export function copy(text, { bin = process.env.DYSLEXIC_PBCOPY_BIN || 'pbcopy' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', err => reject(err.code === 'ENOENT' ? new Error('copy needs the macOS pbcopy command') : err));
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`pbcopy exited ${code}`))));
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}
