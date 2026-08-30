# 2026-08-30 — The deleted food came back, and the filed trace was not why

**Lane A · branch `fix/pending-delete-resurrection` · BF-47 · v1.395.5**

From device pass N1: *"Delete worked; when I click delete the item vanishes then re-appears; then
when you swap screens - it dissapears."*

## The entry's trace does not survive reading

BF-47 said the loader "renders the local copy first and then does this, **unconditionally**" — the
server fetch — so the authoritative render puts the row back. That is not what the loader does. In
the happy path it feeds the server copy to `applyDelta` and then **re-reads locally**, and all three
links in that chain hold:

- `handleConfirmDelete` really does call `store.deleteFoodLog(id)` before queueing.
- `getFoodLogsWithItems` filters `deleted_at IS NULL`.
- `applyDelta`'s `food_logs` arm is gated `WHERE food_logs.sync_status = 'synced'`, so a server row
  cannot overwrite a pending local one.

On that path the row should not come back. Two mechanisms do fit the report:

1. **The `catch` branch.** If `applyDelta` or the local re-read throws, the loader falls back to
   `applyLogs(server)` — the raw server copy, deleted row included.
2. **The local row was never there.** A log created on web or another device and not yet pulled
   means `deleteFoodLog`'s `UPDATE` matches **zero rows**, so nothing is tombstoned and nothing is
   pending locally, and `applyDelta` inserts the server row fresh as `'synced'`.

**The difference decides where the fix goes**, which is why it was worth chasing rather than
implementing the entry as written. Mechanism 2 is a local re-insert, so a filter applied *after*
`applyDelta` would still write the row back onto the device — it would fix the flicker and leave the
part that survives a screen swap. The shipped filter runs **before both uses**, and a source-order
test pins that.

## What shipped

`pendingDeletedIds` / `withoutPendingDeletes` (`packages/shared/src/sync/pending-deletes.ts`, pure)
and `getQueuedMutationsForDomain` on the local store. The loader drops queued deletes from the
server copy before it hydrates from it or renders it.

**The store read deliberately has no `next_retry_at` clause and no status filter**, unlike
`getPendingMutations` beside it. A delete waiting out a retry backoff is still a delete the user
made, and a read path that forgets it during that window puts the row back on screen — which would
have reproduced the same report, less often, from a different cause.

This is the screen-level twin of the `sync_status = 'synced'` gate `applyDelta` already applies to
pulls. That read path had no such gate.

**Not done: inverting the authority.** The entry warns against it and the warning is right — the
server-copy fallback is itself a fix, for logged food that *"vanished on reload"* when a local read
threw. Both failures are real and a naive swap trades one for the other.

## The sibling sweep has a measured answer: one

The entry asked for a sweep of "any local-first domain whose loader re-fetches a server aggregate
right after an optimistic write". `grep -rn 'applyDelta(' app components lib packages` returns
**exactly one** call site outside the sync engine — this loader. It is the only screen-level read
that hydrates the local store from its own server fetch, which is the shape that can resurrect a
row.

The three named siblings were checked rather than assumed:

- **mood / body-metric / activity deletes** read `day-log:` through `cachedFetch` — a
  server-assembled aggregate that never writes to the local store. A queued delete shows briefly
  stale there and self-corrects on push: a flicker, not a resurrection.
- **`session-select-content.tsx`** reads `store.getActivityLogs` local-first, where the tombstone
  already excludes it.

## Verification

- Full suite green; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean; lint 0 errors.
- **8 mutations, every anchor asserted, all 8 caught** — including removing the filter, moving it
  after the hydrate, applying it to the fallback only, filtering adds and edits as well as deletes,
  reading every domain's deletes, and inverting the empty-set short-circuit.
- **One of those mutations found a hole in my own test.** The first version asserted
  `SRC.toContain('withoutPendingDeletes')`, which an import line satisfies — so deleting the *call*
  and leaving the import survived. It now asserts the call: `withoutPendingDeletes(server,`.

**Not exercised: the S25, and the fix is reasoned rather than reproduced.** `getLocalStore` returns
null in `pnpm dev` and in Playwright, so neither mechanism has a sandbox analogue; the hook cannot
even be rendered, because both vitest projects are `environment: 'node'` with no
`@testing-library/react`. The rule is unit-tested and its placement is pinned at source, and neither
of those is a device. Recorded as a Known-Issues row with the smoke step.
