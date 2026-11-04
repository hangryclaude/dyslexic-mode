import { randomUUID } from 'node:crypto';
import { openaiUsage, unknownUsage } from '../usage.mjs';
import { pretty } from '../makers.mjs';

// Where a service is: its own address, or <ID>_BASE_URL from the environment.
export const baseOf = (service, env = process.env) => (env[`${service.id.toUpperCase()}_BASE_URL`] || service.base).replace(/\/+$/, '');

const headers = (service, key) => ({ 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }), ...service.headers });
const scrub = (text, key) => (key ? String(text).split(key).join('[key]') : String(text));

// A refusal in the service's own words, which usually say what is wrong (a bad key, no credit),
// but never with the key in them. Not every service answers an error in JSON.
async function failure(res, service, key) {
  const raw = await res.text();
  let said = raw;
  try {
    const body = JSON.parse(raw);
    said = (typeof body.error === 'string' ? body.error : body.error?.message) ?? body.message ?? body.detail ?? raw;
  } catch {}
  const text = scrub(String(said).replace(/\s+/g, ' ').trim().slice(0, 240), key);
  const fix = res.status === 401 || res.status === 403 ? ` /key ${service.id} saves a new key.` : '';
  return `${service.name} said ${res.status}${text ? `: ${text}` : ''}.${fix}`;
}

// A service's list also has image, video, speech and embedding models, and this is a chat. Most say
// what a model writes (Poe, OpenRouter, Mistral, Together), but Poe calls some video and voice bots
// text, because they answer with a link. So the name is checked too.
const NOT_CHAT = /embed|whisper|tts|transcri|dall-e|(^|[-/])image|imagen|veo|sora|moderation|guard|rerank|audio|realtime|speech|music|^(babbage|davinci)|kling|flux|pika|seedream|seedance|elevenlabs|liveportrait|mochi|restyler|deepgram|cartesia/i;
function isChat(m) {
  if (NOT_CHAT.test(String(m.id))) return false;
  const out = m.architecture?.output_modalities;
  if (Array.isArray(out)) return out.length === 1 && out[0] === 'text';
  if (typeof m.architecture?.modality === 'string') return /->text$/.test(m.architecture.modality);
  if (m.capabilities && 'completion_chat' in m.capabilities) return Boolean(m.capabilities.completion_chat);
  return !/^(image|embedding|moderation|rerank|audio|transcribe|video|tts)$/.test(m.type ?? '');
}

// Each service names the window its own way, and some not at all.
const num = v => (Number.isFinite(v) && v > 0 ? v : null);
const windowOf = m => num(m.context_length) ?? num(m.context_window) ?? num(m.context_window?.context_length)
  ?? num(m.max_context_length) ?? num(m.top_provider?.context_length) ?? num(m.max_model_len);

// The chat models a service offers, each with a name to show, its owner as the service says it, and
// its window where the service says. A local server that is not running offers nothing, and that is
// not a problem worth reporting.
export async function apiModels(service, { key, fetch = globalThis.fetch, env = process.env, timeout = 10000 } = {}) {
  let res;
  try {
    res = await fetch(`${baseOf(service, env)}/models`, { headers: headers(service, key), signal: AbortSignal.timeout(service.local ? 1500 : timeout) });
  } catch (err) {
    if (service.local) return [];
    throw new Error(`${service.name} could not be reached: ${err.cause?.code ?? err.message}`);
  }
  if (!res.ok) throw new Error(await failure(res, service, key));
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data ?? body.models ?? [];
  return list.filter(isChat).map(m => {
    // Gemini lists models/gemini-2.5-pro but takes gemini-2.5-pro.
    const id = String(m.id).replace(/^models\//, '');
    // OpenRouter names one "Google: Gemini 2.5 Pro". The company shows as a colour instead.
    const label = m.name ? String(m.name).replace(/^[^:]+:\s*/, '') : pretty(id);
    return { id, label, owner: m.owned_by ?? null, contextWindow: windowOf(m) };
  });
}

// A chat with a service. It keeps nothing between requests, so the whole chat goes with each one,
// and an old chat comes back from `history`: its turns, from our chat log. One request per reply,
// streamed, with the same send, interrupt and close as lib/session.mjs. Plain chat only: no tools.
export function openApiSession({ service, model, key, system, history = [], resume, env = process.env, fetch = globalThis.fetch }) {
  const id = resume ?? `api-${randomUUID()}`;
  const url = `${baseOf(service, env)}/chat/completions`;
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...history.flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.text }]),
  ];
  let turn = null, closed = false;

  const post = (body, signal) => fetch(url, { method: 'POST', headers: headers(service, key), body: JSON.stringify(body), signal });

  async function run(t, prompt) {
    messages.push({ role: 'user', content: prompt });
    const body = { model, messages, stream: true, stream_options: { include_usage: true } };
    try {
      let res = await post(body, t.ctl.signal);
      if (!res.ok) {
        const why = await failure(res, service, key);
        // A few services refuse stream_options. Without it the reply streams the same, only with no token counts.
        if (res.status !== 400 || !/stream_options/i.test(why)) throw new Error(why);
        delete body.stream_options;
        res = await post(body, t.ctl.signal);
        if (!res.ok) throw new Error(await failure(res, service, key));
      }
      const usage = await read(t, res.body);
      messages.push({ role: 'assistant', content: t.text });
      return { text: t.text, sessionId: id, usage: openaiUsage(usage) };
    } catch (err) {
      // What came in before a stop stays in the chat, as it stays on screen. A failed or empty
      // turn leaves no trace, so the next message does not follow a question with no answer.
      if (t.stopped && t.text) messages.push({ role: 'assistant', content: t.text });
      else messages.pop();
      if (t.stopped) return { text: t.text, sessionId: id, stopped: true, usage: unknownUsage() };
      throw err;
    }
  }

  // Server-sent events: "data: {chunk}" lines, then "data: [DONE]". Reasoning arrives as
  // reasoning_content or reasoning, and is the model's working, not the reply, so only content shows.
  async function read(t, stream) {
    const decoder = new TextDecoder();
    let buffer = '', usage = null;
    for await (const bytes of stream) {
      buffer += decoder.decode(bytes, { stream: true });
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(data); } catch (err) { throw new Error(`unexpected output from ${service.name}: ${err.message}`); }
        if (ev.error) throw new Error(`${service.name}: ${scrub(typeof ev.error === 'string' ? ev.error : ev.error.message ?? JSON.stringify(ev.error), key)}`);
        // Groq puts its counts under x_groq.
        usage = ev.usage ?? ev.x_groq?.usage ?? usage;
        const text = ev.choices?.[0]?.delta?.content;
        if (text) {
          t.text += text;
          t.onText?.(text);
        }
      }
    }
    return usage;
  }

  return {
    get id() { return id; },
    get busy() { return !!turn; },
    // Nothing to start early: each reply is its own request.
    warm() {},
    send(prompt, { onText } = {}) {
      if (closed) return Promise.reject(new Error('this chat is closed'));
      if (turn) return Promise.reject(new Error('a reply is still running'));
      const t = (turn = { onText, text: '', stopped: false, ctl: new AbortController() });
      return run(t, prompt).finally(() => { if (turn === t) turn = null; });
    },
    // Ends the request. What streamed so far is kept, and the chat carries on from it.
    interrupt() {
      if (!turn || turn.stopped) return false;
      turn.stopped = true;
      turn.ctl.abort();
      return true;
    },
    close() {
      closed = true;
      if (turn) {
        turn.stopped = true;
        turn.ctl.abort();
      }
    },
  };
}
