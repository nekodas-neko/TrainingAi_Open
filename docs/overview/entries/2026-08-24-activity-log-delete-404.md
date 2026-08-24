# DELETE /api/activity-logs stops reporting success for a delete that deleted nothing (Q-556)

**Branch:** `fix/activity-log-delete-404` · **Lane B** · v1.352.0

## What was wrong

`DELETE /api/activity-logs` answered `{ success: true, deleted }` unconditionally, even when
`deleted` was `false` — a nonexistent id or someone else's row. Every sibling delete route in the
app (`workout-sessions`, `phase-sets/[id]`, `supplements/[id]`, `meal-types/[id]`) answers 404 for
both cases; this one was the outlier at 200 for both.

The entry was previously marked **not safe to fix**: activity logs are created through the outbox,
so online as well as offline a row can exist locally before its push lands, and deleting it in that
window would have matched no server row — a 404 there would have surfaced as a spurious "Failed to
delete" and, worse, an outbox delete mutation receiving a non-2xx would have been retried forever
with no way to reconcile, since delete had no outbox path of its own.

## What changed since

Q-328 (this run, earlier PR) gave delete its own outbox path: `handleDeleteActivity`
(`lib/hooks/use-day-entry-mutations.ts`) writes a local tombstone and queues
`{ domain: 'activity_logs', payload: { id, deleted: true } }`, and the push arm calls the exact
same `deleteActivityLog` the web route calls. A miss there is handled — not treated as an error —
so the race this entry was built around no longer needs the web route to stay permissive.

## What shipped

- `DELETE /api/activity-logs` now returns 404 when `deleteActivityLog` matches zero rows, matching
  every sibling.
- The web fallback path (`use-day-entry-mutations.ts`, used only when there's no local store) treats
  a 404 response the same as a successful delete rather than throwing — the row is gone either way,
  and there's nothing actionable to tell the user.
- `deleteActivityLog` is a soft-delete with no `deleted_at IS NULL` filter on its WHERE, so a
  double-tap or a row already deleted on another device still matches and still reports `true` —
  those two stay indistinguishable from an ordinary delete, which is the enumeration-safe property
  the earlier review's control pass verified. Only a genuinely absent or not-yours id now reports
  404.

## Verification

- Two new integration tests in `push-mutations-web-parity.test.ts` against the local dev DB: a
  nonexistent id returns 404; a real delete returns 200 with `{success:true,deleted:true}` and a
  re-delete of the same id is still 200/true (idempotent); another user's row returns 404 with the
  row left untouched. 29/29 tests pass in the file.
- Typecheck and lint clean on all three touched files.
- Hit the running dev server directly against the real local Postgres: a nonexistent id → 404 with
  `{"error":"Not found"}`; inserting a row and deleting it → 200 with `{"success":true,"deleted":true}`;
  deleting it again → still 200/true.
- `pnpm check:rules` — Ran 55 of 55.
- Checked the sibling `PATCH /api/activity-logs/[id]/metrics` route, which an earlier probe on this
  entry had flagged as "still unverified" for ownership scoping — it scopes both its existence
  check (`getActivityLogById`) and its update (`updateActivityLogMetrics`) by `userId`, with a 404
  pre-check, so there was nothing to file.

## Not exercised

Web-only (this is a server route + its web fallback, no native or offline-first path involved
beyond what Q-328 already covers). Not run against production or on the S25 device.
