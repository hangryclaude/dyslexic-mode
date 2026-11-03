import { withStyle, scrambled } from '../lib/thinking.mjs';
import { explore } from '../lib/explorer.mjs';
import { score, seedFrom } from './tasks.mjs';

// A condition is one way of asking the same question:
//   async ({ model, item, runText, runImage }) -> { text, calls }
// `runText` and `runImage` come in as arguments so run.mjs can count calls and cap concurrency, and
// so a test can pass a fake. Every condition ends the prompt with item.format, so the reply can be scored.

const withFormat = (prompt, item) => `${prompt}\n\n${item.format}`;

const once = build => async ({ model, item, runText }) => {
  const { text } = await runText({ model, prompt: build(item) });
  return { text, calls: 1 };
};

const byName = style => once(item => withFormat(withStyle(style, item.prompt), item));

// Any style text, not just the five in lib/thinking.mjs: the evolve step tries new wordings this way.
// Laid out exactly as withStyle lays out a named one, so only the words differ.
export const styled = text => once(item => withFormat(
  text ? `How to think:\n${text}\n\nQuestion:\n${item.prompt}` : item.prompt,
  item,
));

// The most common well-formed answer wins; a tie goes to the earliest reply. Replies that did not
// end in a readable answer do not vote, unless none did.
export function majority(texts, item) {
  const votes = new Map();
  texts.forEach((text, i) => {
    const { got, formatOk } = score(item, text);
    if (!formatOk) return;
    const v = votes.get(got) ?? { n: 0, first: i };
    votes.set(got, { ...v, n: v.n + 1 });
  });
  let best = null;
  for (const v of votes.values()) if (!best || v.n > best.n || (v.n === best.n && v.first < best.first)) best = v;
  return texts[best ? best.first : 0];
}

export const CONDITIONS = {
  base: byName('base'),
  careful: byName('careful'),
  dyslexic: byName('dyslexic'),
  strong: byName('strong'),
  extreme: byName('extreme'),
  // The question is shown the way a dyslexic reader sees it. The seed comes from the item id, so
  // every model reads the same jumble.
  scrambled: once(item => withFormat(scrambled(item.prompt, seedFrom(item.id)), item)),
  // Three drafts from three angles, then one pass that weighs them: four calls.
  async explorer({ model, item, runText }) {
    let calls = 0;
    const ask = async prompt => {
      calls++;
      return (await runText({ model, prompt })).text;
    };
    const { text } = await explore(item.prompt, ask, { format: item.format });
    return { text, calls };
  },
  // The cost-matched control for explorer: three plain answers, then a vote.
  async vote3({ model, item, runText }) {
    const prompt = withFormat(item.prompt, item);
    const replies = await Promise.all([0, 1, 2].map(() => runText({ model, prompt })));
    return { text: majority(replies.map(r => r.text), item), calls: 3 };
  },
};
