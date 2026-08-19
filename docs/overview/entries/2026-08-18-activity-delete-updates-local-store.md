# 2026-08-18 — deleting an activity now deletes it locally too (Q-488)

**Lane A** · branch `fix/activity-delete-updates-local-store` · one local-store method and one call ·
no migration, no Kotlin, no APK.

`app/health/health-content.tsx` deleted an activity with a bare
`fetch("/api/activity-logs", { method: "DELETE" })`, toasted *"Deleted"*, and never touched the local
store. Three surfaces read `activity_logs` **local-first** and kept showing it:

- `app/session-select/session-select-content.tsx` — the week strip
- `app/nutrition/nutrition-content.tsx` — today's calories burned
- `components/health/activity-history-card.tsx`

**The screen the user was on stayed correct, which is exactly why this survived.**
`refreshDayOverlay` reads the server-assembled `day-log:<date>` aggregate — a sanctioned server-read
exception — so the activity vanished right where anyone would look for it.

Nothing was lost: the server delete is a soft delete with a `user_id`-scoped tombstone, and
`applyDelta` reaps the local row. But `pullDelta` is throttled to `MIN_SYNC_INTERVAL_MS` (5 min) and
the sync provider calls it un-forced, so the floor is that window and the real duration is "until the
next natural sync".

## The shape that does not work, pinned by a test

The entry warned that the first thing a session reaches for is a read-merge `upsertActivityLog` with
`deletedAt: now`. It compiles, type-checks, passes lint — and **changes nothing**, because that
method's INSERT column list and its `ON CONFLICT DO UPDATE` both omit `deleted_at` entirely, while
`getActivityLogs` filters on it. It was written and reverted here before it shipped.

There is now a test asserting `upsertActivityLog` does **not** touch `deleted_at`, so anyone who adds
it there gets a red test pointing at `deleteActivityLog` instead of a silent no-op.

## `synced`, not `pending`

`deleteActivityLog` writes `sync_status='synced'`, following `deleteExerciseLogLocally`: the web
DELETE round-trip has already succeeded when this runs, so local matches server at that instant.

Here `pending` would be worse than merely wrong. `applyDelta` reaps the row with
`DELETE … WHERE id = ? AND sync_status='synced'`, so a row left pending would **block its own
tombstone forever** and the soft-deleted row would never be removed.

## Deliberately not done

**This is not an offline-capable delete.** There is no `queueMutation`, so a delete attempted with no
network still fails at the fetch and never reaches the local write. Giving this domain a real offline
delete needs an outbox domain and a tombstone path — a larger question the entry explicitly says not
to fold in silently.

## Scope

The review audited every mutating write to a local-first domain for a local-store call inside the
handler — `injury-sheet` (PATCH+DELETE), `nutrition-content` (DELETE), `quick-edit-log-sheet` (PATCH),
`saved-meals-sheet` (DELETE), `manage-supplements-sheet` (DELETE+PATCH), `done-activity-screen`
(PATCH). All eight write locally. **This was the only one that did not.**

## The component-size baseline moved, and that is in the diff

`health-content.tsx` 912 → 915. Three lines: one call and two of comment. There is no zero-line shape
for "also write locally", and the full reasoning lives on `deleteActivityLog` in `sqlite-backend.ts`
rather than at the call site — which is what kept it to three lines instead of nine.

## NOT verified on device — and this one cannot be

`getLocalStore` returns null in the web sandbox, so the local-first readers fall through to their API
fallbacks and the inconsistency **cannot appear there at all**. The unit tests assert the SQL
statement's shape (soft-delete, `synced`, id-scoped, matching timestamps), which is the honest limit
of what this environment can check. The 5-minute floor is read from `MIN_SYNC_INTERVAL_MS`, not
observed. On-device is the only real verification.
