# 2026-09-26 — DV-8: heal the 36 food tombstones the confirm fix cannot reach

**Branch:** `fix/dv8-requeue-stranded-tombstones` · **Lane A** · closes DV-8's heal; the `set_logs`
question and the device pass stay open.

The cause shipped earlier today: `pushMutations` deleted a batch's outbox entries and *then* ran an
unguarded per-domain confirm loop, so one arm throwing left every row after it `pending` with its
outbox entry already gone. Nothing retries a mutation that is no longer queued, and `applyDelta`
only overwrites `synced` rows — so those rows were stranded permanently.

**That fix reaches nothing already stranded.** Device Verification measured 36 `food_logs` rows
stuck `pending` with both outboxes empty, every one a delete tombstone, spread over 14 days. This
is the sweep for them.

## What it does, and the one decision that matters

`requeueStrandedFoodTombstones(userId, cutoffIso)` sits in `pushMutations` beside the two sweeps
already there. It finds `food_logs` rows that are `pending`, carry a `deleted_at`, are older than
the grace period, and have no `food_logs` outbox entry — and queues a fresh
`{ id, deleted: true }` mutation for each.

**It re-queues and never marks synced.** A stranded tombstone is indistinguishable from one whose
mutation was never queued at all, so flipping it to `synced` drops a delete the server may never
have seen: the food comes back on the next device, with its calories. Re-pushing costs nothing —
the server's `food_logs` arm branches on `p.deleted` and calls `deleteFoodLog(id, userId)`, a soft
delete by id, so a second delete of an already-deleted row is a no-op. That asymmetry is the whole
argument for a sweep rather than a one-line UPDATE, and it is the assertion the test leads with.

It shares **one** cutoff variable with the workout sweep rather than computing its own. Two
independently-computed cutoffs drift apart under a slow sweep, and the later one can then re-sweep
a row the earlier one has just queued.

## `food_logs` only, deliberately

The confirm-throw cause was generic across all 17 domain arms. The measured population was 36 food
tombstones and **zero** rows in every other table — and the cause is fixed, so a general sweep
would be per-domain SQL maintained for a population that should never grow. If another domain is
ever found stranded it needs its own arm; this one will not reach it. Written into the entry so the
next reader does not assume coverage it does not have.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed on its own.
- Mutation pass, 4 real mutants + 1 control. Marking the row synced instead of re-queueing killed
  3; dropping the `deleted_at` filter, dropping the grace period, and computing a second cutoff
  killed 1 each.
- **The control failed first, and the test was wrong rather than the code.** Renaming the loop
  variable killed two assertions, because they matched `String(r.id)` and `String(r.date)`
  literally — pinning an identifier, not a behaviour. Loosened to `String(\w+\.id)`; the control
  then survived and all four real mutants still die. Source-level tests pin syntax by nature,
  which is the argument for checking them against a rename before trusting them.

## Not exercised — and this is the significant one

**The SQL has never run.** Both vitest projects run in `node`, where `getLocalStore` returns null,
so there is no local SQLite to drive; that is why this file's siblings
(`dv10-supplement-delete-tombstone`, `dv15-stale-pull-cannot-resurrect`) are source-level too. What
is tested here is the statement's shape and the call contract — that the sweep is invoked from
`pushMutations`, before the drain, guarded, with the shared cutoff.

So the heal is **owed a device pass**: zero `pending` rows in local `food_logs` against an empty
outbox on the S25, after a sync. DV-8 keeps that as its first `Keep:`. Until then the honest
statement is that the sweep is written and wired, not that the 36 rows are healed.
