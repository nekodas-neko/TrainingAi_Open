# 2026-08-26 — the diary delete works on web, so the bug is the device

**Branch:** `fix/diary-delete-intake` · docs-only · BugFix Intake

## The report

From the owner, live on the APK: *"the delete feature doesnt work. so its not removing from my.UI"*,
with the converged quantity sheet open on a BARILLA Spaghetti row. Asked for at the top of the queue,
and it is there — **BF-34** is Lane B's #1.

## What was actually done, and why it matters

The entry is short on speculation because the path was **driven end to end** rather than read.
Playwright against `pnpm dev`, seeded row → tap row → tap the bin → confirm → the row left the list
and `SELECT count(*) … WHERE deleted_at IS NULL` returned **0**.

**So the bug is device-only, and six layers are eliminated:**

| Layer | The line that rules it out |
|---|---|
| Confirm dialog wiring | fires `handleConfirmDelete`; verified on web |
| `store.deleteFoodLog` | `UPDATE … SET deleted_at=?, sync_status='pending'` |
| Local read | `getFoodLogsWithItems` filters `WHERE fl.deleted_at IS NULL` |
| Pull clobbering the delete | `applyDelta`'s upsert has `WHERE food_logs.sync_status='synced'`; the row is `pending` |
| Outbox payload | push strips only `syncStatus`/`updatedAt`/`deletedAt`, so `deleted: true` survives to `adapter.ts:4032` |
| A stale status flip | **nothing** flips `food_logs.sync_status` back to `'synced'`; `deleteMutations` only clears outbox rows |

That table is the expensive part and it belongs in the queue. An implementer who starts by
re-checking the local store or the pull-clobber gate spends the same afternoon reaching the same
dead ends.

## The remaining candidate

`quick-edit-log-sheet.tsx:140` **closes a Radix Sheet and opens a Radix Dialog in the same tick**.
Two things make that fragile on Samsung's WebView and invisible on desktop Chromium: Radix sets
`pointer-events: none` on `<body>` while a modal dismisses, so a Dialog mounting during the Sheet's
exit can be present but untappable; and `key={editingLog?.id}` **remounts** the sheet at that same
moment.

A Delete button that cannot be pressed looks exactly like a delete that does nothing.

**So the entry ends on one question — does the "Delete food log?" dialog appear on the device at
all?** Yes and no split it into two different bugs with two different fixes, and it costs one tap to
answer.

The recommended fix if it is the race is **not** a `setTimeout`: move the confirmation *inside* the
sheet. The bin already sits beside Save, and BF-26 deliberately removed Cancel from that row, so an
inline "tap again to confirm" fits the shape the artboard settled on and deletes the second modal
rather than sequencing it.

## The rule this is a case study in

`getLocalStore` returns `null` in the web sandbox, so **the branch this bug lives in cannot execute
there at all**. The green Playwright run is not weak evidence of a fix — it is strong evidence of
*where the bug is not*, and that is the only thing a web run can honestly buy on an offline-first
domain.
