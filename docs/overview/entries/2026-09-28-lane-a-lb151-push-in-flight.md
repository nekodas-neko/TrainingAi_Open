# 2026-09-28 — LB-151: the outbox drains once at a time, and a latecomer's mutation still goes

`pushMutations` had no concurrency guard, and eleven call sites reach it: the pull gesture, the
sync-health card, push-then-revalidate and the per-domain writes. Two overlapping calls both read the
same pending rows and both sent them.

## First, the question the entry said to settle: wasteful or wrong?

**Wasteful, for the writes that matter most.** Completion is stamped `WHERE completed_at IS NULL`,
and the phase counter increments only on a real stamp. `logExerciseFromPayload` ensures the session
by the client's id and upserts the log. So a double drain doubled the upload, not the data. That set
the bar: a guard that must not lose anything, rather than an urgent correctness fix.

## The guard

A per-user single flight **plus one trailing drain.** The naive version, handing a latecomer the
running drain's promise, would be wrong in a quieter way. That drain read the outbox before the
latecomer's mutation existed, so the mutation would sit until some later push. Instead, every caller
that arrives mid-drain shares one trailing drain that starts when the first finishes. The body is
now `pushMutationsOnce`; `pushMutations` is the wrapper.

## Verification

- Four tests: latecomers share one trailing drain and nothing goes out while the first is on the
  wire; a finished drain lets the next start fresh; a failed drain does not wedge the next; and a
  SECOND wave of latecomers gets its own trailing drain.
- **Mutation pass: 4 killed, 1 control survived.** Killed: no guard; latecomers handed the running
  drain; the running entry never cleared; the trailing entry never cleared. The last one survived at
  first, because a single wave cannot see a stale trailing promise; the second-wave test was written
  for it and kills it.
- The two DV-8 source-scanning tests located the drain by the text `export async function
  pushMutations`, which is now the wrapper. They point at `pushMutationsOnce`, where the heals live.
- All 27 client test files that touch `pushMutations` pass (307 tests).

## Not exercised

The device, where the eleven callers actually overlap. The behaviour is pure JS with no native
dependency, so the unit tests exercise the real code path.
