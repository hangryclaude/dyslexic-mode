const LEET = { o: '0', e: '3', a: '4', i: '1', s: '5', t: '7' };

export const DIVIDER = '•-•-✧•-•-⦑ D Y 5 L 3 X 1 C ⦒-•-•✧•-•-•';

const swap = s => s.replace(/[oeaist]/gi, c => LEET[c.toLowerCase()]);

// Code, inline code, URLs and paths stay untouched: a 0 inside a path or command breaks it.
export function leet(text) {
  return text.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => i % 2 ? part
    : part.split(/(`[^`\n]*`|https?:\/\/\S+|~?\/[\w.\/-]+)/).map((p, j) => j % 2 ? p : swap(p)).join(''),
  ).join('');
}

export const plinyfy = text => `${DIVIDER}\n\n${leet(text)}\n\n${DIVIDER}`;
