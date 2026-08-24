# Logging a saved meal offline-fallback stops costing one round trip per ingredient (BF-12)

**Branch:** `fix/saved-meal-serial-fetch` · **Lane A**

## What was wrong

The owner reported *"about 20 seconds from clicking log to having it show up — when I swapped pages
I see that it isn't in the nutrition log anymore."* BugFix had already traced it against production
rows: the writes were **not** lost, and their timestamps carried a fingerprint — a three-item meal's
rows landed ~0.4s apart rather than together, which is a per-item network round trip, not a
local-first batch.

That points at `logMealItems`'s web fallback in `packages/shared/src/nutrition/log-meal.ts`, which
only runs when `getLocalStore()` returns null (the K4 `isLocalStoreDead` state). It was a `for` loop
of sequential `await fetch`es — one blocking round trip per ingredient. CLAUDE.md names this pattern
outright: *"never `await` POSTs serially in a loop … batch into one request or `Promise.all`."*

## What shipped

The POSTs now go out together via `Promise.allSettled`, so an N-item meal costs one round trip's
wall clock instead of N. No new API surface — the single-item route contract is unchanged, which
keeps the sync-push mirroring question out of this change.

**A second defect was introduced by that fix and closed in the same change.** Concurrency makes the
rollback's completeness load-bearing: `Promise.all` rejects on the first failure without reporting
which siblings succeeded, so a partial failure would strand rows the rollback cannot see —
invisible until they reappear as duplicates on the next tap. `allSettled` records every landed id
before rethrowing. Serially this could not happen, which is exactly why it needs a test now.

## Verification — proven by mutation, not by passing

`packages/shared/src/nutrition/__tests__/log-meal-fallback.test.ts`, three cases, each of which
**fails against the reverted serial loop and passes with the fix restored** (checked by actually
reverting the file, not by reasoning):

| case | what it catches | failure against old code |
|---|---|---|
| concurrent POSTs | the defect itself | `expected "vi.fn()" to be called 3 times, but got 1` |
| meal-order output | completion order leaking into the visible list | 5s timeout |
| complete rollback | the stranded-sibling hazard | `[log-0]` instead of `[log-0, log-2]` |

The sibling `log-meal.test.ts` could not have caught any of this: it mocks `getLocalStore` to a
working store, so it never reaches the fallback. The new file mocks it to `null`.

- Full suite: 4696 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` in this
  sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

## Not exercised, and the entry stays open

**Nothing here was seen on the S25**, and this does not close BF-12. Two halves remain, both
device-gated:

1. **Why this device's local store is null is untouched.** A fast fallback is a mitigation, not the
   cure — the entry's own bar wants the local-first path working, or the "Local storage
   unavailable" banner visibly showing so the delay reads as expected rather than broken.
2. **The "vanished after navigating away" half is still unexplained.** Whether the tap shown
   mid-spinner in the owner's screenshot was among the rows that landed, or was abandoned by
   navigating away mid-chain, has not been checked.

`pnpm dev` could not be run in the sandbox (`node_modules` is missing `@sentry/nextjs` despite
`package.json` declaring it, a pre-existing gap). Verification is unit test plus static reading of
the write path — no live HTTP request was made against the route.
