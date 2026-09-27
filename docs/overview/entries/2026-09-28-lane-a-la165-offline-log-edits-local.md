# 2026-09-28 — LA-165: the device half of offline log edits, and a confirm guard that never fired

The local-store half of RV-175. With this, Lane B's LA-166 can make the three handlers write
locally and queue, instead of fetching first and losing the change offline.

## What changed

- **A pending mode on the three local writes** (`updateExerciseLogLocally`,
  `deleteExerciseLogLocally`, `deleteWorkoutSessionLocally`). The default still writes `synced`,
  which is right after a 2xx. `{ pending: true }` is for an offline write, so a pull that lands before
  its push cannot restore the old sets or resurrect a deleted log.
- **Confirms for the three new domains**: `markExerciseLogSynced` and `markWorkoutSessionTreeSynced`,
  dispatched from `sync-engine`'s push-confirm loop.
- **An edit that adds a set now shows it.** `updateExerciseLogLocally` only ever UPDATEd, so an added
  set appeared nowhere until a pull. It now inserts a missing set, and clears `deleted_at` on a
  re-added one, as the server's upsert does. The pull's `set_logs` apply then drops a SYNCED local
  copy of the same `(exercise_log_id, set_number)` in favour of the server's row, so the set is not
  shown twice. A pending copy is left alone.

## The bug found on the way

`markSessionSynced` guards its flip with "is another mutation for this session still queued?". The
confirm loop runs **before** `deleteMutations` removes the batch, so the guard counted the mutation
it was confirming. **Proven against a real SQLite:** a session whose only queued mutation was
confirmed stayed `pending`. By the code (not observed on a device), the stranded-workout sweep then
found it five minutes later and re-queued a `workout_log` push for every exercise in the session,
and only that re-push flipped it back. So every session RPE and every outbox completion cost a full
re-upload of the workout. One helper, `otherQueuedMutations`, now serves all three guards and excludes
the batch being confirmed. That includes siblings confirmed alongside it, which are also still
queued during the loop.

## Verification

- `la165-offline-log-edits-local.test.ts`, 12 cases on a real in-memory SQLite: pending vs default;
  added, truncated and re-added sets; the pull replacing a synced local copy and sparing a pending
  one; each confirm, a later queued edit holding the flip, and `markSessionSynced` both with and
  without the batch ids.
- `sync-engine` dispatch: all four confirms receive the batch ids, and the batch is deleted.
- **Mutation pass: 6 killed, 1 control survived.** Killed: the guard counting its own mutation again;
  the edit ignoring `pending`; the dedupe also dropping a pending set; no dedupe; an added set not
  inserted; batch ids not passed.
- The four SYN-4 tests asserted `sync_status='synced'` in the SQL text; the status is a bound
  parameter now, so they read the parameters. Flipping the default to `pending` still fails them.
- All 19 local-store and SQLite test files pass (272 tests).

## Not exercised, and one known edge

The device: `getLocalStore` is null on the web, so nothing here ran outside the test harness. A
Known-Issues row carries the S25 pass test. **Edge left:** if a push is applied on the server but its
confirmation is lost, the locally added set stays pending while the server's copy arrives, and the
two coexist until a later change re-sends the server row. Client-supplied set ids in the edit payload
would close it.
