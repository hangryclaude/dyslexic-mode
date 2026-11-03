<h1 align="center">dyslexic mode</h1>

<p align="center">
  <b>Claude, re-read for the way you read.</b><br>
  A terminal chat where every reply is checked the way a dyslexic reader reads it, then fixed.
</p>

<p align="center">
  <img src="media/chat.svg" alt="dyslexic mode: the intro, a question, and a reply with short lines, plain words and clear headings" width="780">
</p>

- Short lines. Plain words. One idea per sentence.
- Tab reads any reply aloud and lights up each word as it is said.
- Type `!` after a reply that tripped you. It learns a rule from it.
- No API key. It runs on the `claude` CLI you already have.

## Run it

```bash
npx github:hangryclaude/dyslexic-mode
```

Or clone it and run `node bin/dyslexic-mode.mjs`.

You need Node 20+ and the `claude` CLI, logged in.
There are no packages to install.
Read aloud uses `say`, which comes with macOS.
Built and tested on macOS.

`-c` goes back to your last chat.

## The brain

<p align="center">
  <img src="media/brain.svg" alt="a 3D brain drawn in colored text, spinning" width="560">
</p>

The brain is ray-marched in 3D for every terminal cell.
Each lobe gets its own color, like an anatomy chart.
It spins in the intro.

Just the brain: `npm run brain`. Any key quits.

The two pictures above are real recordings of the app.
`tools/capture.mjs` makes them from tmux. No recorder needed.

## Keys

| Key | What it does |
|-----|--------------|
| Tab | reads the last reply aloud. Tab again stops it |
| Esc | stops a reply while it is being written, or stops the voice |
| `/` then Enter | opens the menu |
| `!` | flags the last reply as hard to read |

Keys you type while a reply is coming in wait for the prompt.

## Commands

Typed commands forgive slips: `/clam` runs `/calm`.

| Command | What it does |
|---------|--------------|
| `/read` | reads the last reply aloud, full screen |
| `/voice` | reads every reply aloud, on or off |
| `/resume` | goes back to an old chat |
| `/new` | starts a fresh chat |
| `/test` | runs one round of the blind reading test |
| `/stats` | shows the numbers |
| `/profile` | shows the rules it learned from your flags |
| `/tools` | turns full access on or off |
| `/color` | switches to the next color set |
| `/brain` | shows a big spinning 3D brain |
| `/calm` | turns motion off |
| `/pliny` | l33t replies with dividers |
| `/exit` | quits |

## Read aloud

Tab reads the reply right where it is.
The word being said lights up, so your eyes and ears stay together.

`/read` opens a full-screen reader.
The paragraph being read stays bright. The rest fades back.

| Key in the reader | What it does |
|-------------------|--------------|
| Space | pause or play |
| ← → | back or on one paragraph |
| - + | slower or faster |
| Esc | back to the chat |

Step numbers are read out. Code and links are not.
Table rows are read cell by cell, with a short pause between.

The speed you pick is kept for next time.
`--rate 200` sets it.

`--voice Daniel` picks a voice.
`say -v '?'` lists the voices on your Mac.

## How a reply is made

1. Claude gets the `dyslexic-reread` skill in its system prompt.
2. Claude writes the reply and runs the re-read pass on it.
3. Each line shows as soon as it is complete. Tables wait for their last row.
4. The linter in `skill/scripts/reread.mjs` checks the hard limits.
5. A hard hit gets one rewrite. Never two.
   It takes the draft's place on screen.

One Claude process runs for the whole chat.
So a message has no start-up wait.
Your tool servers stay up between messages too.

Most of the wait before the first line is Claude thinking.
That thinking is where the re-read pass happens.

Once the first words arrive, the first line shows in about 0.2 seconds.

## The screen

- Lines are at most 72 characters. `--width 60` makes them shorter.
- Tables are drawn as boxes. Numbers line up on the right.
- A table too wide for the line wraps inside its cells.
- Headings get a colored bar. Code gets a bar down its side.
- Italics are shown upright, because italics read worse.

## Full access

It starts as a plain chat. Claude has no tools.

`--full` or `/tools` gives it full access.
Then the chat can use files, the shell, the web, your skills,
Claude agents and Codex.

Full access skips Claude's permission prompts.
Only turn it on if you trust what you ask it to do.

It loads your own Claude Code settings, so your guard hooks still run.
In a test, a guard hook blocked `git reset --hard` inside the chat.
The status line shows each tool call while it runs.

## Colors

Each launch picks a color set at random.
There are 7: neon, fire, ocean, toxic, sunset, candy, aurora.

`/color` steps to the next one. `--palette fire` picks one at launch.

## How it learns

1. Type `!` after a reply that tripped you. Add a note if you like.
2. Claude turns that into one rule in your profile.
3. Your profile goes into every prompt after that.

Your data stays in `~/.dyslexic-mode/`, not in this repo.
That folder holds your chats, flags, test rounds, profile and settings.

## The reading test

Each `/test` round asks one question and gets two answers.
One is plain Claude. One is the re-read version.

You read them in random order and press Enter when done.
Then you pick the easier one.
After 10 rounds, `/stats` has the answer.

Other flags: `--model haiku`, `--pliny`, `--calm`.

Pliny mode is for fun. It is off by default,
because swapped letters are harder to decode.
Code, paths and links stay untouched in Pliny mode.

## Test

```bash
npm test
```

The tests use a fake `claude` and a fake `say`.
So they make no real calls and play no sound.

## The skill

`skill/` is a copy of `~/.claude/skills/dyslexic-reread`.
It holds the research, rewrite patterns, evals and the linter.
