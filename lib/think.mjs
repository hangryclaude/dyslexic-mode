import { LENSES } from './thinking.mjs';
import { explore } from './explorer.mjs';

// How the model thinks. The first four are text at the top of the system prompt. Explorer is
// not text: it changes what happens to a message, so it never reaches the prompt.
export const LEVELS = [
  ['off', 'no special thinking'],
  ['dyslexic', 'big picture first, details last'],
  ['strong', 'writes out a picture, three ways in and a pattern'],
  ['extreme', 'thinks in sketches, not sentences'],
  ['explorer', 'three drafts at once, then one answer'],
];
export const LEVEL_NAMES = LEVELS.map(([name]) => name);

// What goes to systemPrompt({ thinking }). Off adds nothing, so it is left out.
export const promptThinking = level => (level === 'off' || level === 'explorer' ? undefined : level);

const clip = (text, max) => (text.length > max ? text.slice(0, max).trimEnd() + '…' : text);

// The last few turns as plain text. Explorer's calls have no session to remember the chat,
// so the turns ride along inside the question.
export function transcript(history, { turns = 3, max = 700 } = {}) {
  return history.slice(-turns).map(t => `You: ${clip(t.q, max)}\nClaude: ${clip(t.text, max)}`).join('\n\n');
}

export const withHistory = (msg, history) => (history.length ? `Earlier in this chat:\n${transcript(history)}\n\nNew message:\n${msg}` : msg);

// One message in explorer mode: a draft from each lens at the same time, then one pass that
// weighs them. `ask(prompt, { signal })` is a plain one-shot call with no tools, so nothing
// runs three times over. Returns { go, stop }: `go` is the ask that `reply()` runs, which
// explores the first time and makes plain calls after that, like the rewrite pass. `stop` ends
// every call that is running.
export function exploreTurn({ ask, onStatus = () => {} }) {
  const ways = Object.keys(LENSES).length, ctl = new AbortController();
  let calls = 0, explored = false, stopped = false, last = null;
  const call = async prompt => {
    if (calls++ === ways) onStatus(`weighing ${ways} drafts`);
    last = await ask(prompt, { signal: ctl.signal });
    return last.text;
  };
  return {
    async go(prompt) {
      try {
        let text;
        if (explored) text = await call(prompt);
        else {
          explored = true;
          onStatus(`exploring ${ways} ways`);
          ({ text } = await explore(prompt, call));
        }
        return { text, usage: last.usage, contextWindow: last.contextWindow };
      } catch (err) {
        // One draft failing leaves the others running, so end them all.
        ctl.abort();
        if (stopped) return { text: '', stopped: true };
        throw err;
      }
    },
    stop() {
      stopped = true;
      ctl.abort();
      return true;
    },
  };
}
