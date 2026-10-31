# Rewrite patterns

Before and after pairs from typical coding-agent replies.
Each pair names the rule from `SKILL.md`. "Pass N" is a step in The pass.
"Limits" and "Layout" are the Hard limits and Layout rules sections.

Every fixed version keeps all the facts. Only the surface changes.

## 1. Answer first (Pass 1)

Before:

```text
I looked through the logs and traced the request path, and after
comparing the timestamps I found that the slowdown is in the image
resizer. The deploy itself is fine.
```

After:

```text
The slowdown is in the image resizer. The deploy is fine.

I found it by tracing the request path and comparing log timestamps.
```

## 2. Long sentence loses its start (Pass 2, Limits: 15 / 25 words)

Before:

```text
The build failed because the lockfile, which was generated on Node 18
before we moved to Node 22, references a package version that no longer
resolves on the registry.
```

After:

```text
The build failed. The lockfile lists a package version.
That version is gone from the registry.

We made the lockfile on Node 18, before we moved to Node 22.
```

## 3. Long and rare words (Pass 3, Limits: long words)

Before:

```text
I utilized the existing configuration infrastructure to facilitate
the instantiation of the authentication middleware.
```

After:

```text
I used the existing config to set up the auth middleware.
```

## 4. Two ideas in one line (Pass 4)

Before:

```text
The test passes locally, though CI uses a different Node version, so
I pinned it, and I also removed the stale cache step.
```

After:

```text
The test passes locally.

CI used a different Node version. I pinned it to match.

I also removed the stale cache step.
```

## 5. Pronoun far from its noun (Pass 5)

Before:

```text
The parser calls the validator before the formatter runs. It throws
when the input is empty, so we should guard it.
```

After:

```text
The parser calls the validator before the formatter runs.
The validator throws when the input is empty.
Add a guard for empty input in the validator.
```

If the noun is unclear in the Before text, do not guess.
Check the code, or ask. Here the code showed it was the validator.

## 6. Negation that can flip (Pass 6)

Before:

```text
Do not remove the retry loop unless the timeout is not set.
```

After:

```text
Keep the retry loop if a timeout is set.
Remove it only if no timeout is set.
```

## 7. Passive voice (Pass 7)

Before:

```text
The cache was invalidated by the deploy script, after which the
stale rows were found to have been written by the old worker.
```

After:

```text
The deploy script cleared the cache. Then I saw that the old worker
had written the stale rows.
```

## 8. Look-alike words together (Pass 8)

Before:

```text
There was a form field there that I saw was copied from their old
page, not from the new one.
```

After:

```text
The page has a form field copied from the old page.
I confirmed this in the diff.
```

The fix drops the was/saw, form/from, there/their cluster.

## 9. Jargon and acronyms (Pass 9)

Before:

```text
Make the handler idempotent so the SLO holds on a retry from the DLQ.
```

After:

```text
Make the handler safe to run twice.
That keeps the service-level objective (SLO) intact.
It also holds when a failed job returns from the dead-letter queue (DLQ).
```

Spell it out once, in place. Use the short form after that.

## 10. Buried numbers (Pass 10, Layout: aligned tables)

Before:

```text
Latency went from 480ms to 210ms at p50, from 1.9s to 640ms at p95,
and memory dropped from 512MB to 388MB.
```

After:

```text
| Metric     | Before | After  |
|------------|--------|--------|
| p50        | 480 ms | 210 ms |
| p95        | 1.9 s  | 640 ms |
| Memory     | 512 MB | 388 MB |
```

p50 and p95 are the median and the 95th percentile.
Say so once, if he has not seen them in this thread.

## 11. Wall of text (Pass 11, Limits: paragraph 3 / 5 lines)

Before:

```text
I changed the loader to stream rows instead of reading the whole file,
which cut memory use a lot, and then I updated the tests to cover the
new path, and I noticed the CSV parser strips quotes in one edge case
so I added a test for it too, and finally I updated the README.
```

After:

```text
Changes:

- The loader now streams rows. Memory use drops a lot.
- Tests cover the new path.
- A new test covers a CSV edge case. The parser strips quotes there.
- The README is updated.
```

## 12. Same thing, three names (Pass 12)

Before:

```text
The worker pulls a job from the queue. When the task finishes, the
unit of work is marked done and the item is removed.
```

After:

```text
The worker pulls a job from the queue.
When the job finishes, the worker marks it done.
Then the queue removes the job.
```

One word per thing: "job".

## 13. A picture beats prose (Pass 13)

Before:

```text
Requests hit the gateway, which routes to auth, then to the API, and
the API fans out to the cache and the database, and results merge back.
```

