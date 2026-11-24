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
| Account deletion and the admin wipe (`slices/account-deletion.ts`, `DELETE FROM users` in one transaction) | none of the lift locks. Waits, exactly as the code sets them: for a **wipe** (`keepAccount`) only, `lock_timeout = '15s'` around the user-write advisory lock, then `lock_timeout = 0` (none) before the row lock and the cascade; a plain **account deletion** sets no `lock_timeout` at all. Both run `users ... FOR UPDATE` under the pool's 15 s `statement_timeout`, then the cascade under `SET LOCAL statement_timeout = '120s'` (`DELETION_STATEMENT_TIMEOUT`) | The cascade deletes the person's plan, preference and program rows in table order, not lift order. So a deletion racing a check-in save can **wait on plan rows for up to 120 s** (the cascade's statement timeout), and the save can wait on the `users` row (a foreign-key insert takes `KEY SHARE`, which the deletion's `FOR UPDATE` blocks) until its own 4 s bound answers busy. It is **not shown that it cannot cycle**: a save holding a plan row that then needs the `users` row, against a deletion holding the `users` row that then needs that plan row, is a cycle; Postgres's deadlock detector would end it (`40P01`, after `deadlock_timeout`, 1 s by default) and one side would roll back whole. That outcome is inferred from Postgres's behaviour, **not reproduced and not analysed further here**. Not given the lift lock: that would put a 4 s busy refusal into a data-destroying path, which is the owner's to decide (#4105) |
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
  try-lock and skip, and every other write a read reaches is bounded by `readLockWait` (next section). Of
  what `/api/workout-data` runs, only the plan generation behind `onRegenerate` is in the background and not
  awaited; the pending-plan adoption, the check-in fit and hold, the preferences restate and the phase
  reconcile are awaited, which is why each is bounded. A write (the transition route, a generation, a
  save) keeps the 4 s wait.

## What a read may write

A read can reach a write: a repair, a stored copy of something it derived, a row it creates on first look.
Each runs in a transaction with `lock_timeout` set LOCAL to `readLockWait` (300 ms), through
`boundedReadWrite` (`slices/periodization.ts`); on a miss it writes nothing, the read answers with what is
stored (exactly as if the write had not been due), and the next read makes the write. Before this, a plain
row UPDATE waited for a check-in's row lock up to the pool's 15 s `statement_timeout`: `/api/workout-data`
measured 15,017 ms with the lift lock and `FOR UPDATE` on the person's plan rows held and a pending plan
present. Found by listing every statement that writes (UPDATE, INSERT, DELETE, `FOR UPDATE`) reachable from
each of: `GET /api/workout-data`, the session-state `GET /api/ai-periodization/session/[id]`, the program
overview `GET`, `GET /api/next-session` and `/prescription`, `GET /api/weekly-checkin`, and the preferences
read they share (`listExercisePreferences`). The Home warm (`POST .../warm`) is not a read: it generates,
which is a write path with the 4 s wait.

| Read path | Write it reaches | Bound | A skipped write means |
|---|---|---|---|
| workout-data, session-state, next-session, next-session/prescription | `adoptPendingPrescription` (a pending plan brought under the AI plan's rule) | `readLockWait`, always | the plan is served as stored, still pending; the next read adopts it |
| the same four, in the applies-to week of a check-in | the fit's `storePrescription` (`{ read: true }`) and the hold's `replacePrescriptionIfUnchanged` | `readLockWait` | the plan is served as stored (fit) or held but unstored (hold: derived from the stored plan and the week's answer, so the same on every read) |
| workout-data | `updatePrescriptionExercisesCache` (not awaited, but it holds a pooled connection while it waits) | `readLockWait` | the cache is not stored; the next read derives it again |
| workout-data, session-state | `reconcileSessionsInPhase` (a count repair; try-locks the lift lock) | `readLockWait` for its row waits, in the same statement | the count is repaired by the next read |
| session-state | `revertAutoAdoptedBaseline` (UPDATE) | `readLockWait` | the stored state is served; the next read reverts |
| session-state | `setBaselineComplete(..., { read: true })` | try-lock + `readLockWait` (since the first commit of #4098) | the baseline is completed by the next read |
| session-state | `ensureSessionPeriodization` (INSERT ... ON CONFLICT DO NOTHING) | `readLockWait` | it answers the stored row. It can wait only for an uncommitted insert of the same row, and a session the read can see already has its row committed, so this is a guard, not a measured case (no test) |
| program-overview | `syncProgramPhase(..., { read: true })`: `setProgramPendingTransition`, `realignProgramPhase`, `setProgramPhase` | try-lock + `readLockWait` (since the first commit of #4098) | the view is built from the rows as they are; the next read repairs |
| program-overview | `voidSessionPrescription` in the `waiting` branch (`{ read: true }`) | `readLockWait` | the stale move offer stays until the next read voids it |
| workout-data, the preferences read, the weekly check-in state | `restateSpentOneShot` (a spent one-shot taken off stored plans, `{ read: true }`); the expired-one-shot clear is `FOR UPDATE SKIP LOCKED`, which never waits | `readLockWait` per plan; the first miss ends this read's restating | the plan still carries the spent step; the next read finds it again (the `stale` select) and restates it |
| weekly check-in state | the `weekly_checkins` row created when a card is due (INSERT ... ON CONFLICT DO NOTHING) | `readLockWait` | no row, so the state says no card yet; the next read creates it and shows the card |

Tests: `lib/data/postgres/__tests__/read-writes-bounded-4098.test.ts` holds the lift lock AND `FOR UPDATE` on
the person's plan rows (or an uncommitted insert of the check-in row) from another connection, for 6 s in
the two route-level cases, and asserts each read returns in well under a second with the stored state, writes
nothing, and that the next read performs the write. All 11 cases take 15 s each against the previous code.
- A baseline workout finished while the lock is busy keeps its measured anchors: the completing write
  rolls back, the partial write (no lock) stores them, and the self-heal completes the phase from them,
  keeping a measured anchor over a personal record.
  Measured by the independent review: after a busy workout end the anchors land about 4 s later (the
  completing write waits its 4 s before giving up, then the partial write stores them), and the phase stays
  `baseline` until the next session-state read completes it.

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

Measured by the review: one busy phase move after a paid model call costs 1 call on that request and 1 more
on the next open of the workout screen.

The busy window is a check-in save or a Coach apply in flight for the same person, a few hundred
milliseconds, so the second call is the usual worst case and a third is a person tapping through
several saves.
