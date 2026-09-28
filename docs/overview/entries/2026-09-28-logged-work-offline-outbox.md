# LA-166 — the last three writes that failed instead of queueing

**Branch:** `fix/logged-work-offline-outbox` · **Lane B** · `lib/hooks/use-day-entry-mutations.ts`.

Editing a logged exercise, deleting one, and deleting a whole session all `fetch`ed first and
mirrored into the local store only after a 2xx. Offline that means a toast saying **"Updated"**,
then one saying **"Failed to update"**, and nothing queued — the change is gone. `handleDeleteActivity`
in the same hook has done this correctly since Q-328; these three are the last of its siblings.

## What shipped

Each handler now writes locally in **pending** mode and queues its domain, exactly as the activity
delete does:

| handler | local write | domain | payload |
|---|---|---|---|
| `handleEditSave` | `updateExerciseLogLocally(…, { pending: true })` | `exercise_log_edit` | `exerciseLogId`, `weights`, `reps` |
| `handleDeleteExercise` | `deleteExerciseLogLocally(…, { pending: true })` | `exercise_log_delete` | `exerciseLogId` |
| `handleDeleteSession` | `deleteWorkoutSessionLocally(…, { pending: true })` | `workout_session_delete` | `workoutSessionId` |

`pending`, not the default `synced`: a synced row is one a pull may clobber before the push lands,
and `applyDelta` reaps a synced tombstone — so a delete left synced would undo itself. The row moves
to synced on push confirmation. LA-165 added the flag and the three push handlers; this is the client
half of RV-175 that uses them.

The toast now fires after the **local** write rather than after the network, which is the
saves-feel-instant rule and, offline, the only point at which anything is known.

## One deliberate difference from the online path

Deleting a session's last exercise leaves the empty session shell on that device until the next pull
reaps it. Online, the response carries `sessionDeleted` and the shell is tombstoned with it; offline
nothing can know that, and the server's own `deleteExerciseLog` cascades when the push lands.
**Queuing a second `workout_session_delete` to close that window would double-delete whenever the
guess is wrong**, which is worse than a shell that self-heals. Written into the code rather than left
for someone to rediscover.

A smaller consistency fix came out of the guard: only one of the three carried the `Web fallback`
comment that fences the local path from the network path. The test asserts the local half contains
no `fetch(`, and it needs that marker to find the boundary — so the other two gained it.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 828 warnings · **10,668** unit tests passed
· build clean.

**Control-run:** 12 of the 13 new cases fail against `origin/main`. The thirteenth pins the Zod
schemas in Lane A's files and passes either way, which is correct — it is there to catch a payload
key drifting from the schema that parses it, not to test this diff.

**Not exercised — the offline path itself, at all.** `getLocalStore` returns null on the web, so
every run in this sandbox takes the fetch fallback, and the repo has no React hook renderer to drive
the handlers directly. The guards are source-level (asserted as calls, not mentions — the reference
test records why) plus Lane A's engine tests. A Known-Issues row states the aeroplane-mode pass test.
