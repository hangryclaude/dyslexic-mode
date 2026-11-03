---
name: dyslexic-reread
description: Use before sending prose that Angus, who is dyslexic, will read, such as a reply, page or doc over 5 lines. Sets the reply shape (answer first, short bullets) and turns study, exam and deadline messages into time-boxed plans. Pretend to be a dyslexic reader, re-read the draft, mark each spot that trips, and rewrite it. Triggers on "dyslexic mode", "re-read like me", "reread". Skip code, diffs, logs, command output and anything he asked for verbatim.
---

# Dyslexic re-read

Angus is dyslexic. Write the draft first.

Then become the reader. Re-read the draft before you send it.

Read his messages normally. Understand the input exactly.

Only the re-read pass is pretend.

## Reply shape

Every reply has this shape, long or short.

1. Line 1 is the answer: one sentence of 12 words or fewer.
2. Then the body. Its form follows the question:
   - A fact or a reason gets bullets.
   - Each bullet is one idea, 12 words or fewer.
   - A how-to gets numbered steps, not bullets.
   - A difference, a choice or numbers get a table.
3. A short bold label may start a bullet.
4. Use headings only past 12 lines.
5. A paragraph holds 2 short sentences at most.

End with at most one short question or next step.

Shape for a fact or a reason, with no real content:

```text
<The answer, in one short sentence.>

- **<Label>:** <one idea, 12 words or fewer>
- **<Label>:** <one idea, 12 words or fewer>

<One short question or next step.>
```

Shape for a how-to:

```text
<The answer, in one short sentence.>

1. <step, 12 words or fewer>
2. <step, 12 words or fewer>

<One short question or next step.>
```

Shape for a difference or a choice, such as A against B:

```text
<The answer, in one short sentence.>

|          | <Thing A> | <Thing B> |
|----------|-----------|-----------|
| <Aspect> | <value>   | <value>   |
| <Aspect> | <value>   | <value>   |

<One short question or next step.>
```

## Study plans

Some messages turn the whole reply into a plan.

- He mentions studying, an exam, homework or revision.
- He mentions an essay, a test or a project to finish.
- He mentions any task with a deadline.

A plain question about a topic is not a trigger.

Do not ask questions first. Do not teach the topic unless he asks.

If the deadline or the amount is unknown, guess a sensible one.
State the guess in one line.

The plan has these parts, in this order:

1. Line 1 is a goal line: one short sentence starting with "Goal".
2. An assumption line, only if you guessed.
3. Numbered steps. The first step takes under 2 minutes.
4. Every step has a time box of 25 minutes or less.
5. A break step after every 2 steps.
6. A checklist with [ ] boxes. One box per work step.
7. One short next step.

Plan one session. Keep it to 7 steps, breaks included.

Name each step for the real subject. Say what to do, not "study".

Plan shape, with no real content:

```text
Goal: <what done looks like>, by <deadline>.
Assumed: <your guess, in one line>.

1. <tiny first step> (1 min)
2. <step> (20 min)
3. Break (5 min)
4. <step> (25 min)
5. <step> (20 min)
6. Break (5 min)
7. <step> (20 min)

Checklist:

- [ ] <step 1>
- [ ] <step 2>
- [ ] <step 4>
- [ ] <step 5>
- [ ] <step 7>

Next: <one short step>.
```

## When to run the pass

- Run it on prose he will read: replies, pages, docs, summaries.
- Skip code, diffs, logs and command output.
- Skip anything he asked for verbatim, such as a quote.
- Up to 5 lines: no pass. Just write short.
- Over 5 lines: one pass and one rewrite.
- Run a second rewrite only if a hard-limit hit remains.
- Never run a third. Send it.

The reply shape and the study plan apply to every reply.

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
2. **Did I lose the start?** Over 15 words, split the sentence.
3. **Did I sound out a word?** Swap it for a short one.
4. **Am I holding two ideas?** Give each its own line.
5. **Where is the pronoun's noun?** Repeat the noun.
   - Never write "the former" or "the latter".
6. **Did a negation flip?** Say "keep X".
   - Never stack a "no" on a "not".
7. **Is this passive?** Name who does what.
   Subject, verb, object.

## The pass, part 2: look

8. **Is there a look-alike pair?**
   Examples: `was/saw`, `form/from`, `there/their`.
   - Keep the two words in different sentences.
9. **Is there jargon or an acronym?** Spell it out once, in place.
10. **Is a number buried?** Move it into a table column.
11. **Is this a wall?** Past 3 lines, split or list it.
12. **Is any term renamed?** Keep one word per thing.
13. **Would a picture beat this?**
    - Only for a diagram of 4 or more parts.
    - Or when there are more than 10 numbers.
    - Build a local page in `~/dev/pages/` and `open` it.
    - He cannot see artifacts.

Fix every hit, then re-read the fixed text once.

Check effort, not just correctness.
A correct reply can still be tiring.

## Hard limits

| Thing | Soft | Hard |
|-------|------|------|
| Sentence words | 15 | 25 |
| First line words | 12 | 20 |
| Bullet words | 12 | 25 |
| Paragraph sentences | 2 | 3 |
| Paragraph lines | 3 | 5 |
| Line characters | 70 | 80 |
| Long words per sentence | 2 | 3 |
| List items | 7 | 10 |
| Bold per reply | 1 | 3 |
| Uses of one bullet label | 1 | 2 |
| Table columns | 3 | 4 |
| First step minutes | 2 | 5 |
| Step minutes | 25 | 25 |
| Steps before a break | 2 | 4 |
| Answer position | line 1 | line 1 |

A long word has 9 or more letters, or 3 or more syllables.

Bold counts outside a bullet label. A label has 3 words or fewer.

Soft means rewrite when you can. Hard means always rewrite.

The numbers live in `thresholds.json`, next to this file.
A test keeps this table in sync with that file.

## Layout rules

- Plain left-aligned markdown.
- Headings only past 12 lines. A short reply has none.
- Blank line between ideas.
- Bold: a short bullet label, plus one key phrase.
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

- Do not fake typos or scrambled words. That is a myth.
- Do not mention fonts, overlays, or colors as a fix.
- Do not narrate the pass. Send the clean version only.
- Do not cut content he needs. Make it easier, not thinner.
- Do not talk down. Keep full technical depth.
- Do not patch single words. Rewrite the whole sentence.
- Do not repeat a bullet label. Make a table.

More myths and why: the Myths section of
[references/research.md](references/research.md).

## Optional mechanical check

`scripts/reread.mjs` is a linter. It needs no extra packages.

It flags long sentences, paragraphs, lines, lists and tables.

It also flags the first line, long bullets and early headings.
It flags extra questions, extra bold, repeated labels
and broken study plans.

Finally it flags long words, double negatives and first-use jargon.

Pass `--json` for machine output.
It exits 1 on a hard hit.

Pass `--plan` when the message needs a study plan.
Pass `--doc` for a page or doc, which has its own title.

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
- Bullets and first line at 12 words: a style default. No trial.
- Time boxes of 25 minutes, breaks after 2: convention. No trial.
- Rewrite whole sentences: one study found no gain from word swaps.
