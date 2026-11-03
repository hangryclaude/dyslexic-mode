# Research behind dyslexic-reread

Only claims that survived adversarial checks (KEEP or DOWNGRADE) are here.
Cut claims are listed under Myths. Full reports: `~/dev/dyslexic-reread/research/`.

Strength scale: strong, moderate, weak-moderate, weak, contested.
Most trials are children, small, and not in English chat. Treat this as a
cheap heuristic pass. It is not clinically proven. Angus's own feedback beats any rule here.

## 1. Cognition: why reading costs more

| Claim | Strength | Implication |
|-------|----------|-------------|
| Adults still decode slowly. Long, rare words cost the most. | strong | Short common words. Define a new term in place. |
| Phonological working memory is small, with weak serial order. | strong | Keep pronoun next to its noun. Number steps. No "the former/the latter". |
| Naming speed predicts adult fluency. The cost is speed, so word count matters. | strong | Cut words. Do not pad. |
| Eye movement is more laborious (Franzen 2021). Longer fixations, fewer skips. | moderate | Answer in line 1. Do not claim extra regressions. |
| Comprehension tracks listening skill and knowledge (Brethes 2022, university students). | moderate | Keep full depth of ideas. Change only the surface. |
| Slowness is the larger adult signal. Accuracy also dips on hard text. | moderate-weak | A reply that looks fine can still cost effort. Check effort. |
| Passive, ambiguous, implausible sentences give more errors. Memory load explains part of it. | weak-moderate | Active voice. Subject, verb, object. No garden-path lines. |
| Visual attention span deficit in a subset. | contested | Plausible reason dense blocks hurt. Use short lines. |
| Reading fatigue: only theses and abstracts. | weak | Assume length costs more. Let the reader stop after line 1. |
| Multi-item naming adds cost. Many similar list items may hurt. | weak | Short lists. Visually distinct items. |
| New written words are learned worse. | weak | Reuse the same term. This is a design choice, not a finding. |

Sources:
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4018562/
- https://acuresearchbank.acu.edu.au/item/87zz6/developmental-dyslexia-in-adults-behavioural-manifestations-and-cognitive-correlates
- https://hal.univ-grenoble-alpes.fr/hal-03756740/document
- https://research.uni-luebeck.de/de/publications/individuals-with-dyslexia-use-a-different-visual-sampling-strateg/
- https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.866543/epub
- https://ueaeprints.uea.ac.uk/id/eprint/72615/ and https://ueaeprints.uea.ac.uk/70361/

## 2. Words and sentences

| Claim | Strength | Implication |
|-------|----------|-------------|
| Frequent words speed reading. Short words help understanding (Rello 2013, 23 dyslexic, Spanish). | weak-moderate | Use "use", not "utilize". |
| Length, frequency, predictability all change reading time (2025 preprint, 19 dyslexic, Danish). | weak | Cut long and rare words first. |
| Predictability had the largest modeled effect (same preprint). | weak | Stock phrasing. One term per thing. |
| Auto-swapping about 10% of words gave no gain. On-demand synonyms were liked more. | moderate | Rewrite the whole sentence. Never patch single words. |
| Ease ratings tracked speed for dyslexic readers only. | weak | Tiebreaker: pick the version that looks easier. |
| Relative clauses: unsettled. | contested | Split anyway. It is cheap. |
| Sentence length has little direct evidence. | weak | Short sentences are a style-guide default. |
| Positive phrasing and no double negatives (BDA guide). Study evidence says negation is hard for everyone. | weak | Say "keep X", not "do not remove X". |
| Readability formulas ignore layout and word familiarity. | moderate | Use scores as a sanity check only. |
| Digits vs words, lists vs prose: no direct evidence. | gap | Convention plus Angus's stated taste. |

