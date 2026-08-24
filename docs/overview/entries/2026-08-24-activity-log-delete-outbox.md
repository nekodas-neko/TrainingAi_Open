# Deleting an activity works offline now (Q-328)

**Branch:** `feat/activity-log-delete-outbox` · **Lane B** · v1.350.0

## What was wrong

An activity log was **created** through the outbox — `exercise-review-sheet` and
`done-activity-screen` both `upsertActivityLog` + `queueMutation`. It was **deleted** by a bare
`fetch('/api/activity-logs', { method: 'DELETE' })` with no queued mutation anywhere, so with no
connection the delete simply failed. It was the one activity-log write that could not be made
offline at all.

CLAUDE.md: *"every user-visible write needs an outbox domain — any POST reachable offline must queue
a mutation or visibly fail."* This one visibly failed, so it was never silent data loss — but it is
also what forced `DELETE /api/activity-logs` to keep answering 200 for a miss (Q-556).

## What shipped

`handleDeleteActivity` in `lib/hooks/use-day-entry-mutations.ts` writes a local tombstone and queues
the mutation, then fires its toast — feedback after the **local** write, never after the network,
because offline there is no network to wait for. The push is fire-and-forget via
`pushThenRevalidate`.

The web `fetch` survives as the fallback for the sandbox, kept logic-free by policy: it carries no
defaults or semantics the device path lacks.

## The part that would have broken things

`softDeleteActivityLogPending`, **not** `deleteActivityLog`. The two differ only in `sync_status` and
both are correct at different moments:

- `'synced'` is what lets `applyDelta` reap the tombstone — it prunes with
  `DELETE … WHERE id = ? AND sync_status='synced'`, so a row left `'pending'` blocks its own
  tombstone forever.
- `'pending'` is what stops a pull clobbering a delete that has not reached the server yet.

A queued delete must start `'pending'` and move to `'synced'` on push confirmation, which is what
`markActivityLogSynced` does from `sync-engine.ts`. Lane A shipped all three methods for exactly this
reason; this PR is the client that finally uses them.

**`deleteActivityLog` is removed** — its only caller was the bare-`fetch` path this replaces, and a
method that writes `'synced'` from the client is now always wrong. Its two tests went with it; the
surviving pair asserts `'pending'` **and** `not.toContain('synced')`, since which value the client
writes is the whole risk.

## The guard, and the hole mutation-checking found in it

`lib/hooks/__tests__/activity-delete-outbox.test.ts` pins that the local write and the queued
mutation appear **together** — a `'pending'` row with no mutation behind it is never pruned and never
pushed, so the two calls are only correct as a pair.

The first cut asserted `body.toContain('softDeleteActivityLogPending')`. Mutation-checking showed it
**passing with the call deleted** — the name still appeared in the comment two lines above. A guard
satisfied by its own documentation guards nothing. It strips comments and matches
`store.softDeleteActivityLogPending(` now; both halves fail their assertion when removed, verified
by deleting each in turn.

## The Custom Rules gate caught a real bug in this change

`check-client-today-timezone` failed on a bare `todayInTz()` — which falls back to Brisbane, so the
outbox row would carry the wrong day for anyone outside AEST. It takes `useUserTimezone()` now.

## Verification

- `npx vitest run lib/hooks/ lib/local-store/` — 155 passed across 10 files.
- `e2e/day-entry-edit-delete.spec.ts` — 6 passed.
- `pnpm check:rules` — Ran 55 of 55. Typecheck clean.

## Not exercised

**The offline path itself was not run, and it is the whole point of the change.** `getLocalStore`
returns null in the web sandbox, so every test above took the web fallback — the local tombstone,
the queued mutation and the push confirmation are verified by unit test and by reading, never by a
device with the network off. `Gate: device` on the follow-up.

Q-556's 404 half is unblocked by this and deliberately **not** done here.
