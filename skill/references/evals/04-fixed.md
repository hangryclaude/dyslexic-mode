This diff is mostly a rename.
It has one real behavior change: retries on 503.

| Item          | Count |
|---------------|-------|
| Files changed | 7     |
| Lines added   | 182   |
| Lines removed | 64    |

## Changes

- **Rename:** `fetchUser` is now `getUser` in 5 files.
  It matches the other accessors. I updated every call site.
- New file `src/lib/retry.ts` wraps outbound requests.
  A 503 response is retried up to 3 times.
  The wait between tries is 200 ms.
- Removed the unused package `lodash.debounce` from `package.json`.
- Added 6 tests for the retry logic.

The retry is the only behavior change. The rest is cosmetic.

## Checks

- Unit tests pass.
- Lint is clean.
- I did not run the full end-to-end suite.

Nothing is committed.
