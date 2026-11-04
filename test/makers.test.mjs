import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAKERS, OTHER, makerOf, pretty } from '../lib/makers.mjs';

const maker = m => makerOf(typeof m === 'string' ? { model: m } : m).name;

test('a model name says who made it, whichever route carries it', () => {
  const cases = {
    'claude/opus': 'Anthropic', 'claude-sonnet-4.6': 'Anthropic',
    'gpt-5': 'OpenAI', 'opencode-go/gpt-6-luna': 'OpenAI', 'o3-pro': 'OpenAI', 'openai/gpt-oss-20b:free': 'OpenAI', 'chatgpt-4o-latest': 'OpenAI',
    'gemini-3.1-pro': 'Google', 'models/gemini-2.5-flash': 'Google', 'gemma-4-31b': 'Google',
    'grok-4.7': 'xAI', 'x-ai/grok-4': 'xAI',
    'meta-llama/llama-3.3-70b-instruct': 'Meta', 'llama-3.3-70b-versatile': 'Meta',
    'deepseek-v3.2': 'DeepSeek', 'ds-v4-flash-0731-el': 'DeepSeek',
    'mistral-small-3.1': 'Mistral', 'codestral-latest': 'Mistral',
    'qwen3-coder': 'Alibaba', 'opencode-go/kimi-k3.1-pro': 'Moonshot', 'glm-5.3': 'Z.ai',
    'opencode-go/minimax-m3.1-flash': 'MiniMax', 'mimo-v2.6-flash-el': 'Xiaomi',
    'opencode/nemotron-3.5-super-vl-free': 'NVIDIA', 'nova-lite-2': 'Amazon', 'seed-2.0-lite': 'ByteDance',
  };
  for (const [name, who] of Object.entries(cases)) assert.equal(maker(name), who, name);
});

test('a fine-tune belongs to the maker whose name comes first', () => {
  assert.equal(maker('deepseek-r1-distill-llama-70b'), 'DeepSeek');
  assert.equal(maker('deepseek-r1-distill-qwen-32b'), 'DeepSeek');
});

test('with no name to go on, the service\'s owner and then the route decide, else Other', () => {
  assert.equal(maker({ model: 'k3-turbo', owner: 'Moonshot AI' }), 'Moonshot');
  assert.equal(maker({ model: 'k3-turbo', owner: 'Together AI' }), 'Other');
  assert.equal(maker({ model: 'custom-model', provider: 'grok' }), 'xAI');
  assert.equal(maker({ model: 'deepseek-chat', service: 'deepseek' }), 'DeepSeek');
  assert.equal(maker({ model: 'reasoner', service: 'deepseek' }), 'DeepSeek');
  assert.equal(makerOf({ model: 'crouton-alpha-free', provider: 'opencode' }), OTHER);
});

test('every maker has a family name and a colour, and no two share a colour', () => {
  const colors = [...MAKERS, OTHER].map(k => k.color.join());
  assert.equal(new Set(colors).size, colors.length);
  for (const k of MAKERS) assert.ok(k.family && k.color.length === 3, k.name);
});

test('a model id reads as words', () => {
  const cases = {
    'gpt-5': 'GPT-5', 'gpt-4o-mini': 'GPT-4o Mini', 'gpt-5.3-codex': 'GPT-5.3 Codex',
    'claude-opus-4.8': 'Claude Opus 4.8', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
    'models/gemini-2.5-pro': 'Gemini 2.5 Pro', 'meta-llama/Llama-3.3-70B-Instruct': 'Llama 3.3 70B Instruct',
    'llama-3.1-405b': 'Llama 3.1 405B', 'deepseek-v3.2': 'DeepSeek V3.2', 'glm-5.3': 'GLM 5.3',
    'kimi-k2-thinking': 'Kimi K2 Thinking', 'o3-pro': 'o3 Pro', 'grok-4.5': 'Grok 4.5', 'gpt-oss-120b': 'GPT-OSS 120B',
  };
  for (const [id, words] of Object.entries(cases)) assert.equal(pretty(id), words, id);
});
