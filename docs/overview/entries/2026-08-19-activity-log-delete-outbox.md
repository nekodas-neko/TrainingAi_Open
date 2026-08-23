# 2026-08-19 — activity-log delete gets an outbox domain (Q-328, Lane A half)

**Branch:** `feat/activity-log-delete-outbox` · **Lane:** Implementation A

## The gap

An activity log is **created** through the outbox — `exercise-review-sheet.tsx:147` and
`done-activity-screen.tsx:228` both `upsertActivityLog` + `queueMutation` with
`syncStatus: 'pending'`. It was **deleted** by a bare
`fetch("/api/activity-logs", { method: "DELETE" })` with no `queueMutation` anywhere, and the
`activity_logs` branch of `pushMutations` handled upserts only.

So delete was the one activity-log write that could not be made offline at all. It failed visibly
rather than silently, so it was not data loss — but it is what forced Q-556's route to keep answering
200 for a delete that matched nothing, because a 404 would strand a row the user had just removed.

The local method's own docstring had already named this: *"Giving this domain a real offline delete
is a larger question (it needs an outbox domain and a tombstone path) and is deliberately not folded
in."*

## The correction that mattered

The backlog entry — which I wrote earlier the same day — said to flip the local soft-delete from
`sync_status='synced'` to `'pending'`. **That would have broken the tombstone path.**

`applyDelta` reaps an activity-log tombstone with
`DELETE FROM activity_logs WHERE id = ? AND sync_status='synced'`. A row left `'pending'` is skipped
by that reaper **forever**. The `'synced'` was load-bearing, not incidental — and a pre-existing
Q-488 test already pinned it, in as many words: *"here 'pending' would be worse than merely wrong —
a pending row blocks its own tombstone."*

Both states are correct, at different moments: a row awaiting a push must be `pending` so the
pull-clobber gate cannot overwrite a delete the server has not seen, and must become `synced` once
the push confirms so the reaper can remove it. So this ships a **second** method rather than
mutating the first.

## What shipped

- `lib/local-store/sqlite-backend.ts` — `softDeleteActivityLogPending(id)` (the offline-capable
  delete) and `markActivityLogSynced(id)` (moves it across on confirmation). The existing
  `deleteActivityLog(id)` is untouched, so the current bare-`fetch` caller behaves exactly as before
  until Lane B switches it — a row marked `pending` with no mutation queued behind it would never be
  reaped.
- `lib/local-store/sync-engine.ts` — the `activity_logs` confirm branch routes a `deleted` payload to
  `markActivityLogSynced`. It **cannot** use the existing upsert round-trip, on two counts:
  `getActivityLogs` filters `deleted_at IS NULL` so the row is never found, and `upsertActivityLog`
  omits `deleted_at` from its columns anyway.
- `lib/data/postgres/adapter.ts` — the `activity_logs` push branch handles `payload.deleted`, calling
  the same `deleteActivityLog` the web route calls. Same `deleted` flag convention as `supplements`
  and `saved_meals`.
- Tests: three on the push side (soft-deletes the row; a miss is **processed, not quarantined**; a
  delete cannot reach another user's row, proven with a second real user), three on the local side
  (pending flag, id scoping, and mark-synced not touching `deleted_at`).

**A miss is deliberately not an error.** The commonest benign replay is a delete re-sent because its
confirmation never landed, and the poison-pill rule forbids dead-lettering that forever. The row is
gone either way, which is what the mutation asked for.

## Verified

Full unit suite with `DATABASE_URL` attached: **500 files, 4,250 tests, 0 failed.** `npx tsc --noEmit`
clean, `pnpm check:rules` **Ran 49 of 49**, `check-push-mutations` OK (the new branch calls a repo
function, not raw `sql`).

## What is left, and what it unblocks

Lane B switches `app/health/health-content.tsx:687` to
`softDeleteActivityLogPending` + `queueMutation`, and deletes the now-dead `deleteActivityLog` local
method. **After that, Q-556's 404 half is unblocked** — with a queued delete behind it, a 404 means
"already gone", which the client can treat as success.

**Not exercised:** nothing on device, and the offline path itself is not end-to-end tested here —
native SQLite does not run in the sandbox, so the local-store tests assert the SQL issued, not its
effect on a real device. No migration, no schema change, no local SQLite version bump (no new table
or column), no user-visible change, so no version bump.
