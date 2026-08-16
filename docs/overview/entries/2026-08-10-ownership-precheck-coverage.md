# 2026-08-10 — the ownership class the mutation sweep could not see (Q-155, partial)

**Branch:** `test/ownership-precheck-coverage` · **Domain:** `platform` · no version bump (tests only)

Q-155's mutation sweep rewrote all **246** `eq(x.userId, userId)` predicates in the adapter and its
slices and counted what noticed. It named its own blind spot and left it: *"ownership enforced by a
**join or a pre-check** rather than a `user_id` predicate — untouched by this method entirely."*

## How big that blind spot is

Counted from the schema rather than guessed: **13 tables have no `user_id` column at all** —
`session_exercises`, `exercise_logs`, `set_logs`, `style_sets`, `program_sessions`, `program_phases`,
`schedules`, `schedule_days`, `saved_meal_items`, `program_volume_targets`, `exercise_media`,
`friendships`, `exercise_gif_cache`. For every one of those, ownership can only come from a join or
an explicit pre-check — so rewriting `eq(x.userId, userId)` never touched them, and "no predicate
failed" said nothing whatsoever about that class.

## Read before tested, and nothing needed fixing

Each candidate was read before a test was written for it. **No hole was found**, and two things that
looked like holes are not:

- **`removeSessionExercise`** deletes by bare id — but a join pre-check through
  `program_sessions → programs` sits directly above it. A grep for the DELETE alone misses it.
- **`renameExercise`** updates `session_exercises`, `exercise_logs` and `personal_records` **by
  name, across every user**, which reads alarmingly. It is correct: `exercise_library.name` is
  globally UNIQUE, so those are shared-catalogue maintenance on one library row, not a cross-user
  write. (Whether one user renaming a shared exercise *should* change what another user sees is a
  product question, not a security one.)

So this PR fixes nothing. It holds in place guards that were already right, in the class where
nothing was watching them.

## Four tests, each verified by mutation

Two reject/permit pairs, in `repository-ownership-scoping.test.ts` alongside the predicate cases:

| guard | mutation | result |
|---|---|---|
| `removeSessionExercise`'s join pre-check | delete the `if (!owned) return false` | **fails** |
| `ensureWorkoutSession`'s user scope | drop `eq(workoutSessions.userId, userId)` | **fails** |

Every reject case is paired with a **permit** case, because a guard that rejected everyone would
pass the reject half on its own — the trap that made two earlier assertions in this file
unfalsifiable when they were first written.

`ensureWorkoutSession` is the one with the worst consequence if it ever regressed: a caller that
adopted someone else's session id goes on to write `exercise_logs` and `set_logs` into it, and
**neither of those tables has a `user_id` to stop it**. That is why its guard throws rather than
no-ops.

## Verified

- `tsc --noEmit` clean · **434 files / 3461 tests** green · all 19 custom-rule scripts pass.
- Both new guards mutation-tested (table above); both permit paths exercised.

## Not exercised — Q-155 stays open

This covers **2 of the 13** join-owned tables. The remaining eleven — `style_sets`,
`program_sessions`, `program_phases`, `schedules`, `schedule_days`, `saved_meal_items`,
`exercise_media`, `friendships` and the rest — have no pre-check coverage yet, and the honest
reading of this pass is that the class is *sampled*, not closed. Q-155's other residuals are
unchanged: exact per-predicate attribution still needs ~246 individual runs, and only the DB tests
were ever measured, not the full suite.
