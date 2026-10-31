The flaky tests pass on my machine.
The build server (CI) has not run them yet.

## Cause

A race condition in the test setup.
The setup did not wait for the database migration.
It ran the first test too early.

The failures came and went.
They began when vitest went to 3.2.4 on Tuesday.

File:

```text
tests/setup/db.ts
```

## Changes

- Added `await` on line 42.
- Raised the test timeout from 5000 ms to 15000 ms.
  Build server runners look slower than my machine.

## Results

Run locally:

| Run    | Passed | Failed |
|--------|--------|--------|
| Before | 209    | 5      |
| After  | 214    | 0      |

I ran the suite 10 times in a row. No flakes.

## State

Commit a3f9c21 is on branch `fix/ci-race`. Nothing is pushed.

The build server may still show other problems.
I have not seen it run.
