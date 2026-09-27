# 2026-09-28 — RV-175, server half: one write function per log edit, and outbox domains for them

Editing or deleting a logged exercise, or deleting a whole session, was API-first with no outbox
domain. Offline the app toasted "Updated", then "Failed to update", and the change was gone.

## What shipped

- **The writes moved out of the routes into one place each.** `lib/workout/exercise-log-edits.ts`
  holds `editExerciseLog` and `deleteExerciseLog`, moved verbatim from `PATCH`/`DELETE
  /api/workout-entry`, including the PR reconcile and the recap invalidation.
  `lib/workout/delete-session.ts` gains `deleteWorkoutSessionAndReconcile`, which carries the PR
  reconcile the sessions route used to do on its own. The routes keep auth, body limits and the HTTP
  answers. The existing route tests (35) pass unchanged.
- **Three outbox domains:** `exercise_log_edit`, `exercise_log_delete`, `workout_session_delete`.
  Each `pushMutations` branch calls the same function its route does. A missed edit goes to `errors`
  (retried, then dead-lettered, like `session_rpe`), since its commonest cause is the log still
  queued behind it. A missed delete is success, like Q-328's activity delete, because a replay finds
  the row already gone.
- **`MutationDomain` now derives from `SYNCED_MUTATION_DOMAINS`.** It was a hand-kept copy, identical
  member for member, and the registry's own comment says every domain type derives from it. The
  typechecker then named the one consumer that needed labels: `sync-health-card.tsx` got three
  strings, the only change in a Lane B file, and required to compile.

## Why the device half is not in this PR

The local write methods the hook would call mark rows `synced`, because they were written to mirror
a server-confirmed write. Used offline, a pull before the push would resurrect a deleted log. The
push-confirm switch has no case for the new domains, and an edit that adds a set has no safe local
insert yet. That is LA-165 (Lane A). The hook swap is LA-166 (Lane B, `Needs: LA-165`). Until then
nothing queues the new domains, so they are inert.

## Verification

- `rv175-offline-log-edits-push.test.ts`, 8 cases through `pushMutations`: an edit rewrites and adds
  sets and recomputes volume; a missing log goes to errors; another user's log is untouched by an
  edit or a delete; a log delete takes an emptied session with it; a replayed delete is not an error;
  a session delete tombstones everything and re-derives the PR it held; malformed payloads are rejected.
- **Mutation pass: 4 killed, 1 control survived.** Killed: edit miss counted as processed; the
  session delete skipping the PR reconcile; the ownership check losing its user scope; a replayed
  delete treated as an error.
- `pnpm dev`, over HTTP: `PATCH` 200 and the sets rewritten; `PATCH` of an unknown id 404; `DELETE`
  of the log 200 with `sessionDeleted: true`; `DELETE /api/workout-sessions` 200; `POST /api/sync/push`
  carrying an edit and a session delete returned `processed: 2, errors: []`, with both writes in the DB.
- `check-push-mutations`: OK.

## Not exercised

The device, and anything the owner can see: no client queues these domains until LA-166.
