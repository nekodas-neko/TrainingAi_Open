# 2026-08-08 — The scale-trend scoping test now owns the account it tests against (Q-146)

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `platform`

## What was wrong

`lib/data/postgres/__tests__/scale-ble-multi-reading.test.ts`'s user-scoping case seeded "another
account" with a row it borrowed rather than created:

```sql
INSERT INTO body_metrics (user_id, date, weight_kg, source_map)
SELECT id, '2026-07-29', 60.0, '…'::jsonb FROM users WHERE id <> $1 LIMIT 1
```

That failed in **both** directions, from the one cause:

- **Locally it errored.** `LIMIT 1` picks the seeded dev user, who already has a `body_metrics` row
  on the hardcoded `2026-07-29` — `scripts/local-db/seed.sql` generates ~2 weeks of metrics
  *relative to today*, and that date sits inside the window as of 2026-08-08. The insert violated
  `body_metrics_user_id_date_key`. Reproduced on a clean checkout of `main`, so it was not a side
  effect of anything in flight.
- **In CI it passed without testing anything.** The Tests job runs `scripts/local-db/migrate.js` and
  **never seeds**, so `users` held only whatever other test files had inserted. With no match the
  INSERT was a silent no-op and `getConfirmedScaleTrendForDate(...) === null` held **because there
  was no other account's reading at all** — not because scoping worked.
- It was also a latent CI flake: which user `LIMIT 1` returns depends on what other files inserted
  by then, so a parallel file's user carrying a `2026-07-29` row reproduces the local error in CI.

## The fix

The file now creates its own `OTHER_USER_ID` in `beforeAll` alongside the existing `TEST_USER_ID`,
inserts that account's reading by id, and deletes both in `afterAll`. No `LIMIT 1` over rows the test
does not own.

It also asserts `rowCount === 1` on the fixture insert. That is the part that stops the failure mode
recurring: without it the test passes just as happily when the other account's reading was never
written, which is exactly the state it used to reach in CI.

## Verified by mutation, not just by going green

A test that had been passing for the wrong reason deserves more than "it's green now". Redirecting
the fixture insert to `TEST_USER_ID` — which makes the trend non-null and so *must* fail a genuine
scoping check — turns the suite red. Restoring it turns it green. Before this change that mutation
would have made no difference in CI, because the insert was a no-op either way.

Full file green (12 tests), no rows left behind afterwards.

## The general lesson, and where it belongs

This is the same class as CLAUDE.md's hardcoded-timestamp rule, one step out: **a fixture must not
depend on state it did not create.** The hardcoded date was incidental — the borrowed row was the
defect. Worth noting the asymmetry that hid it: the seeded local DB and the unseeded CI DB fail
*opposite* ways, so neither environment alone would have revealed it. It surfaced only because the
full suite was run locally, which CLAUDE.md discourages relying on precisely because CI is the
cleaner signal. Here CI was the misleading one.
