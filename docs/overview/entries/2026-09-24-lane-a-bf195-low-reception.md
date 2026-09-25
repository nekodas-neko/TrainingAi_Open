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

## The abort was wrong, and CI is what said so

Everything above describes the **first** version of this fix, which cancelled the request at the
threshold with `AbortSignal.timeout(8000)`. It shipped to a PR, and **E2E failed** — 7 failures
across 5 specs, the first E2E failure of the day on any branch.

The diagnosis took a wrong turn worth recording. I first hypothesised that the E2E suite had rotted
on `main` and my branch merely happened to be the one that ran it. That was checkable and I checked
it the lazy way — a list of run conclusions — which showed several `success` results and no obvious
pattern. It was misleading: most of those runs **skipped** the tests entirely, because a "does this
change touch the UI?" gate short-circuits E2E on non-UI PRs, and a skipped job still reports
`success`. Reading the per-step conclusion instead of the job conclusion settled it in one query:
four branches genuinely ran the suite to completion that day and all four passed, including
`fix/rv176-timezone-escapes` which started 21:29, *after* my failing run. The suite was healthy.
The break was mine.

**The mechanism.** CI runs E2E against `pnpm dev` deliberately (a production server cannot reach the
local non-SSL Postgres), so first-compile responses legitimately take 9–19 seconds — I had measured
exactly that locally earlier and talked myself out of it. The 8 s abort fired on real, working
requests. `day-rollover-checkin.spec.ts` asserts *"a same-day resume must not refetch"* and saw
**Expected: 1, Received: 2**: the abort killed the first request, and the screen went back for the
data it never got.

**Why the redesign is better than a bigger number.** The threshold was never the defect. Cancelling
was. An abort on a slow-but-working connection destroys a request that was about to succeed and
shows an error instead of the data — that is the *worse* outcome in exactly the state BF-195 exists
to handle, and it silently changed the request semantics of every GET in the app. The watchdog now
**observes**: a `setTimeout` reports the request as slow and the request itself runs to completion
untouched. The user on a weak connection gets an honest "no throughput" indicator *and* their data
when it lands. `fetch` is back to a single `{ cache: 'no-store' }` argument, so the exact-match
guard in `cache-http-layer-bypass.test.ts` is restored to its strict form rather than relaxed.

A second correctness gain came free: one slow response is no longer a diagnosis. A cold container, a
heavy aggregate, or a dev server compiling on demand all produce a single long request on a good
connection, so two in a row are now required before the app calls itself unreachable.

**Verification of the redesign:** `tsc` clean · `typecheck:tests` clean (318 errors / 89 files, none
above baseline) · lint clean · Custom Rules **78 of 78** · full suite **9,684 passed, 1,036 files,
0 failures**. Mutation pass re-run: **5 mutants, 5 killed** — threshold 2→1, re-introducing the
abort, `markSettled` not resetting the run, dropping the `clearTimeout`, and a hard network throw
claiming low reception — plus **1 deliberately equivalent control** (`8000` → `8_000`) that
survived correctly. Re-introducing the abort is now killed by **three** tests, so the exact break
CI found is pinned at unit level and cannot return silently.

**Process note, recorded against myself.** I had the evidence for this before I had the conclusion:
I measured 9061/10190/18978 ms responses locally, called them "strong evidence" the timeout was
firing, then walked that back when a local run showed no failures — without noticing that my local
dev server was warm and CI's is not. The local run could not have reproduced it. Reaching for the
cheap CI query (per-step conclusions) an hour earlier would have cost one minute.
