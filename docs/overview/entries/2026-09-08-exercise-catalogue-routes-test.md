# 2026-09-08 — the exercise catalogue gets tests, and a guard turns out to be unreachable (PS-39)

**Branch:** `test/exercise-catalogue-routes` · **Lane A** · PS-39, coverage ratchet **62 → 58**.

## What shipped

- `lib/__tests__/exercise-catalogue-routes.test.ts` — 10 cases over `exercise-library`,
  `activity-types` and `exercises/generate`, with the repository and the model mocked.
- `lib/data/postgres/__tests__/exercise-gif-route.test.ts` — 11 cases over `exercise-gif` against
  real rows, because its logic is entirely SQL: which table it prefers, what it skips, what it
  writes back.

No product change.

The two list reads are thin, and what matters is what they are NOT: unscoped catalogue reads that
take no `userId` and still refuse an anonymous caller. `generate` is the one that costs money —
structured output rather than `JSON.parse` of model text, a reported failure answered as a plain
500, a rate limit, and instrumentation under its own section fingerprinted by the exercise name,
which is what makes a spend spike attributable to a route rather than to "AI".

`exercise-gif` pins that generated media beats the legacy cache; that its proxy URLs are derived from
the **name**, because stored URLs may be stale absolute S3 addresses; that a cached row with both
URLs null is ignored rather than served, since null gets cached when the dataset is unreachable and
serving it would make a transient outage permanent; and that the name match is case-insensitive.

## Two cases that proved nothing, both caught the same way

**The null-cache case was vacuous as first written.** It cached nulls under a name nothing could
resolve, so the answer was `{null, null}` whether the route skipped the row or served it. It now
uses a name the **local** override map resolves — no network — so skipping returns a real URL and
serving returns null, and the two are finally distinguishable.

**A `COALESCE` in the write-back turns out to be unreachable, and the mutation pass is what showed
it.** Deleting it changed no answer. Tracing why: the route returns early for any cached row
carrying a URL, so the upsert only ever runs when the existing row is absent or null-on-both — and
`COALESCE(new, NULL)` is `new`. The case that claimed to test it was really testing the early
return, and is renamed to say so. The guard is left in place (it costs nothing, and a future
reordering would need it) with the reasoning recorded beside it, so the next reader does not mistake
it for tested behaviour.

## Mutation pass

16 of 16 caught first time on the mocked file. 5 SQL mutations on the DB file, 4 caught and the
fifth the unreachable `COALESCE` above.

**One honesty note about the tooling, not the code:** a single run of the DB file reported three
failures immediately after the mutation loop restored the route file, then passed on the next four
runs including three consecutive. The plausible mechanism is my own loop's file-restore racing the
test process's read; it is not reproducible and it is not the suite's, but it is recorded rather
than quietly ignored.

## Not exercised

The DB-backed file does not run in CI (no `DATABASE_URL` there). The model is stubbed for
`generate`, so the prompt and schema are asserted but no live generation happens, and the gif
dataset's *network* path is never taken — only its local override map. Web/Node only: no device run,
no native, safe-area, gesture or notification surface.
