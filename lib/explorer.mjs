import { LENSES, combinePrompt } from './thinking.mjs';

// `ask` sends one prompt to a model and resolves with its text, so the same pipeline runs on any
// model, in the app and in bench/. The drafts run at once: exploring costs calls, not waiting.
export async function explore(question, ask, { format = '' } = {}) {
  const tail = format ? `\n\n${format}` : '';
  const drafts = await Promise.all(Object.entries(LENSES).map(async ([lens, how]) => (
    { lens, text: await ask(`${how}\n\nQuestion:\n${question}${tail}`) }
  )));
  const text = await ask(combinePrompt(question, drafts) + tail);
  return { text, drafts };
}
