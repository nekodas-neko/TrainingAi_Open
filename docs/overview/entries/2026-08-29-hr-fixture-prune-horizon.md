# 2026-08-29 — A fixture I wrote crossed a retention horizon and took `main` red

**Lane A · branch `fix/hr-collapse-test-prune-horizon`**

`batch-upsert-duplicate-collapse.test.ts` — written for Q-280 in this session's earlier run — failed
on `main` with `expected [] to deeply equal [ 61, 99 ]`. Nothing had been written; the rows were
gone.

## The cause

`upsertOuraHeartrate` ends with a throttled retention prune:

```ts
db.execute(sql`DELETE FROM oura_heartrate WHERE timestamp < now() - interval '180 days'`)
  .catch(...)   // unawaited, fire-and-forget
```

The test's fixture was `new Date('2026-03-02T00:00:00Z')`. Measured when it broke: **181.05 days
old**. The prune fires on the first call of the day, is not awaited, and therefore races the SELECT —
so the rows were inserted and deleted before the read.

**This is the rule in `CLAUDE.md`, verbatim, and I broke it in my own PR:** *a test may hardcode a
timestamp only when BOTH sides of the comparison are fixed; the moment one side is the real clock, an
absolute date is a time bomb with a known detonation date.* `scale-ble-day-keying.test.ts` is the
previous instance — same shape against an ingest tolerance rather than a retention window. That one
"fires once and then stays red forever", and so did this.

## Why it was easy to write

The 180 was a **SQL literal inside the prune**, and the same number appeared 280 lines further down
as `ZONE_HR_RETENTION_DAYS = 180` — a constant that exists *because* of the prune and whose comment
points at it. Two copies of a number, neither reachable from a test. A retention window is a boundary
fixtures get placed against, and this one was invisible from where fixtures are written.

## The fix

- **`HR_RETENTION_DAYS` is exported and written once.** The prune builds its interval from it and
  `ZONE_HR_RETENTION_DAYS` reads it, so the two can no longer drift and the horizon is importable.
- **The heart-rate fixtures derive from the clock** — `daysAgo(2)` and `daysAgo(3)`, anchored at
  midday rather than midnight, because a boundary is where an off-by-one stops being visible (Q-356).
  Two days back leaves 178 days of margin, so node/Postgres clock skew cannot reach it either.
- **A guard that fires on every run**, not on a date: the fixtures are asserted to sit inside
  `HR_RETENTION_DAYS / 2`. The previous instance of this class sat red for a day before anyone looked,
  and the rule for a regression test here is that it must not wait for the window.

**The other fixtures in the file stay written down.** `oura_bucket`, `sleep_sessions` and
`body_metrics` are compared against nothing but themselves, which is exactly when a fixed date is
allowed. Changing them would be noise.

## Verified

Two mutations, each with an asserted anchor: reverting to the hardcoded fixture reproduces the
original failure, and shrinking `HR_RETENTION_DAYS` below the fixtures trips the new guard. Full
suite green.

## The process lesson, which is the more useful half

The energy-card PR (#586) also went in this session and stranded three assertions in
`one-calorie-budget.spec.ts`; another agent repaired them in #590 before I noticed. **I had run four
E2E specs locally and picked the wrong four.** Two failures in one session from the same root: a
change was checked against the tests I expected to be affected rather than against the suite. On a
UI or storage change the affected set is not guessable — run the whole thing.
