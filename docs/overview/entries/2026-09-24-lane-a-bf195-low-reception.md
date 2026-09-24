# 2026-09-24 — BF-195: the app had no state for "online with no throughput"

**Lane A** · branch `lane-a/bf195-low-reception`

The owner: *"I went to an area with low reception and nothing really worked on the app."* A gym is
the canonical low-reception location for this app, and the one screen that must work there — the
session list — was the one rendering nothing.

## Why offline-first did not help

Connectivity was a boolean. `navigator.onLine` and Capacitor's `networkStatusChange` both answer
*"is the radio attached"*, and in low reception it is. So `cachedFetchCore`'s offline branch — the
one that explicitly paints saved data — never ran, the request was issued with **no timeout**
(verified: zero `AbortController`/`AbortSignal` anywhere in `lib/sqlite`, `lib/hooks`,
`lib/local-store`), and it never settled.

The owner's screenshots split three ways, and the split is the evidence: **Health → Body worked**,
painting from `readCacheSync` seeds; everything gated on a fetch showed an empty skeleton. The
architecture was sound where it was applied. What failed was the layer above it.

## What shipped

**A timeout, at the one fetch site.** `AbortSignal.timeout(8000)` makes the request *throw*, and the
throw lands in `cachedFetchCore`'s existing catch — machinery that already keeps the cached value and
reports through `onError`/`onRevalidateError`. That converts an unhandled state into a handled one
for every screen, rather than adding a second failure path. 8 s is a starting value, not tuned.

**`online` now means requests are completing.** A module-level reachability flag in `cache.ts`
(`requestsCompleting()` / `subscribeToReachability()`), flipped false by a timeout and true by any
settled response; `useOnlineStatus` ANDs it with the radio state.

Two deliberate asymmetries there:

- **A rejected response counts as reachable.** A 500 proves the connection carried a request and
  brought an answer back, which is the question the flag asks. Requiring `ok` would strand the app
  "offline" behind a server error on a perfectly good connection.
- **An ordinary network throw does not flip it.** DNS failure, refused, server down — a different
  failure, already handled correctly, and calling it "no reception" would put an Offline banner in
  front of a working connection. `AbortSignal.timeout` rejects with a `TimeoutError`, which is the
  discriminator.

## A correction to the entry's chain, found by writing the test

The entry's chain reads as though the skeleton persisted because no callback fired. It did not.
`session-select-content.tsx` clears `refreshing` in a **`finally`** — which never ran, because the
promise never settled. **Settling is the fix.**

I wrote the test asserting `onError` fires on a timeout with nothing cached, and it failed. The code
was right and the test was wrong: once a timeout has marked us unreachable, the app is in the
sanctioned offline-first state, where an error card would be wrong. The screen shows its empty state
and the banner tells the truth. The test now asserts the promise *settles* — the mechanism — rather
than a callback that should not fire.

## A sibling guard I had to update without weakening

`lib/__tests__/cache-http-layer-bypass.test.ts` asserted `toEqual({ cache: 'no-store' })` — an exact
match on the whole `fetch` init, deliberately, so nothing unexpected can be passed. Adding `signal`
broke it. Relaxing it to a partial match would have silently retired that guard, so it now checks the
key set is exactly `['cache','signal']` and pins both values. The `no-store` rule it protects is a
strict one.

## Verification

`tsc` clean · `typecheck:tests` clean · Custom Rules **78 of 78** · `lib/sqlite` + `lib/hooks`
**77/77** · full suite **9,680 passed**.

Mutation pass: **6 mutants, 5 killed** — removing the signal, not marking unreachable on timeout,
never restoring reachability, treating *any* throw as low reception, and dropping the flag from the
`isOnline` test — plus **1 deliberately equivalent control** that survived correctly (the
early-return guard rewritten as if/else).

## Not verified, and it is the important part

**No device, and nothing here reproduces in the sandbox**, where the network is fast and
`getLocalStore` returns null. The honest reproduction is **network throttling, not airplane mode** —
airplane mode exercises the path that already worked.

**The banner is still a false promise on a seedless screen.** `offline-indicator.tsx` says *"Offline
— showing saved data"*. The engine now makes it appear at the right *times*; it cannot make that
sentence true on a screen with nothing saved. That copy is Lane B's, and it is on the entry's Keep.