Sources:
- https://dl.ifip.org/IFIP-LNCS-8120/hal-01510517
- https://arxiv.org/abs/2510.24647v1
- https://a11y-paradise.onrender.com/reviews/69c080e9fbe1707d6a0f3216
- https://oars.uos.ac.uk/2330/1/brainsci-12-00209-v2.pdf
- https://www.ahrq.gov/professionals/quality-patient-safety/talkingquality/resources/writing/tip6.html
- https://ako.ac.nz/assets/Knowledge-centre/ALNACC-Resources/Dyslexia-resources/230907-Dyslexia-Friendly-Style-Guide.pdf

## 3. Layout the AI controls

The client sets font, size, colour and letter spacing. The AI sets line
breaks, blank lines, emphasis, lists and sentence shape.

| Claim | Strength | Implication |
|-------|----------|-------------|
| Extra letter spacing helped dyslexic children (Zorzi 2012: fewer errors, some speed). Adult evidence is mixed. | moderate (children), weak (adults) | Reduce crowding with whitespace. Short paragraphs. Blank lines. |
| Size mattered more than line spacing (Rello 2013). | weak-moderate | Do not shrink text into small print or dense tables. |
| Paragraph spacing is the one layout lever we hold. WCAG 1.4.12 floor: 2x paragraph gap. | moderate | One idea per short paragraph. |
| Ragged-right text beats justified. WCAG 1.4.8: not justified, 80 characters or fewer. | moderate | Plain left-aligned markdown. Short lines. |
| Italics read worse than roman in Rello and Baeza-Yates 2013. Sample and design are limited, so treat it as a hint. Sans, roman, mono read well. | weak | No italics. Bold sparingly. |
| Underline and ALL CAPS are guide advice. No dyslexia trial found. | weak | Free to follow. Do it. |
| Quiet pages beat decorated ones. | weak | No banners, box art, decorative emoji. |
| Readers restyle spacing (WCAG 1.4.12). | strong as a standard | Use real lists and headings. Avoid padding-space alignment. |
| Real headings, clearly larger than body (BDA). | weak-moderate | Markdown headings for anything over about 12 lines. A shorter reply needs none. |

Sources:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC3396504 (Zorzi 2012, the letter-spacing paper)
- https://www.changedyslexia.org/publications/pdfs/2013-W4A-DysWebxia%20More%20Accessible%20Text.pdf
- https://www.w3.org/WAI/WCAG22/Understanding/text-spacing
- https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation
- https://dyslexiascotland.org.uk/wp-content/uploads/2025/10/formats.pdf
- https://cdn.bdadyslexia.org.uk/uploads/documents/Downloadable-Guides/British-Dyslexia-Association-Guide-for-Employers.pdf

## 4. Numbers, code, terminal output

All weak. These are design heuristics to test on Angus.

| Claim | Strength | Implication |
|-------|----------|-------------|
| Dyslexic programmers gaze at code differently than prose (14 + 14). | weak | Short code blocks. One concern each. Blank lines between steps. |
| Engineers self-report help from highlighting and memorable names. | weak | Fenced blocks with a language tag. Distinct names. |
| Highlighting did not speed code reading in general. | weak | Never let colour carry meaning alone. |
| Text-to-speech helps some readers. Small, mixed. | weak | Write text that survives being read aloud. Full words, not symbols. |
| Phrase-boundary line breaks helped a 14-adult pilot. | weak | Break lines at natural phrases. |
| Numbers, hashes and paths are hard to track (background). | weak | Aligned columns. Hashes cut to 7. Paths on their own line. |
| Answer first, stable order (background, fits BDA headings advice). | weak | Line 1 holds the answer. |
| Needs differ by person (BDA employers guide). | moderate | Defaults plus Angus overrides. |

Sources:
- https://link.springer.com/article/10.1007/s10664-018-9649-y
- https://arxiv.org/abs/2511.00706
- https://oalib-perpustakaan.upi.edu/Record/doaj_d36c28beebb3400583f02ea92a0429c1/Description
- https://www.proliteracy.org/wp-content/uploads/2024/01/6.1.12_Tech-Column.pdf

