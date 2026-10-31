# dyslexic mode

A terminal chat with Claude.
Every reply is re-read the way a dyslexic reader reads, then fixed.

## Run it

```bash
node bin/dyslexic-mode.mjs
```

You need the `claude` CLI, logged in. No API key. No packages to install.

## How a reply is made

1. Claude gets the `dyslexic-reread` skill as its system prompt.
2. Claude writes the reply and runs the re-read pass on it.
3. The linter in `skill/scripts/reread.mjs` checks the hard limits.
4. A hard hit gets one rewrite. Never two.

## Commands

| Command | What it does |
|---------|--------------|
| `/pliny` | l33t replies with dividers |
| `/calm` | turns motion off |
| `/new` | starts a fresh chat |
| `/exit` | quits |

Flags: `--model haiku`, `--pliny`, `--calm`.

Pliny mode is for fun. Swapped letters are harder to decode, so it is off by default.
Code, paths and links stay untouched in Pliny mode.

## Test

```bash
npm test
```

## The skill

`skill/` is a copy of `~/.claude/skills/dyslexic-reread`.
It holds the research, rewrite patterns, evals and the linter.
