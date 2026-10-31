# dyslexic mode

A terminal chat with Claude.
Every reply is re-read the way a dyslexic reader reads, then fixed.

## Run it

```bash
node bin/dyslexic-mode.mjs
```

You need the `claude` CLI, logged in. No API key. No packages to install.

Just the spinning brain: `npm run brain`. Any key quits.

The brain is ray-marched in 3D for every terminal cell.
Each lobe gets its own color, like an anatomy chart.
It spins in the intro.

## Controls

Press `/` then Enter for the menu.
Arrows move, a number jumps, Enter picks, Esc closes.

Typed commands forgive slips: `/clam` runs `/calm`.

| Command | What it does |
|---------|--------------|
| `!` | flags the last reply as hard to read |
| `/brain` | shows a big spinning 3D brain |
| `/color` | switches to the next color set |
| `/test` | runs one round of the blind reading test |
| `/stats` | shows the numbers |
| `/profile` | shows the rules it learned from your flags |
| `/tools` | turns full access on or off |
| `/new` | starts a fresh chat |
| `/calm` | turns motion off |
| `/pliny` | l33t replies with dividers |
| `/exit` | quits |

## Full access

Full access is on by default.
The chat can use files, the shell, the web, your skills,
Claude agents and Codex.

It loads your own Claude Code settings, so your guard hooks still run.
In a test, dcg blocked `git reset --hard` inside the chat.

`/tools` or `--no-tools` makes it a plain chat with no tools.

## Colors

Each launch picks a color set at random.
There are 7: neon, fire, ocean, toxic, sunset, candy, aurora.

`/color` steps to the next one. `--palette fire` picks one at launch.

## How a reply is made

1. Claude gets the `dyslexic-reread` skill in its system prompt.
2. Claude writes the reply and runs the re-read pass on it.
3. The linter in `skill/scripts/reread.mjs` checks the hard limits.
4. A hard hit gets one rewrite. Never two.

## How it learns

1. Type `!` after a reply that tripped you. Add a note if you like.
2. Claude turns that into one rule in your profile.
3. Your profile goes into every prompt after that.

Your data stays in `~/.dyslexic-mode/`, not in this repo.

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

## The skill

`skill/` is a copy of `~/.claude/skills/dyslexic-reread`.
It holds the research, rewrite patterns, evals and the linter.
