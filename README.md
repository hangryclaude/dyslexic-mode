<h1 align="center">dyslexic mode</h1>

<p align="center">
  <b>Claude, re-read for the way you read.</b><br>
  A terminal chat where every reply is checked the way a dyslexic reader reads it, then fixed.
</p>

<p align="center">
  <img src="media/chat.svg" alt="dyslexic mode: the intro, a question, and a reply with short lines, plain words and clear headings" width="780">
</p>

- Short lines. Plain words. One idea per sentence.
- Type `!` after a reply that tripped you. It learns a rule from it.
- `/think` changes how the model thinks, so you can test what a dyslexic way of thinking does.
- `/help` lists every command. A typo still works: `/clam` runs `/calm`.
- No API key. It runs on the `claude` CLI you already have.

## Run it

```bash
npx github:hangryclaude/dyslexic-mode
```

Or clone it and run `node bin/dyslexic-mode.mjs`.

You need Node 20+ and the `claude` CLI, logged in.
There are no packages to install.
Built and tested on macOS. `/copy` uses `pbcopy`, which comes with it.

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
| Esc | stops a reply while it is being written |
| `/` then Enter | opens the menu. Up and down move, a number jumps, Enter picks |
| `!` | flags the last reply as hard to read |

Keys you type while a reply is coming in wait for the prompt.

## Commands

`/help` shows this list in the app.
Typed commands forgive slips: `/clam` runs `/calm`.
Two commands that start the same way, like `/co`, are never guessed.

| Command | What it does |
|---------|--------------|
| `/help` | every command, grouped |
| `/new` | starts a fresh chat |
| `/clear` | the same as `/new` |
| `/resume` | goes back to an old chat |
| `/compact` | shrinks the chat to a summary and carries on from it |
| `/plan <goal>` | turns a goal into a study plan, saves it, prints the path |
| `/plan` | shows your latest plan |
| `/export` | saves the chat as a markdown file, prints the path |
| `/copy` | copies the last reply |
| `/model` | picks the model with the arrow keys. `/model opus` types it |
| `/think` | picks how the model thinks |
| `/context` | shows how full the context window is |
| `/status` | model, thinking, tools, context, session, voice |
| `/tools` | turns full access on or off |
| `/test` | runs one round of the blind reading test |
| `/stats` | shows the numbers |
| `/profile` | shows the rules it learned from your flags |
| `/color` | switches to the next color set |
| `/brain` | shows a big spinning 3D brain |
| `/calm` | turns motion off |
| `/pliny` | l33t replies with dividers |
| `/voice` | ChatGPT voice. It is being wired in |
| `/exit` | quits |

## Model

`/model` opens a list of models. Up and down move, Enter picks.
`/model haiku` picks one by name. A slip like `/model hiaku` works too.

A new model starts a fresh session, because a session belongs to the model that began it.
The chat stays on screen. The choice is kept for next time.
`--model haiku` is for one launch only.

## Thinking

`/think` sets how the model thinks. It is kept for next time.
Changing it starts a fresh session.

| Level | What it does |
|-------|--------------|
| `off` | no special thinking |
| `dyslexic` | big picture first, details last |
| `strong` | writes out a picture, three ways in, and a pattern |
| `extreme` | thinks in sketches, not sentences |
| `explorer` | three drafts at once, then one answer that weighs them |

The first four are written into the system prompt.

Explorer is different. Each message makes four calls:
a draft by picture, a draft by pattern, a draft as a story, all at once,
then one call that weighs them.
It costs four times the calls. It works without tools.
Each call carries the last three turns as text, so it remembers the chat.
The status line says `exploring 3 ways`.

## Context

`/context` draws the context window as a bar, then splits it in columns:
the system prompt, the conversation, and what is free.

- The conversation and the total come from what Claude reported for the last reply.
- The system prompt is a guess: its characters divided by 4. It is marked `about`.
- The window size is what Claude reports. A model id with `[1m]` counts as 1M, else 200k.

`/compact` asks the chat for a summary of itself,
then starts a fresh session whose first message is that summary.
It shows the tokens before and after.

## Plans and exports

`/plan learn the basics of chess` asks the model for a plan.
It gets one very small first action, under 2 minutes,
then steps of at most 25 minutes each. A longer step is split into equal parts.
You get a checklist with a time box on each line.

Plans are saved in `~/.dyslexic-mode/plans/` as `<date>-<topic>.md`.
Chats from `/export` go in `~/.dyslexic-mode/exports/`.
A second file with the same name gets `-2`. Nothing is overwritten.

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
That folder holds your chats, flags, test rounds, profile, settings, plans and exports.

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

The tests use a fake `claude` and a fake `pbcopy`.
So they make no real calls and never touch your clipboard.

## The skill

`skill/` is a copy of `~/.claude/skills/dyslexic-reread`.
It holds the research, rewrite patterns, evals and the linter.
