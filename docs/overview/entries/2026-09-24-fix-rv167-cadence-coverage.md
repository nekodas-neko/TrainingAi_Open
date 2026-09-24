# 2026-09-24 — RV-167: a cadence stream that starts late no longer stores a fifth of a walk's steps

**Branch:** `fix/rv167-cadence-coverage` · **Lane B** (LB-142)

## What was wrong

Review sweep 57's data census measured it: the 2026-09-04 treadmill walk `d66aa0d7` holds **34
cadence bins, the first at tSec 1470** of an 1,800-second walk, and stored **584 steps**. The other
nine full-strap walks stored 2,888–3,870. HR was present throughout, so the strap was connected and
only the accelerometer stream came late.

Nothing looked wrong from the outside. `cadence_spm` read a healthy 116.9 because the mean is taken
over the bins that exist, not over the walk — a stream covering the last five minutes at a normal
pace produces a normal average. The step count is the only figure that carries the gap, and
`body-metadata` adds it on top of ring steps, so that day's total came out about 2,400 short.

## What shipped

`lib/stores/cadence-coverage.ts` — `cadenceCoverage()` measures nominal series cover
(`bins × CADENCE_SERIES_BIN_SEC`) against the activity's own duration, and `stepsEstimateIfCovered()`
returns null below `MIN_CADENCE_COVERAGE = 0.5`.

**Null below a floor, not scaled.** Scaling a 19%-covered stream up to 100% invents the missing four
fifths and presents the invention as a measurement — the same shape as the phantom walk duration
BF-190 removed two PRs ago, where an early exit saved the whole *planned* session. A missing number
is recoverable; a fabricated one that looks plausible is not.

**The floor is a judgement, not a fit.** The nine good walks' coverage was never recorded, so 50% is
conservative: it discards the measured walk (19%) with room to spare and keeps anything whose stream
covers over half the activity. That reasoning is on the entry, so nobody later reads 0.5 as measured.

**Both write paths, not just the one named.** The entry pointed at `walk-summary.tsx:171`. A grep for
`stepsEstimate` found `lib/stores/activity-store.ts:240` integrating off the same tracker on the
manual-activity screen, with the same absence of a coverage check — the same bug on a second surface,
so it was fixed in the same PR per the sibling-surface sweep.

**Why `lib/stores/` and not `lib/activity/`.** `lib/activity/` is imported by
`app/api/oura/workouts/route.ts` and `app/api/day-timeline/route.ts`, which makes it Lane A by the
path rule. `lib/stores/` is Lane B outright and already holds the one consumer that is not a
component. Reversal cost is a file move and two imports.

## Verification

`lib/stores/__tests__/rv167-cadence-coverage.test.ts` — 10 tests. The first reproduces the production
walk's numbers exactly; the rest hold the boundaries that are easy to get wrong: the cap at 1 (a walk
stopping mid-bin nominally covers 100.6%), the exact-floor case in both directions, and the
distinction between *poor* coverage and *unjudgeable* coverage — a zero duration or an empty series
returns null rather than 0, because "cannot tell" must not discard good steps.

**Control run:** with both call sites reverted to the raw `stepsEstimate`, 3 of the 10 fail; restored,
10 pass. The source assertions are what catch a future revert of the wiring.

Not exercised: the device. Whether the H10's accelerometer stream commonly starts late is now the
open half — a walk that trips the floor stores no steps at all, so if this is frequent the answer is
to fix the stream, not to lower the floor. RV-167 stays in the queue as `Lane: DV` with that as its
`Keep:`, with an objective pass/fail (start a walk with the strap already worn; record the tSec of
the first bin against the walk's start).

## Also in this PR

**RV-166 gets a `Needs: RV-170`.** It was blocked — its rider question (*does a guided or treadmill
walk on a prescribed day count as doing the run?*) is unanswered — but the block lived in prose
inside the `Lane:` line, so `next-item.js` offered it as Lane B's ready work twice. `Needs:` is the
field the runner reads; prose is not.