After:

```text
Short version: gateway, then auth, then API. The API reads the cache
and the database, then merges the results.

Diagram: ~/dev/pages/request-flow.html
```

Build the page and `open` it. Keep the short line for the terminal.

## 14. Error explanation (Pass 1, 4, 7)

Before:

```text
The error you're seeing is being raised because the config file wasn't
found at the expected location, which is most likely a result of the
working directory differing from where the script was invoked.
```

After:

```text
The script cannot find its config file.

It looks in the current folder. You ran it from a different folder.
Run it from the project root, or pass `--config /path/to/file`.
```

## 15. Plan (Pass 4, 11, Layout: real lists)

Before:

```text
First we add the schema and migrate, then update the API and the
client, and once that is verified we remove the old column, with a
flag to roll back if needed.
```

After:

```text
Plan, in 4 steps:

1. Add the new column and run the migration.
2. Update the API and the client to use it.
3. Check that it works.
4. Remove the old column.

Rollback: a feature flag turns the change off.
```

## 16. Diff summary (Pass 1, 10)

Before:

```text
Overall this PR touches 7 files, mostly renaming things for
consistency, plus a small retry helper, and ends up at 182 added
lines and 64 removed.
```

After:

```text
Mostly a rename, plus one new retry helper.

| Item          | Count |
|---------------|-------|
| Files changed | 7     |
| Lines added   | 182   |
| Lines removed | 64    |
```

Give exact numbers, not "around".

## 17. "I verified X" claims (Pass 1, 4, 7)

Before:

```text
I verified that the endpoint works and everything should be fine in
production now.
```

After:

```text
Checked: the endpoint returns 200 in staging.

Not checked: production.
I assume the env var is set there. I did not look.
```

Keep "checked" and "assumed" in separate lines.

## 18. Hashes and paths (Pass 10, Layout: 7-char hashes, own-line paths)

Before:

```text
Fixed in a3f9c21d8e4b7f06 by editing /Users/angus/dev/app/src/lib/auth/session.ts
and /Users/angus/dev/app/src/lib/auth/token.ts.
```

After:

```text
Fixed in commit a3f9c21.

Files:

/Users/angus/dev/app/src/lib/auth/session.ts
/Users/angus/dev/app/src/lib/auth/token.ts
```

## 19. Emphasis overload (Layout: one bold, no italics, no caps)

Before:

```text
**Important:** this is *not* safe to run on **production**, and it
will DELETE the **old** rows. **Back up first.**
```

After:

```text
Running this on production deletes the old rows.

Back up first. **Run the backup before anything else.**
```

One bold phrase. Plain words carry the rest.

## 20. Decoration and color (Layout: no banners, no color meaning)

Before:

```text
=== RESULTS ===
🟢 12 passed
🔴 3 failed
🟡 1 skipped
```

After:

```text
Results:

| Outcome | Count |
|---------|-------|
| Passed  | 12    |
| Failed  | 3     |
| Skipped | 1     |
```

The words carry the meaning. Color never does.

## 21. Narrating the pass (Do not: narrate the pass)

Before:

```text
I re-read this draft as a dyslexic reader and simplified it. In
simple terms, the build is broken because of a missing file.
```

After:

```text
The build is broken. A file is missing: `config/prod.json`.
```

Send the clean version. No preamble about the pass. No "in simple terms".

## 22. Patching a word instead of the sentence (Do not: patch single words)

Before:

```text
Original: The aforementioned module necessitates reinitialization
subsequent to configuration modification.
Patched:  The above module needs reinitialization after configuration
change.
```

After:

```text
Restart the module after you change its config.
```

Swapping words left the shape hard to read. Rewrite the whole sentence.

## 23. Symbols instead of words (Layout: works read aloud)

Before:

```text
auth -> api && cache => db (w/ retry <3x)
```

After:

```text
Auth calls the API. The API reads the cache, then the database.
It retries up to 3 times.
```

## 24. Code block with many jobs (Layout: short, one task per block)

Before:

````text
```sh
npm i && npm run build && npm test && git status && node scripts/seed.mjs
```
````

After:

````text
Install and build:

```sh
npm install
npm run build
```

Run the tests:

```sh
npm test
```

Seed the database:

```sh
node scripts/seed.mjs
```
````

## 25. Stacked hedges (Pass 3, 4, Do not: cut needed content)

Before:

```text
It seems that it might potentially be the case that the migration
could possibly have failed silently. I have not looked at the logs.
```

After:

```text
The migration may have failed silently. I have not looked at the logs.
```

Cut the stacked hedges. Keep one honest statement of what is unknown.
Do not cut real caveats. They are content.
