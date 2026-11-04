// One shape for token use, whichever CLI answered:
//   input        every prompt token the model read this reply, cached or not
//   output       every token it wrote, reasoning included
//   cached       the part of input served from the provider's cache
//   contextUsed  what the conversation occupies once this reply is in it (last call's input + output)
// A field the CLI does not expose is null. Nothing here is estimated.
export const unknownUsage = () => ({ input: null, output: null, cached: null, contextUsed: null });

// Claude Code's result event, which grok's streaming-messages-json copies. Its input_tokens leaves
// out cache reads and writes, so they are added back. Exact for plain chat, where a reply is one
// model call; with tools on the event sums every call in the reply, so contextUsed runs high.
export function claudeUsage(result) {
  const u = result?.usage;
  if (!Number.isFinite(u?.input_tokens)) return unknownUsage();
  const cached = u.cache_read_input_tokens ?? 0;
  const input = u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  // Claude reports the window of the model that answered; grok reports none.
  const contextWindow = Object.values(result.modelUsage ?? {}).map(m => m.contextWindow).find(Number.isFinite);
  return { input, output, cached, contextUsed: input + output, ...(contextWindow && { contextWindow }) };
}

// OpenAI's chat-completions usage, which most services copy. prompt_tokens already holds the cached
// part and completion_tokens the reasoning, so nothing is added back. DeepSeek names its cache hits
// its own way.
export function openaiUsage(u) {
  if (!Number.isFinite(u?.prompt_tokens)) return unknownUsage();
  const input = u.prompt_tokens, output = u.completion_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  return { input, output, cached, contextUsed: input + output };
}

// opencode counts a step's tokens as { input, output, reasoning, cache: { read, write } } with the
// cache reads and writes and the reasoning kept out of input and output (checked against a model
// endpoint that reported them), so they are added back here.
export function opencodeUsage(allSteps) {
  const prompt = s => s.input + s.cache.read + s.cache.write;
  const written = s => s.output + s.reasoning;
  // An endpoint that sends no token counts (some proxies) shows up as a step of all zeros, which no
  // real reply has, so it is not a count.
  const steps = allSteps.filter(s => prompt(s) + written(s) > 0);
  if (!steps.length) return unknownUsage();
  const last = steps.at(-1);
  return {
    input: steps.reduce((n, s) => n + prompt(s), 0),
    output: steps.reduce((n, s) => n + written(s), 0),
    cached: steps.reduce((n, s) => n + s.cache.read, 0),
    contextUsed: prompt(last) + written(last),
  };
}
