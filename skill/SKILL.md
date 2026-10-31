---
name: dyslexic-reread
description: Use before sending prose that Angus, who is dyslexic, will read, such as a reply, page or doc over 5 lines. Pretend to be a dyslexic reader, re-read the draft, mark each spot that trips, and rewrite it. Triggers on "dyslexic mode", "re-read like me", "reread". Skip code, diffs, logs, command output and anything he asked for verbatim.
---

# Dyslexic re-read

Angus is dyslexic. Write the draft first.
Then become the reader and re-read it before you send it.

Read his messages normally. Understand the input exactly.
Only the re-read pass is pretend.

## When to run it

- Run it on prose he will read: replies, pages, docs, summaries.
- Skip code, diffs, logs and command output.
- Skip anything he asked for verbatim, such as a quote.
- Up to 5 lines: no pass. Just write short.
- Over 5 lines: one pass and one rewrite.
- Run a second rewrite only if a hard-limit hit remains.
- Never run a third. Send it.

## What the reader is like

- Decoding is slow. Long, rare words cost the most.
- Text working memory is small. The start of a long sentence fades.
- Speed is the cost, not smarts. He understands as well as anyone.
- Every extra word costs more effort. Padding hurts.
- Dense blocks crowd the page. White space helps.
- Needs are personal. His feedback beats any rule here.

Evidence and ratings:
[references/research.md](references/research.md).

Most studies are small and use children.
Treat the rules as good defaults.

## The pass, part 1: sense

Read the draft as that reader. Go line by line and ask:

1. **Where is the answer?** It belongs in line 1. Move it up.
2. **Did I lose the start of the sentence?** Over 15 words, split it.
3. **Did I sound out a word?** Swap long or rare words for short ones.
4. **Am I holding two ideas?** Give each idea its own line.
5. **Where is the pronoun's noun?** Repeat the noun.
   Never write "the former" or "the latter".
6. **Did a negation flip?** Say "keep X".
   Never stack a "no" on a "not".
7. **Is this passive?** Name who does what. Subject, verb, object.

## The pass, part 2: look

8. **Is there a look-alike pair?** Examples: `was/saw`, `form/from`,
   `there/their`. Keep the two words in different sentences.
9. **Is there jargon or an acronym?** Spell it out once, in place.
10. **Is a number buried?** Move it into a table column.
11. **Is this a wall?** Past 3 lines, split it or make a list.
12. **Is any term renamed?** Keep one word per thing.
13. **Would a picture beat this?** Only for a diagram of 4 or more
    parts, or more than 10 numbers. Build a local page in
    `~/dev/pages/` and `open` it. He cannot see artifacts.

Fix every hit, then re-read the fixed text once.

Check effort, not just correctness.
A correct reply can still be tiring.

## Hard limits

| Thing | Soft | Hard |
|-------|------|------|
| Sentence words | 15 | 25 |
| Paragraph lines | 3 | 5 |
| Line characters | 70 | 80 |
| Long words per sentence | 2 | 3 |
| List items | 7 | 10 |
| Bold per reply | 1 | 1 |
| Table columns | 3 | 4 |
| Answer position | line 1 | line 1 |

A long word has 9 or more letters, or 3 or more syllables.

Soft means rewrite when you can. Hard means always rewrite.

The numbers live in `thresholds.json`, next to this file.
A test keeps this table in sync with that file.

## Layout rules

- Plain left-aligned markdown.
- Real headings once a reply passes 10 lines.
- Blank line between ideas.
- Bold one key phrase per reply.
- No italics, no underline, no all caps.
- No banners or box art. No emoji for show.
- Never let color carry meaning.

## Numbers, code and pages

- Show numbers in aligned table columns.
- Cut hashes to 7 characters. Put paths on their own line.
- Code goes in fenced blocks with a language tag.
- Keep each block short and focused on one task.
- Write text that still works read aloud. Use words, not symbols.
- Pages for Angus: sans-serif, 18px or more, light background.
- He rejected dark themes twice.

## Do not

- Do not fake typos or scrambled words. That is a myth, not help.
- Do not mention fonts, overlays, or colors as a fix.
- Do not narrate the pass. Send the clean version only.
- Do not cut content he needs. Make it easier to read, not thinner.
- Do not talk down. Keep full technical depth.
- Do not patch single words. Rewrite the whole sentence.

More myths and why: the Myths section of
[references/research.md](references/research.md).

## Optional mechanical check

`scripts/reread.mjs` is a linter. It needs no extra packages.
It flags long sentences, paragraphs, lines, lists and tables.

It also flags long words, double negatives and first-use jargon.

Pass `--json` for machine output. It exits 1 on a hard hit.

```
node ~/.claude/skills/dyslexic-reread/scripts/reread.mjs draft.md
```

The script is a floor, not the pass.
It cannot judge flow, passive voice, pronouns or renamed terms.
Run the human-style pass even when the script is clean.

## Patterns and evals

- Before and after pairs:
  [references/rewrite-patterns.md](references/rewrite-patterns.md)
- Test drafts: `references/evals/`
- Tests: `node --test scripts/`

## Why these numbers

- Sentence 15 and 25: style-guide defaults. Evidence is weak.
- Short common words: modest evidence. Cheap to follow.
- Paragraphs of 3 lines: moderate in children, weak in adults.
- Answer first: eye-tracking shows effortful reading. Data is thin.
- Rewrite whole sentences: one study found no gain from word swaps.
