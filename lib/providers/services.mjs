import { resolve } from '../commands.mjs';

// AI services that speak OpenAI's chat-completions API, which is most of them. Each takes its key
// from the environment or the Keychain (lib/keys.mjs), except a local server, which needs none.
// <ID>_BASE_URL in the environment points one somewhere else, like a proxy or another computer.
export const SERVICES = [
  { id: 'poe', name: 'Poe', base: 'https://api.poe.com/v1', env: 'POE_API_KEY', note: 'one key for Claude, GPT, Gemini, Grok, Llama and more', site: 'poe.com/api_key' },
  {
    id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', note: 'one key for 300+ models', site: 'openrouter.ai/keys',
    // OpenRouter asks apps to name themselves, so its dashboard can say where requests came from.
    headers: { 'http-referer': 'https://github.com/hangryclaude/dyslexic-mode', 'x-title': 'dyslexic mode' },
  },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', note: 'GPT, and ChatGPT voice', site: 'platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', note: 'Gemini and Gemma', site: 'aistudio.google.com/apikey' },
  { id: 'xai', name: 'xAI', base: 'https://api.x.ai/v1', env: 'XAI_API_KEY', note: 'Grok', site: 'console.x.ai' },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', env: 'DEEPSEEK_API_KEY', note: 'DeepSeek', site: 'platform.deepseek.com' },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY', note: 'Mistral', site: 'console.mistral.ai' },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', note: 'open models, very fast', site: 'console.groq.com/keys' },
  { id: 'cerebras', name: 'Cerebras', base: 'https://api.cerebras.ai/v1', env: 'CEREBRAS_API_KEY', note: 'open models, very fast', site: 'cloud.cerebras.ai' },
  { id: 'together', name: 'Together', base: 'https://api.together.xyz/v1', env: 'TOGETHER_API_KEY', note: 'open models', site: 'api.together.ai' },
  { id: 'moonshot', name: 'Moonshot', base: 'https://api.moonshot.ai/v1', env: 'MOONSHOT_API_KEY', note: 'Kimi', site: 'platform.moonshot.ai' },
  { id: 'qwen', name: 'Alibaba Cloud', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', env: 'DASHSCOPE_API_KEY', note: 'Qwen', site: 'alibabacloud.com/product/modelstudio' },
  { id: 'ollama', name: 'Ollama', base: 'http://localhost:11434/v1', local: true, note: 'models on this computer, no key', site: 'ollama.com' },
  { id: 'lmstudio', name: 'LM Studio', base: 'http://localhost:1234/v1', local: true, note: 'models on this computer, no key', site: 'lmstudio.ai' },
];

export const serviceById = id => SERVICES.find(s => s.id === id) ?? null;

// A service someone typed: its id or name, a unique start of one, or a close spelling, as commands are.
export function findService(typed, list = SERVICES) {
  const t = String(typed ?? '').trim().toLowerCase();
  if (!t) return null;
  const names = [...new Set(list.flatMap(s => [s.id, s.name.toLowerCase()]))];
  const name = resolve(t, names);
  return name ? list.find(s => s.id === name || s.name.toLowerCase() === name) : null;
}
