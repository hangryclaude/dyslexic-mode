import { startVoice } from './realtime.mjs';

export const NO_KEY = "ChatGPT voice needs an OpenAI key. Type /key to add it. It is saved in your Mac's Keychain, never in a file.";

// Runs a ChatGPT voice chat and turns what it reports into what the screen needs:
//   screen.user(text)          what the user said, once it is written down
//   screen.reply(delta, done)  the reply as it is spoken. done is true once, with an empty delta, at its end
//   screen.note(text) and screen.problem(text)
// onTurn({ q, text }) gets each exchange when it ends, so the app can keep it with the chat, and
// onEnd() fires once when the voice chat is over, whatever ended it. `start` stands in for
// startVoice in tests. Returns { stop }.
export function openVoice({ key, screen, onTurn, onEnd, start = startVoice, ...options }) {
  let heard = '', spoken = '', announced = false;
  return start({
    key,
    ...options,
    onUser: text => {
      heard = text;
      screen.user(text);
    },
    onAssistant: (delta, done) => {
      spoken += delta;
      screen.reply(delta, done);
      if (!done) return;
      if (spoken.trim()) onTurn?.({ q: heard || '(spoken)', text: spoken.trim() });
      heard = spoken = '';
    },
    onState: (name, detail) => {
      if (name === 'listening' && !announced) {
        announced = true;
        screen.note('voice is on. wear headphones and say something. /voice stops it');
      } else if (name === 'error') {
        screen.problem(detail);
      } else if (name === 'closed') {
        // A close the user did not ask for says why. One they asked for has no reason.
        if (detail) screen.problem(detail);
        onEnd?.();
      }
    },
  });
}
