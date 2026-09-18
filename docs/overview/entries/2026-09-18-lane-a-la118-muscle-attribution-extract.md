# 2026-09-18 — LA-118: four copies of one query, and the decision none of them stated

**Branch:** `lane-a/la118-muscle-attribution-extract` · **Lane A** · no migration · unversioned

## What shipped

`weightedSetsByMuscle(db, { userId, from, toExclusive, dateColumn, programId? })`, private to
`periodization.ts`. `getWeeklySetsByMuscleGroup`, `getSetsByMuscleInWindow` and the
`weekly-muscle-sets` route are callers now rather than copies — three of the four gone, one left on
purpose.

The two things the copies disagreed about are **parameters**, which is the whole design. A caller
has to state its date column and its programme scope rather than inherit whichever one it was
copied from.

## The part that was not a refactor

`weekly-muscle-sets` had **no upper bound at all** — `el.logged_at >= weekStart` and nothing else, so
a log dated in the future counted toward this week forever. It has one now. That is the single
behaviour change in the diff and it is the defect the entry named. Nothing writes future logs today;
the sync path takes a client-supplied `logged_at`, so nothing structurally stopped one.

Everything else is intended to move no numbers, which is why the existing suites passing unchanged
is the actual verification rather than a formality.

## The date column had nothing holding it, in either direction

`getWeeklySetsByMuscleGroup` keys on `ws.started_at`; the other three key on `el.logged_at`. The
entry called this "the decision inside the extraction" and recommended keeping `started_at` only for
the programme-scoped caller, because its unit is a programme session and its two callers grade a week
against that programme's targets.

**No test pinned that.** Every fixture in the repo — mine from this morning included — set
`started_at` and `logged_at` to the same instant, so the parameter could have been flipped in either
direction and the suite would have stayed green. Extracting the copies into one function makes that
worse, not better: before, changing a date column meant editing one query in one file; now it is a
one-word argument at a call site.

So there is a test: a session **started 22:00 yesterday** with its sets **logged 00:30 today**. A
window covering only today sees the set through `getSetsByMuscleInWindow` and does not see it through
`getWeeklySetsByMuscleGroup`. It asserts that the two answers differ and that each is the intended
one.

## What was deliberately left

**`muscle-tonnage-trend` is still its own copy**, exactly as the entry instructed for a first pass.
It sums `weight_kg * reps` and buckets by week, so it shares the attribution half and nothing else —
folding it in means the shared function returns rows for the caller to aggregate rather than a
finished total, which changes the shape for the two callers that are already using it. That is its
own diff and its own gate. LA-118 stays queued with a `Keep:` for it, and notes the trap: the tonnage
route buckets on a local-date **string**, so a fold has to preserve that or its week boundaries move.

Until then the honest count is **two implementations, not one.**

## Verification

| Suite | Result |
|---|---|
| `muscle-sets-window-route.test.ts` | 13 passing (12 → 13, the new date-column case) |
| `weekly-volume-phase-target.test.ts` | 8 passing (6 → 8) |

Mutation pass — three mutations, one per decision the extraction had to preserve, each killed by
exactly the case written for it:

| Mutation | Killed by |
|---|---|
| `programId` scope ignored | *is not what getWeeklySetsByMuscleGroup would have returned* |
| `dateColumn` forced to `logged_at` | *attributes a set by logged_at, where the programme-scoped read uses started_at* |
| route's upper bound removed | *does not count a log dated in the future toward this week* |

The two **deliberately equivalent controls** survived, as they should: *counts sets logged today*
(so a bound that excluded today as well would not pass) and *defaults to the same 90-day window an
explicit request would name*.

Gate: Custom Rules **75 of 75**, `tsc --noEmit` clean.

**A local-run note worth recording:** running the two DB suites together produced
`Hook timed out in 10000ms` on **both** files while all 18 tests passed. Run separately, both are
green. That is local pool contention, the documented `docs/local-dev-database.md` gotcha, not a
result — and "2 files failed, 18 tests passed" is a shape worth recognising rather than debugging.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **The weekly card's own rendering.** `weekly-muscle-sets` now returns a bounded week, and while no
  production row should be affected — that needs a future-dated log to exist — nobody has looked at
  the card since the route changed.
- **`muscle-tonnage-trend`** is untouched and unread by this diff.
