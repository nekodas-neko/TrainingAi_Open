# 2026-08-19 — a delete that deleted nothing no longer reports success (Q-556 part 1; Q-328 filed)

**Branch:** `fix/activity-log-delete-affected-rows` · **Lane:** Implementation A

## The finding, which held

`DELETE /api/activity-logs` answered `{ success: true }` unconditionally, because
`deleteActivityLog(userId, id)` returned `Promise<void>`. As user B, deleting user A's activity log
returned `200 {"success":true}` while the row stayed intact — **not a leak** (the scoping is correct
and already tested), but a route that cannot report what it did.

## The prescribed fix was re-ordered, not applied

Q-556's fix line was *"return the affected-row count; answer 404 when zero, matching siblings."* The
first half shipped. **The second half must not go next, and the reason is concrete.**

Activity logs are **created through the outbox** — `exercise-review-sheet.tsx:147` and
`done-activity-screen.tsx:228` both `upsertActivityLog` + `queueMutation` with
`syncStatus: 'pending'`. So a row exists locally before its push lands, **online as well as
offline**. Deleting it in that window matches no server row. `health-content.tsx:687-695` treats any
`!res.ok` as failure and **skips its local delete** — so a 404 would toast *"Failed to delete"* and
leave on screen a row the user just removed.

And nothing would reconcile it later, because **delete is the one activity-log write that never
queues**: the `activity_logs` branch of `pushMutations` handles upserts only. That gap is filed as
**Q-328** and is the prerequisite.

**Two cases that sound like regressions and are not** — checked rather than assumed. The `WHERE` does
not filter `deleted_at IS NULL`, so a **double-tap** and a **row already deleted on another device**
both still match and still report `true`. Only a genuinely absent or not-yours row reports `false`.

**One of the entry's three reasons is void as written.** Reason (2) — *"a queued mutation receiving a
2xx is confirmed and dropped from the outbox"* — cannot happen, because there is no queued delete
mutation to confirm. The entry flagged it as not demonstrated; it is in fact not reachable. Reasons
(1) (inconsistent with every sibling) and (3) (the affected-row-count rule) stand.

## What shipped

- `lib/data/postgres/adapter.ts` — `deleteActivityLog` returns `boolean` via `.returning()`. The
  `WHERE` is unchanged, deliberately: keeping `deleted_at` out of it is what makes a re-delete
  idempotent.
- `lib/data/repository.ts` — the interface follows.
- `app/api/activity-logs/route.ts` — answers `{ success: true, deleted }`, with the ordering argument
  written where the next person will edit it.
- `lib/data/postgres/__tests__/repository-ownership-scoping.test.ts` — the existing cross-user case
  now also asserts `false`; two new cases cover a nonexistent id (also `false`, so the two stay
  indistinguishable — the enumeration property the review's control pass verified) and the idempotent
  re-delete.

## Verified

`DATABASE_URL=… npx vitest run lib/data/postgres/__tests__/repository-ownership-scoping.test.ts` —
**57 passed**, including the three `deleteActivityLog` cases. `npx tsc --noEmit` clean.

**Note for anyone running that file:** it guards on `process.env.DATABASE_URL` and the session shell
has it unset (the local-db hook unsets it so `pnpm dev` does not reach production), so a bare
`npx vitest run` reports **57 skipped** and looks like a pass. Pass the TCP URL explicitly.

## Not exercised

Nothing on device; no native path. The offline delete path itself is untested **because it does not
exist** — that is Q-328, not an omission here. No migration, no schema change, no auth change, and
no user-visible change (the response gained a field; no client reads it yet), so no version bump.