## 5. What dyslexia is

| Claim | Strength | Implication |
|-------|----------|-------------|
| Language-based, phonological core. Not a vision problem. | moderate | Target decoding load, not shapes. |
| No IQ gap is needed for the phonological deficit (Tanaka 2011, 131 children). | moderate | Simplify the surface. Never the ideas. No condescension. |
| Reversals are common in all beginners. Not diagnostic. | strong | Do not mirror-proof anything. |
| Was/saw swaps look like scanning errors. Preliminary. | weak | Cheap courtesy: avoid look-alike words side by side. |
| Visual stress as a subtype is disputed. | contested | Do not infer it from a disclosure. |

Sources:
- https://pubmed.ncbi.nlm.nih.gov/22006060/
- https://www.brainfacts.org/Diseases-and-Disorders/Childhood-Disorders/2018/Do-People-With-Dyslexia-Read-and-Write-Backwards-082218
- https://www.understood.org/en/articles/faqs-about-vision-and-dyslexia
- https://eprints.whiterose.ac.uk/104441

## 6. Reply shape and study plans

These rows are design choices. They did not go through the adversarial check,
and no trial tests them on dyslexic readers in chat. Each builds on a row above
or on common practice, and costs little to follow. Angus's feedback beats them.

| Choice | Strength | Basis |
|--------|----------|-------|
| Line 1 is the answer, in one short sentence (12 words or fewer). | weak | Answer-first rows in sections 1 and 4. |
| Bullets of 12 words or fewer, one idea each. | gap | Multi-item cost in section 1. No direct trial. |
| Steps in a numbered list, comparisons in a table. | weak | Number steps (section 1). Aligned columns (section 4). |
| A short bold label may start a bullet. | gap | Bold is the safe emphasis (section 3). Labels are a design choice. |
| At most one closing question. | gap | Every extra item costs effort (section 1). |
| Time boxes of 25 minutes, a break after every 2 steps. | gap | Pomodoro convention. No dyslexia trial. |
| A first step that takes under 2 minutes. | gap | Common advice for starting a hard task. No dyslexia trial. |
| A checklist with [ ] boxes at the end of a plan. | gap | Design choice. No direct evidence. |
| Guess the deadline and say so. Never ask first. | gap | Design choice: a question delays the plan and adds reading. |

Sources: none. These are conventions, so the numbers in `thresholds.json` say so.

## Myths: do not do

| Myth | Verdict | Why |
|------|---------|-----|
| Fake typos or scrambled words in replies | do not | No reader benefit. Insulting. |
| Letters appear backwards, so flip or mirror-proof | do not | Language problem, not vision (strong). |
| OpenDyslexic or "dyslexia fonts" fix reading | do not | Null results, Kuster 2018 n=170 (strong). Do not mention fonts. |
| Dyslexie works by its letter shapes | do not | Gain vanished when spacing was matched (Marinus 2016). |
| Colour overlays, tints, Irlen, colour-coded emoji | do not | Systematic reviews cannot endorse (Griffiths 2016). Ritchie 2010: no benefit. |
| Peach is best, blue is worst | do not | Effect hit all readers, one study. Never promise a colour fix. |
| Spacing "doubles accuracy" or ">20% speed" | do not | Cut in verification. Children only. Mixed in adults. |
| Simplify the ideas for a dyslexic reader | do not | Comprehension follows knowledge and vocabulary. Trim the surface only. |
| Dyslexic means unintelligent, so explain gently | do not | No "in simple terms" preamble. |
| Narrate the pass ("I re-read this as...") | do not | Send the clean version only. |
| Style-guide rules are proven | do not | They are consensus. Say "default", not "proven". |
| Flesch score proves it is easy | do not | Formulas fake precision. |
| Every dyslexic reader needs the same thing | do not | Needs are personal. Ask Angus. |
