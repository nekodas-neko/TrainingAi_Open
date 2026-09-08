# 2026-09-08 — the strength and volume trends get tests, split by what each can prove (PS-39)

**Branch:** `test/strength-trend-routes` · **Lane A** · PS-39, coverage ratchet **75 → 71**.

## What shipped

Four routes, two files, split on what is testable where:

- `lib/data/postgres/__tests__/trend-sql-routes.test.ts` — 15 cases over `strength-trend` and
  `muscle-tonnage-trend` against real Postgres. Skips in CI, like its siblings.
- `lib/__tests__/strength-trend-routes.test.ts` — 14 cases over `workout-load-history` and
  `exercise-estimates` with the repository mocked. Runs everywhere.

No product change.

## Why the split, again

Both trend routes build a query by hand instead of going through the repository, and **everything
they own lives inside that SQL**: the `ws.user_id` scope, `deleted_at IS NULL` across three tables,
bucketing by the local calendar date rather than the UTC timestamp, the main/secondary role
weighting, and the split between library and free-text muscles. A stub answering `db.execute` would
assert that a string was passed somewhere. So those two are tested against rows, and the cases
chosen are the ones a mock is blind to — another user's identical rows, a soft-deleted session or
log or set, a secondary muscle at half weight, and two labels that normalise to one muscle.

The other two own their logic in TypeScript and are mocked. Between them they pin that a session is
matched on its **stable id** with the name only as a fallback (a name match breaks the moment a
session is renamed), that the window is anchored at a local midnight rather than the banned
`Date.now() − N × 86_400_000`, and that a typed starting 1RM lands in `exercise_estimates` rather
than overwriting an earned `personal_records` row (Q-5).

## Mutation pass — 38 across the two files, 4 survivors

Two were real and are fixed:

1. **The five-session fixture was already in ascending order**, so removing the sort changed
   nothing. It is shuffled now, and both "not sorted" and "sorted backwards" are caught.
2. **Every strength fixture sat within three days**, so shrinking the 90-day window to 7 changed no
   answer. A 60-day-old point now carries that case.

Two are equivalent mutants, recorded in the files rather than chased:

- `startRm > 0` in the gain calculation is **unreachable** — the query already filters
  `estimated_1rm > 0`, so nothing a zero could ride in on reaches the JS. A test for it would assert
  a state the route cannot produce.
- `exerciseName.trim()` in the estimates route is a second trim over a value `z.string().trim()` has
  already trimmed. The schema's is the load-bearing one.

## Not exercised

The DB-backed file does not run in CI (no `DATABASE_URL` there), so the SQL guarantees are verified
locally rather than on every push — the existing convention for that directory. Web/Node only
otherwise: no device run, no native, safe-area, gesture or notification surface, no Samsung WebView
rendering.
