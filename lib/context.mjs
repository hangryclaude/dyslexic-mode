export const WINDOW = 200_000;
export const BIG_WINDOW = 1_000_000;

// How big a model's window is. The claude CLI tells the real size after each reply, and a model
// list may know it too. With neither, a model id with [1m] is the 1M version and any other is 200k.
export function contextWindow(model, { known = [], reported } = {}) {
  if (reported > 0) return reported;
  return known.find(m => m.id === model)?.contextWindow || (/\[1m\]/i.test(model ?? '') ? BIG_WINDOW : WINDOW);
}

// A rough count for text nobody has measured yet, like our own system prompt.
export const estimateTokens = text => Math.ceil(text.length / 4);

const FIELDS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'];
const pick = usage => Object.fromEntries(FIELDS.map(k => [k, Number(usage?.[k]) || 0]));

// What the context holds after a call: everything it read, plus what it wrote. Claude's session
// reports four counts. grok and opencode go through lib/usage.mjs, which has already added theirs
// up as contextUsed.
export const usedTokens = usage => (Number.isFinite(usage?.contextUsed)
  ? usage.contextUsed
  : FIELDS.reduce((sum, k) => sum + (Number(usage?.[k]) || 0), 0));

// Whether a reply's usage says anything. A provider that exposes no counts gives nulls, and that is
// not the same as an empty context.
export const hasUsage = usage => Number.isFinite(usage?.contextUsed) || FIELDS.some(k => Number.isFinite(usage?.[k]));

// What a claude result says about the window. Its usage adds up every API call in the turn, so
// a turn that used tools reads far too big. The last call's own numbers, which the stream
// carries, are what the next call starts from, so they win when they are there.
// The window comes from the model that did the most work in the turn.
export function measure(result, call) {
  const found = {};
  const usage = call ?? result.usage;
  if (usage) found.usage = pick(usage);
  const work = m => (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0) + (m.outputTokens ?? 0);
  const [main] = Object.values(result.modelUsage ?? {}).sort((a, b) => work(b) - work(a));
  if (main?.contextWindow > 0) found.contextWindow = main.contextWindow;
  return found;
}

// The three parts of the window. Before any reply there is only our own system prompt to count,
// and that is a guess. After one, the used total is exact and the system prompt is carved out of it.
export function breakdown({ window, usage, system }) {
  const used = usage ? usedTokens(usage) : system;
  const sys = Math.min(system, used);
  return { window, used, measured: Boolean(usage), parts: [['system', sys], ['conversation', used - sys], ['free', Math.max(0, window - used)]] };
}

// Cells of a bar for the parts. A part that exists always shows at least one cell, and the bar
// never looks full while there is room left.
export function barCounts(parts, window, width = 40) {
  const cells = parts.map(([, n]) => (n > 0 ? Math.max(1, Math.round(n / window * width)) : 0));
  let sys = Math.min(cells[0], width), chat = Math.min(cells[1], width - sys);
  if (parts[2][1] > 0 && sys + chat >= width) { if (chat >= sys) chat--; else sys--; }
  return [sys, chat, width - sys - chat];
}

export const FILL = ['▒', '█', '░'];

export const bar = (counts, paint = (i, s) => s) => counts.map((n, i) => paint(i, FILL[i].repeat(n))).join('');

export const count = n => Math.round(n).toLocaleString('en-US');

// A share of the window. Small ones keep a decimal, and one just under 100% is cut, not
// rounded up, so a window that is nearly empty never reads as 100% free.
export function share(n, window) {
  if (n <= 0) return '0%';
  const pct = n / window * 100;
  if (pct < 0.1) return '<0.1%';
  if (pct >= 100) return `${Math.round(pct)}%`;
  return pct >= 99 ? `${(Math.floor(pct * 10) / 10).toFixed(1)}%` : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}
