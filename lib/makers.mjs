// Who made a model, read from its name. One route (Poe, OpenRouter, opencode) carries many
// companies' models, so the name says more than the route does. Each company has a colour, so a
// list of a few hundred models reads as a handful of coloured groups, and a family name (Claude,
// GPT, Gemini) for the start screen. /model lists the companies in this order.
export const MAKERS = [
  { name: 'Anthropic', family: 'Claude', color: [217, 119, 87], test: /claude/ },
  { name: 'OpenAI', family: 'GPT', color: [16, 185, 129], test: /(^|[/ ])(chat)?gpt|(^|[/ ])o\d($|[- ])|openai/ },
  { name: 'Google', family: 'Gemini', color: [66, 133, 244], test: /gemini|gemma|(^|[/ ])palm/ },
  { name: 'xAI', family: 'Grok', color: [226, 232, 240], test: /grok|x-ai|(^|[/ ])xai/ },
  { name: 'Meta', family: 'Llama', color: [129, 140, 248], test: /llama|(^|[/ ])meta[-/]/ },
  { name: 'DeepSeek', family: 'DeepSeek', color: [56, 189, 248], test: /deepseek|(^|[/ ])ds-v\d/ },
  { name: 'Mistral', family: 'Mistral', color: [250, 204, 21], test: /mistral|mixtral|codestral|magistral|devstral|ministral|pixtral|voxtral/ },
  { name: 'Alibaba', family: 'Qwen', color: [236, 72, 153], test: /qwen|qwq|qvq/ },
  { name: 'Moonshot', family: 'Kimi', color: [148, 163, 184], test: /kimi|moonshot/ },
  { name: 'Z.ai', family: 'GLM', color: [167, 139, 250], test: /(^|[/ -])glm|z-ai|zhipu/ },
  { name: 'MiniMax', family: 'MiniMax', color: [244, 63, 94], test: /minimax|(^|[/ ])abab/ },
  { name: 'Xiaomi', family: 'MiMo', color: [251, 146, 60], test: /mimo/ },
  { name: 'NVIDIA', family: 'Nemotron', color: [132, 204, 22], test: /nemotron|nvidia/ },
  { name: 'Amazon', family: 'Nova', color: [245, 158, 11], test: /(^|[/ ])nova-|amazon/ },
  { name: 'ByteDance', family: 'Seed', color: [45, 212, 191], test: /(^|[/ ])seed-|doubao|bytedance/ },
  { name: 'Microsoft', family: 'Phi', color: [14, 165, 233], test: /(^|[/ ])phi-?\d|microsoft/ },
  { name: 'Cohere', family: 'Command', color: [190, 242, 100], test: /(^|[/ ])command-|cohere|(^|[/ ])aya-/ },
  { name: 'Perplexity', family: 'Sonar', color: [34, 211, 238], test: /sonar|perplexity/ },
];
export const OTHER = { name: 'Other', family: 'more', color: [156, 163, 175] };

// A route that only carries one company's models says who made a name nothing else matches,
// like a model someone added to their grok config under a name of their own.
const ROUTES = { claude: 'Anthropic', grok: 'xAI', openai: 'OpenAI', gemini: 'Google', xai: 'xAI', deepseek: 'DeepSeek', mistral: 'Mistral', moonshot: 'Moonshot', qwen: 'Alibaba' };

// The maker whose name shows up first wins, so a fine-tune names its maker before its base:
// deepseek-r1-distill-llama is DeepSeek's, not Meta's. Then the service's own word for the owner
// (Poe says "Moonshot AI"), then the route. A service that only hosts, like "Together AI", names
// no maker, so it never matches.
export function makerOf(m) {
  const text = `${m.model ?? m.id ?? ''} ${m.label ?? ''}`.toLowerCase();
  let best = null, at = Infinity;
  for (const maker of MAKERS) {
    const hit = text.search(maker.test);
    if (hit >= 0 && hit < at) { best = maker; at = hit; }
  }
  if (best) return best;
  const owner = String(m.owner ?? '').toLowerCase();
  const owned = owner && MAKERS.find(k => owner === k.name.toLowerCase() || owner.startsWith(`${k.name.toLowerCase()} `));
  return owned || MAKERS.find(k => k.name === ROUTES[m.service ?? m.provider]) || OTHER;
}

const CASE = { gpt: 'GPT', glm: 'GLM', oss: 'OSS', deepseek: 'DeepSeek', minimax: 'MiniMax', mimo: 'MiMo', xai: 'xAI', ai: 'AI', vl: 'VL', ds: 'DS', it: 'IT' };

// A model id as words: gpt-5-mini is GPT-5 Mini, claude-opus-4.8 is Claude Opus 4.8 and
// meta-llama/llama-3.3-70b-instruct is Llama 3.3 70B Instruct. A route's prefix is left out.
export function pretty(id) {
  const words = String(id).split('/').at(-1).split(/[-_\s]+/).filter(Boolean).map(w => {
    const lower = w.toLowerCase();
    if (CASE[lower]) return CASE[lower];
    // Sizes, and the active part of a mixture: 70B, A3B, E4B.
    if (/^[ae]?\d+(\.\d+)?[bkm]$/i.test(w)) return w.toUpperCase();
    if (/^o\d/.test(lower)) return lower;
    return w[0].toUpperCase() + w.slice(1);
  });
  // GPT keeps its hyphen: GPT-5, GPT-4o Mini.
  if (words[0] === 'GPT' && words.length > 1) words.splice(0, 2, `GPT-${words[1]}`);
  return words.join(' ');
}
