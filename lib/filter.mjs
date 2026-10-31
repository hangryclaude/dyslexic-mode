import { analyze } from '../skill/scripts/reread.mjs';
import { rewritePrompt } from './prompt.mjs';

// The renderer wraps every line at 80, so raw line length never reaches the screen.
const SCREEN_HANDLED = new Set(['long-line']);
export const hardHits = text => analyze(text).findings.filter(f => f.severity === 'hard' && !SCREEN_HANDLED.has(f.rule));

// The model runs the pass itself; the linter is the floor. The skill allows one extra rewrite
// when a hard limit still fails, and never a third, so this loop has exactly one retry.
export async function reply(ask, prompt, opts) {
  const first = await ask(prompt, opts);
  const hard = hardHits(first.text);
  if (!hard.length) return { ...first, rewrites: 0, hard: 0 };
  const second = await ask(rewritePrompt(first.text, hard), { ...opts, sessionId: first.sessionId });
  return { ...second, rewrites: 1, hard: hardHits(second.text).length };
}
