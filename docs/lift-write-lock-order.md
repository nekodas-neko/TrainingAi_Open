# The lift-write lock order

Why this exists: a weekly check-in save and a Coach apply used to deadlock (`40P01`, a 500) because
each took a lift's lock, then a stored-plan row, in a different order (#4082, #4093). One per-user
lock now comes **first** for every writer that holds more than one of a person's plan, preference or
program rows. This page is the list of every such writer and why none of them can be one side of a
cycle. Add a new writer of these tables here in the same PR.

Code: `lib/coach/lock-wait.ts` (`lockLiftWrites`, `tryLiftWrites`, `withDomainLock`, `lockWait`,
`readLockWait`) and `lib/data/postgres/slices/periodization.ts` (`withProgramWriteLock`,
`reconcileSessionsInPhase`).

## The locks

- **Lift lock**: `lockLiftWrites`, a transaction-scoped advisory lock per user, waits at most
  `lockWait` (4 s) and then answers busy. The statements that take it are two, so the worst wait is
  about 8 s.
- **Domain lock**: `withDomainLock`, per user and Coach domain, same bound.
- **Program lock**: `withProgramWriteLock`: lift lock, then `lock_timeout` of 4 s for the row waits.
  `{ read: true }` (#4098) is for a repair made on a READ path: the lift lock is only *tried*, the row
  waits are `readLockWait` (300 ms), and a miss is a `BusyError` the caller skips; the next read
  repairs. Never used by a write.

## The table

| Writer (every statement that writes more than one row of the plan-row, preference or program tables) | Locks, in order | Why it cannot be one side of a cycle |
|---|---|---|
| Coach apply and undo, lift preference | lift lock → name/lift locks → preference row → plan rows → history | takes the lift lock first |
| Weekly check-in save, offer, undo | lift lock (whole transaction) → check-in row → each nested apply/undo (lift lock again, free) | same |
| `setProgramPhase`, `realignProgramPhase`, `setProgramPendingTransition` | program lock → program's plan rows, id order | same |
| `clearProgramPrescriptions` | program lock → one update | same |
| `setBaselineComplete`, `recordBaselineAnchors` (complete) | program lock → program's plan rows, id order → own row | same |
| `recordBaselineAnchors` (partial), `revertAutoAdoptedBaseline` | none | one row, one statement |
| `saveProgram` of an existing program (editor save, with the plan void) | program lock → programs row → sessions, exercises, cascade-deleted plan rows → restore → void | same; a new program has no plan rows and takes no lock |
| `deleteProgram` | program lock → cascade (sessions, plan rows) | same |
| `reconcileSessionsInPhase` | one statement: try-lift-lock, then the update; skips if the lock is not free | never waits for the lock. The try-lock runs first on EVERY call and is held for that one statement, drift or not (#4098: the earlier comment said a read with nothing to repair never took it). While it holds it no other lift-lock taker holds a row, and the lock-free writers hold one row for one statement, so the update's row order cannot cycle |
| `listExercisePreferences` expired clear | `FOR UPDATE SKIP LOCKED` on preference rows | never waits |
| Exercise rename (#4021), both routes | lift lock of each person with a row under both names (user order, bounded) → session exercises → programs → logs → records → estimates → preference rows → the library row | the lock puts it behind a check-in before it holds anything; a person with one preference row is a single row; it touches no plan row |
| A check-in's swap accept against a rename, same person (#4098) | accept: lift lock → check-in row → the slot's `session_exercises` row → the session's plan row → the check-in row; rename: as above | traced, no cycle: the rename takes none of the check-in row, the plan rows or a preference row the accept holds, so each side waits on the other's slot row only and never holds what the other wants. Gated tests, both orders: `lock-followups-4098.test.ts` |
| Rename against the program editor save and the Coach swap (`programs` and `session_exercises` in opposite orders) | not changed | #4096 |
| Account deletion and the admin wipe (`slices/account-deletion.ts`, `DELETE FROM users` in one transaction) | none of the lift locks; its own `lock_timeout` of 15 s | The cascade deletes the person's plan, preference and program rows in table order, not lift order. A cycle needs the same person to save a check-in or apply a Coach change at the very moment the account is deleted. If it forms, Postgres ends it (`40P01`, after about 1 s) and one side rolls back whole: the deletion answers an error and is repeated, or the save answers busy. Nothing is half deleted. Not given the lift lock: that would put a 4 s busy refusal into a data-destroying path, which is the owner's to decide (#4105) |
| Admin exercise delete (`adapter.ts` `deleteExercise`, the foreign keys' `ON DELETE SET NULL`) | none; one statement | The `SET NULL` updates preference rows, session exercises and check-in rows that reference the exercise, across users, in one statement. A cycle needs a check-in or a Coach write on the same exercise at that moment; the outcome is the same as above (one side rolled back whole, repeatable). An admin catalogue write, rare; not given the lift lock for the same reason (#4105) |
| Other Coach domains: apply and undo (goals, targets, program phase, early deload, injury, session exercise) | domain lock → that domain's rows | they touch none of the lift writers' rows; a session-exercise apply voids one plan row per statement and holds no second plan row while it waits |
| `restateSpentOneShot`, `voidSessionPrescription`, `consumeLiftOneShot`, `storePrescription`, `exitDeload`, `advancePhase`, `storePendingTransition`, `incrementSessionsInPhase`, the decrement, `setLastSessionRanPrescription`, `updatePrescriptionStatus`, the cache and replace writers | none | one statement on one row each, released with the statement: they wait on a row, never while holding another |
| `replaceVolumeTargets`, phase-set and phase edits (`program_phases`), `updateProgramPhaseSettings`, `autoRecalibrateCycleAnchor`, `confirmEarlyDeload` | none | no lift writer touches `program_volume_targets` or `program_phases`; the others write one `programs` row |
| On-device SQLite writers | none | not Postgres |

A cycle needs each of two transactions to hold something the other wants. A lock taker waits at the
lift lock before holding any row, so lock takers cannot cycle with each other; the writers that take
no lock hold one row for one statement and wait for nothing while holding it; the only multi-row
writers without the lift lock never wait on a row (`reconcile`, the one-shot clear) or are listed
above as outside the order (rename against the editor, account deletion, the admin delete).

## What a busy answer is, and who may wait

- A write that gives up on a lock rolls back whole and answers **`BusyError`**: a 409 with
  `busy: true` (Coach apply and undo, the transition route, the baseline route, and, since #4098, every
  route that maps a refusal through `refusalResponse`: the program save and delete). Preview's outboxes
  retry a busy 409 with their normal backoff and never count it toward setting a change aside
  (`isRefusedByServer`).
- A **read never waits for a writer** (#4098): the program-phase sync (`syncProgramPhase(..., { read: true })`,
  from `program-overview`) and the session read's baseline self-heal (`setBaselineComplete(..., { read: true })`)
  try-lock and skip. `/api/workout-data` runs the sync and the plan generation in the background
  (never awaited by the read), and `reconcileSessionsInPhase` only ever try-locks. A write (the
  transition route, a generation, a save) keeps the 4 s wait.
- A baseline workout finished while the lock is busy keeps its measured anchors: the completing write
  rolls back, the partial write (no lock) stores them, and the self-heal completes the phase from them,
  keeping a measured anchor over a personal record.

## The true cost of a phase move refused as busy after the model answered (#4098)

On the AI plan the move after the model call can be busy. The paid plan is stored as an **offer**
(pending, the phase untouched). Since #4088 the next open of the workout screen adopts a pending move
by planning it again (`adoptPendingAiPlan`: once per stored plan per local day, and a plan made in the
last 30 s is returned as it is). Counted with a mocked model (`deload-exit-3876.test.ts`):

| Step | Model calls |
|---|---|
| The busy request | 1 (the plan is stored as an offer) |
| The next open of the workout screen | +1 (the offer is planned again; the move lands if the lock is free) |
| **One busy move, then free** | **2: the first offer is thrown away** (an earlier note said 0 wasted; true only until the offer is applied or adopted) |
| Still busy at each later open | +1 per open, each a new offer, so each a new plan for the per-plan cap. Bounded by the 20-an-hour prescribe limit and the one-flight-per-day guard, not by the move |
| Re-reading the same offer in the same day | 0 |

The busy window is a check-in save or a Coach apply in flight for the same person, a few hundred
milliseconds, so the second call is the usual worst case and a third is a person tapping through
several saves.
