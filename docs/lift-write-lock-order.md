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
| Exercise rename (#4021), both routes | lift lock of each person with a row under both names (user order, bounded) → **every program that holds the old name, whoever owns it, `FOR NO KEY UPDATE` in id order, the wait bounded by `lockWait` (#4096, #4157)** → session exercises → programs (`updated_at`, already locked) → logs → records → estimates → preference rows → the library row | the lock puts it behind a check-in before it holds anything; a person with one preference row is a single row; it touches no plan row. The programs come before the exercise rows, as in the editor's save (below): the save holds its program and wants its exercise rows, the rename used to hold exercise rows and want the program (a 40P01 after ~1.1 s, reproduced gated, #4096). Two renames over programs they share lock them in the same id order. Behind a long holder of a program (a save of a large program, an account deletion's cascade) the wait is bounded like the Coach's: past `lockWait` it is 55P03, which both routes answer as the 409 "busy" with nothing written, not a 57014 at the pool's 15 s limit (#4157; `rename-program-lock-order-4096.test.ts`, lock held from another connection) |
| A check-in's swap accept against a rename, same person (#4098) | accept: lift lock → check-in row → the slot's `session_exercises` row → the session's plan row → the check-in row; rename: as above | traced, no cycle: the rename takes none of the check-in row, the plan rows or a preference row the accept holds, so each side waits on the other's slot row only and never holds what the other wants. Gated tests, both orders: `lock-followups-4098.test.ts` |
| Coach session-exercise apply and undo, against the program editor's save (#4096) | domain lock → **the exercise's program row, `FOR NO KEY UPDATE`, bounded by `lockWait`** → the library row if the swap creates one → the exercise row → (a removal and its undo) the program's `updated_at` → the session's plan row (the void) | the program comes first, as in the editor's save. Before: a removal or its undo updated the exercise row and then the program (40P01 against the save, reproduced gated). A swap for another exercise and a style or position change never moved the program and did not cycle (the save's cascade reaches `session_exercises` before `session_periodization`, so it is queued on the exercise row holding nothing the swap wants; gated test, passes before and after); it takes the program lock anyway so no branch depends on the cascade's order. A wait past `lockWait` is the usual `busy`, nothing written |
| Account deletion and the admin wipe (`slices/account-deletion.ts`, `DELETE FROM users` in one transaction) | none of the lift locks. Waits, exactly as the code sets them: for a **wipe** (`keepAccount`) only, `lock_timeout = '15s'` around the user-write advisory lock, then `lock_timeout = 0` (none) before the row lock and the cascade; a plain **account deletion** sets no `lock_timeout` at all. Both run `users ... FOR UPDATE` under the pool's 15 s `statement_timeout`, then the cascade under `SET LOCAL statement_timeout = '120s'` (`DELETION_STATEMENT_TIMEOUT`) | The cascade deletes the person's plan, preference and program rows in table order, not lift order. So a deletion racing a check-in save can **wait on plan rows for up to 120 s** (the cascade's statement timeout), and the save can wait on the `users` row (a foreign-key insert takes `KEY SHARE`, which the deletion's `FOR UPDATE` blocks) until its own 4 s bound answers busy. It is **not shown that it cannot cycle**: a save holding a plan row that then needs the `users` row, against a deletion holding the `users` row that then needs that plan row, is a cycle; Postgres's deadlock detector would end it (`40P01`, after `deadlock_timeout`, 1 s by default) and one side would roll back whole. That outcome is inferred from Postgres's behaviour, **not reproduced and not analysed further here**. Not given the lift lock: that would put a 4 s busy refusal into a data-destroying path, which is the owner's to decide (#4105) |
| Admin exercise delete (`adapter.ts` `deleteExercise`, the foreign keys' `ON DELETE SET NULL`) | none; one statement | The `SET NULL` updates preference rows, session exercises and check-in rows that reference the exercise, across users, in one statement. A cycle needs a check-in or a Coach write on the same exercise at that moment; the outcome is the same as above (one side rolled back whole, repeatable). An admin catalogue write, rare; not given the lift lock for the same reason (#4105) |
| A generation's store on the AI plan, `storePrescriptionForCurrentPreferences` (#4007) | program lock (lift lock, then `lock_timeout` 4 s) → the lifts' preference rows (a plain select, no row lock) → the caller's restate (a pure function: no read, no model call) → the session's one plan row (one UPDATE, which also reads `workout_sessions` for a finish after the generation began, #4113) | takes the lift lock first, and holds one plan row for one statement. The finish read is a `NOT EXISTS` inside that UPDATE: it takes no lock and no second row. It is taken AFTER the model call and held for the re-read, the restate (CPU only) and one UPDATE, all on the transaction's own connection (measured below), so no lock spans a model call and no statement runs on another pooled connection while it is held. A writer queued behind the lift lock holds nothing |
| Other Coach domains: apply and undo (goals, targets, program phase, early deload, injury, session exercise) | domain lock → that domain's rows | they touch none of the lift writers' rows; a session-exercise apply voids one plan row per statement and holds no second plan row while it waits |
| `restateSpentOneShot`, `voidSessionPrescription`, `consumeLiftOneShot`, `storePrescription` (the plain store, whose UPDATE carries the same `NOT EXISTS` read of `workout_sessions`, #4113: a plan that carries no preference, a program that is not the AI plan, the check-in fit on a read, and the fallback below), `exitDeload`, `advancePhase`, `storePendingTransition`, `incrementSessionsInPhase`, the decrement, `setLastSessionRanPrescription`, `updatePrescriptionStatus`, the cache and replace writers | none | one statement on one row each, released with the statement: they wait on a row, never while holding another (#4097, #4119: `setLastSessionRanPrescription` gained a `NOT EXISTS` read of `workout_sessions`. `incrementSessionsInPhase` is now one `UPDATE ... FROM workout_sessions` that reads the finished workout's own row (`completed_at`, `plan_phase`) and writes only the one `session_periodization` row; `completeWorkoutSession` stamps `plan_phase` in the statement that already stamped `completed_at`. A plain read takes no lock, and none of the three holds a second row or takes a lift lock. Measured: with the lift lock held from another connection, a `workout_log` + `complete_workout` upload took 118-135 ms.) |
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

## The generation's store and a lift change made meanwhile (#4007)

A generation reads the session's lift preferences (rep range, rest, a one-off step or ±1 set, the weekly
check-in's hold) at its start, calls the model (seconds), and stores a plan built from them. A change made in
between (the Coach, the rep-range editor, a check-in save or undo) restates the STORED plan at once, and the
store then replaced that with a plan built from the old preferences. The lock cannot be held across the model
call: that would queue the person's own taps and check-in behind a generation, and every rule above stands.

So the lock is taken only at the store, after the model, in ONE transaction
(`storePrescriptionForCurrentPreferences`, through `withProgramWriteLock`), and what is stored is decided inside it:

1. the lifts' preferences are read again with the same select the start used (`readExercisePreferenceRows`) and compared with
   the stamp of what the plan was built from (`liftPreferencesStamp`: rep range, rest, one-off, whether the check-in holds the
   lift; not the hold's bar);
2. equal: the plan is stored by the same statement as before. Not equal: the generator's `restate` gives the plan IT MADE
   for the preferences now in force (`restateForMovedPreferences`: the Coach's `restatePlan` for a lift whose range, rest or
   one-off moved, the stored-plan hold `holdStoredPrescription` for a lift whose hold moved; its inputs, the held lifts' last bars,
   the personal records and the working bases, were read BEFORE the lock, see the rule below) and THAT plan is stored, before the
   lock is released.

No writer can move a preference while the lift lock is held, and a writer that holds it commits its preference row and its
restated plan together, so the store sees both or neither and what it stores always matches the preferences in force when it
commits, however many changes were made while the model answered. There is no loop and no attempt count. (The first version of
this PR looped three times and then stored with no check; a fourth change in that window was lost. Every attempt can be done
inside one locked transaction, so the loop was deleted rather than patched: one path instead of two.)

- **The rule: no read outside the transaction while the lift lock is held.** The store's transaction holds one pooled
  connection and the lift lock. If anything inside it waited for ANOTHER pooled connection, then as many stores at once as the
  pool has connections (up to 10) would each hold one and wait for one that never frees: the reads fail after the pool's 5 s
  `connectionTimeoutMillis`, the plan is stored as generated, the person's change is lost, and their lift lock was held about 5 s
  (the second independent review measured 3 people on a pool of 3: all 3 changes lost, 5.3 s each; 10 on 10 all lost; 6 on 5
  lost; 5 on 10 all kept). So everything the restate can need (the last bars of the session's lifts, the personal records, the last
  real 1RMs, the typed estimates: `loadRestateReads`, four reads) is read after the model call and BEFORE the lock, for EVERY lift of
  the session, whether or not a preference has moved yet (which lifts moved is only known under the lock). Inside the lock the
  store does only: re-read the preferences on the transaction's connection, compare, run `restate` (a pure function of the generated
  plan, those reads and the preferences just read) and the one UPDATE. Nothing there takes a pooled connection or awaits anything
  but the transaction. No read had to be passed the transaction handle instead: none depends on the preferences read under the lock
  (the held lifts' bars are read for all lifts and picked by name). A new statement added to that function goes on the
  transaction or before the lock, never on the pool.
  - **What this accepts.** The hold's last bar is read before the lock, so a workout log landing between the prefetch and the
    lock is not in the bar the restate uses. That is the same accepted behaviour as the stamp leaving the bar out (a log is not a
    preference and takes no lift lock): the stored plan is healed the next time it is served (`holdStoredPlanUnderCheckin`).
  - **A failed prefetch** stores the plan as generated, without the restate path, and logs one line (as a failed re-read does).
    Tested.
  - **Tests** (`generation-pool-pressure-4007.test.ts`, real Postgres, real Coach writer, model mocked, the restate's reads made
    100 ms slow so the stores overlap): N stores at once for N different people with the pool N wide (N = 3 and 10), preferences
    moved for every person during the model call: every change kept, the slowest request 123 ms (N = 3) and 143 ms (N = 10), and no
    connection left idle in transaction; N + 1 stores on a pool of N: all kept (115 ms, 129 ms). All six tests fail on the previous
    head (`b3bfcb4b`: the reads time out, the plans are stored as generated). A per-backend statement count over the locked section
    sees one backend only.
- **What is held, and for how long.** The lift lock, from the moment the store gets it until commit: the re-read (one select),
  on a moved preference the restate (CPU only) and one UPDATE. Measured against local Postgres with the model mocked, 30 runs each
  (`generation-preference-race-4007.test.ts`, "measures how long the store keeps the lift lock"): **preferences moved: median 5.1
  ms, worst 10.7 ms; nothing moved: median 4.2 ms, worst 8.4 ms**. A writer of the same person that arrives meanwhile waits behind
  it, holding nothing, and then restates the stored plan itself (tested: a rest change queued on the lock while the store waits for
  it ends equal to "landed after the store").
- **Cost of the prefetch.** It is made on every generation that reaches this store (moved or not): four reads, all four started
  together before the lock. Statements per generation on a normal `ai_dynamic` plan, counted over 20 runs with the model mocked:
  `main` 83 (78 on some runs), the previous head of this PR 86 to 91, this head 91 to 96 (+5 against the previous head); median
  time of 20 generations 49 ms on `main` and on the previous head, 55 ms here (noise is about the size of the difference). Nothing is
  skipped for a session without a preference or hold row: a change can arrive after the start's read, and a second code path that
  decides whether to prefetch could be wrong in exactly that case.
- **A failed re-read is not "no preferences".** The re-read inside the transaction throws on a database error (nothing is
  written); the generator then stores the plan as it generated it, with no restate, and logs once. A failure of the restate itself
  (it is pure, so only a bug in it) stores the plan as generated, under the same lock, and logs once; a failure of the reads it needs
  happens before the lock and is covered below. The start's read
  (`loadLiftPreferences`) still answers "no preferences" when it fails, as before, because that is "plan as written" at the
  start; the store's re-read never does.
- **Busy.** The lift lock waits the usual 4 s (two statements, so at most about 8 s); a miss is a `BusyError` and nothing was
  written. The plan is already paid for, so the generator stores it as it always did (plain `storePrescription`) and goes on. The
  same rule as a busy phase move after the model (#4106, next section): no retry, no second model call. What is left in that
  case is the old window: a change made meanwhile is not in that plan until it is next remade. The plain store takes no lock, so
  a writer that holds the lock past 4 s can find the row changed under it and fail as "stale"; `main` stores with no lock at all
  and has the same hazard on every in-flight change, and this PR narrows it to the over-4-second case. Kept.
- **What the busy path costs.** A generation already waits for this lock earlier (the program-phase sync's writes, up to 4 s),
  and the store waits another 4 s: with the lock held 10 s by another connection, from before the request, a generation took
  **8.1 s** here (the reviewer's run: 8.6 s) against 4.6 s on `main`, with the route's limit at 30 s. The two waits do not share a
  budget: the first is a repair inside `syncProgramPhase` that swallows its own `BusyError`, and the store has no way to know how
  much of the 4 s it used without a per-request budget threaded through every repository write; not done. One `error_events` row
  is written for the request: the store's busy row is skipped (`reportOncePerMs`, 30 s, the route's limit) when this person
  already has one from the earlier wait. Tested: 2 rows without it, 1 with it.
- **Cost.** A generation with no change meanwhile adds one transaction after the model: the lock, one select, the same
  UPDATE. Counted with a mocked model: 1 model call with or without a change, 0 wasted.
- **Not covered.** A workout log that consumes a one-off takes no lift lock (one statement). The log's own restate and
  the preferences read's retry (#4007) clean a stamp it leaves in a stored plan, so that case is healed by the
  next preferences read, not by this store. The session's stated minutes are not re-costed after a restate (#4007 item 3, the same
  as the Coach's own restate).
- **Not taken.** Plans for `automatic` and `manual` programs, a plan the model wrote as a whole deload (`deload: true`, its rows
  carry `modelDeload`), a deload phase, a baseline, and a session with no lifts store as before, with the plain store: they carry no
  preference the Coach restates (counted: 0 of them reach the check). A plan with some rows deloaded for soreness
  (`deload: false`) does reach it; both are raced against a change in the test.

## A generation across a workout's finish (#4113)

A Preview workout uploads only at its finish, so the server cannot know it is under way. A generation for the same session
type that read its signals before the finish and is waiting on the model would then store a plan made without that workout,
`auto_applied`, on top of the plan the finish had just spent. The store now refuses it, in the same statement that already
refuses a moved phase and a changed structure (`storePrescriptionRow`, so both the locked store and the plain one):

- **When the generation "read its signals".** `getActiveProgramWithStructureStamp` (the first read of a generation, one
  repeatable-read snapshot with the program and the structure stamp) also returns the session type's latest finish:
  `max(updated_at)` over its completed, not-deleted workouts, as the database's own text (`finishMarker`, microseconds kept). It travels in
  `generatedFor`. No clock of the phone or of the app server is compared: only two readings of the database's own `updated_at`.
  The signals the model reads are read **afterwards, on other connections**, not in this snapshot. The order is safe: a finish
  landing between the marker and the signals is already in the plan, and the store still refuses the plan (one wasted model
  call); it can never pass a plan that lacks a finish.
- **What the store checks.** `NOT EXISTS` a completed, not-deleted workout of this type whose `updated_at`
  is greater than the marker. `completed_at` is the phone's clock and is not compared: an older workout dated ahead of the
  server would otherwise make the marker a future time and hide a real finish. `updated_at` is stamped by the table's `set_updated_at` trigger in the statement that stamps
  `completed_at`, so a finish uploaded late with an old `completed_at` counts. A later edit of a finished workout (its RPE) also
  moves `updated_at`, so it also counts: conservative (the plan is remade at the next open, never kept stale). A finish of another
  session type, a deleted workout, and a finish before the read do not count.
- **Locks.** None added. The finish takes no lift lock (it is one statement and then `updatePrescriptionStatus`, one row, one
  statement), the new read is inside the store's UPDATE, and the model call is unchanged: no second call, no lock across it.
  Measured with the lift lock held 6 s from another connection: a `workout_log` + `complete_workout` upload took 36 ms
  (`generation-across-finish-4113.test.ts`).
- **Order of the finish's two statements.** The finish stamps `completed_at` first and spends the plan second. A store that
  lands between them sees the finish and is refused (the plan it would have replaced is then spent); a store that lands before
  the stamp is spent by the finish as today.
- **Not covered.** An auto-applied phase move (`advanceProgramPhase`) made from signals read before a finish still moves the
  phase; only the plan is refused.

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
| session-state | `ensureSessionPeriodization(..., { read: true })` (INSERT ... ON CONFLICT DO NOTHING) | `readLockWait`, in read mode only | it answers the stored row. It can wait only for an uncommitted insert of the same row; while that is uncommitted there is no row and the GET answers 404, and the next read finds it. A WRITE (a generation, the baseline-complete route) calls it without the mode and waits for that insert to commit, because it goes on to use the row (tested both ways) |
| program-overview | `syncProgramPhase(..., { read: true })`: `setProgramPendingTransition`, `realignProgramPhase`, `setProgramPhase` | try-lock + `readLockWait` (since the first commit of #4098) | the view is built from the rows as they are; the next read repairs |
| program-overview | `voidSessionPrescription` in the `waiting` branch (`{ read: true }`) | `readLockWait` | the stale move offer stays until the next read voids it |
| workout-data, the preferences read, the weekly check-in state | `restateSpentOneShot` (a spent one-shot taken off stored plans, `{ read: true }`); the expired-one-shot clear is `FOR UPDATE SKIP LOCKED`, which never waits | `readLockWait` per plan; the first miss ends this read's restating | the plan still carries the spent step; the next read finds it again (the `stale` select) and restates it |
| weekly check-in state | the `weekly_checkins` row created when a card is due (INSERT ... ON CONFLICT DO NOTHING) | `readLockWait` | no row, so the state says no card yet; the next read creates it and shows the card |

One write on these reads is NOT bounded: the rate limiter's `rate_limits` upsert (INSERT ... ON CONFLICT DO
UPDATE), on `GET /api/next-session/prescription` and `GET /api/weekly-checkin`. It is one short statement on
the person's own counter row, takes no lift lock and no plan row, and only that person's own concurrent
requests can contend on it, each for the length of one statement. It is listed here so the list is complete.

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
