# 2026-09-25 — RV-178: a vanishing card, two unguarded buttons, two defeated memos, two blank lines

**Branch:** `lane-b/rv178-client-gaps` · **Lane:** Implementation B

Six client-side gaps from review sweep 58. All six verified against the source before any were
built — two had the wrong path (`components/ai-insight-card.tsx` does not exist; it is
`components/health/`, and `saved-meals-sheet.tsx` is under `components/nutrition/`) — and all six
turned out to be real.

## What shipped

**Home's timeline no longer vanishes on a failed load.** `useCachedValue` had no `onError`, and
`cachedFetch` swallows `!res.ok`, so a failure and an empty day were the same `null`. An empty day
still renders nothing — there is genuinely no timeline — but a failure says so.

**Two buttons that fired twice now fire once.** `clonePhaseSet` made a second copy of a phase set
on a double tap and had no try/catch; the AI insight card's Refresh spent the route's
10-per-hour budget on however many times you tapped it. Both go through a new
`useGuardedAction` (`lib/hooks/use-guarded-action.ts`) rather than two hand-rolled refs. Its latch
is a plain closure with a unit test, because the case it exists for — two taps in one frame — is
exactly the case a guard held in React state fails: both handlers read the same stale `false`
before either re-render lands.

**Two `memo()`s that were doing nothing.** `SoreMusclePicker` and `MealBuilderHeader` are both
`memo()`-wrapped and both were handed a handler re-created every render. `saved-meals-sheet` had
already done this sweep for its other five handlers (Q-357, in a comment thirty lines above), and
this one was missed.

**Two blank lines that waited on the network.** More's Oura card read `/api/oura-ble/freshness`
with a bare `fetch`, so "Ring synced 4m ago" — the card's whole job — was blank on every open. The
public profile page did the same, showing a spinner for a profile opened a minute ago. Both now
seed from cache and revalidate.

## A regression I introduced and caught on re-read

Wrapping `fetchInsight` in the guard also guarded the **mount effect**, which is a different thing
from guarding the button. Switching Health section while a load was in flight would have had the new
section's fetch dropped and the previous section's insight left on screen, with no retry queued —
the effect had already run for the new deps. Only the tap is guarded now; the effect is driven by
its deps, not by how fast someone can tap, and the test asserts the split in both directions.

`clonePhaseSet` has no equivalent hazard: nothing calls it but the button.

A second one from the same re-read: `useCachedValue`'s `onError` fires on a **revalidation**
failure too, not only the first load. So a profile that painted from cache and then failed a
background refresh would have shown an error banner stacked on top of perfectly good data — the
error branch is gated on `!profile` now. Worth knowing for any other card adopting `onError`: it is
not an initial-load callback.

## Three things the gate caught that a reading would not have

**The fetch-once ratchet rejected my first profile-page fix.** I converted a bare `fetch` in a
`useEffect` into a `cachedFetch` in a `useEffect`, which is the exact Q-402 shape the check
freezes. The right answer is `useCachedValue`, which also refetches when `public-profile:` is
invalidated.

**That conversion would have flattened the route's error messages**, because `useCachedValue`'s
`onError` took no argument and `cachedFetch` never surfaces a response body. Rather than accept
"Could not load profile" for a friends-only profile, the hook's `onError` now receives the
`CacheFetchErrorInfo` it already had internally — a source-compatible widening, since a handler
taking no argument ignores it. `lib/hooks/**` is this lane's, so the fix went where the gap was.

**`components/config-screen.tsx` is a size-capped hotspot**, and the first version of the guard
pushed it 12 lines over. Wrapping with the shared hook instead is net zero, and merging two
adjacent imports from the same module paid for the one line the import cost. "Extract, do not
append" is what the check says, and it was right.

**RV-84's guard caught a dead `.catch`** I added on a `cachedFetch` — it never runs, because
`cachedFetch` swallows `!res.ok`.

## One cross-lane line, declared

Two new cache keys (`oura-ble-freshness`, `public-profile:`) are registered in `lib/cache-groups.ts`,
which is Lane A's file. Shipping a cache key without its group entry is the single most repeated
bug class in this project, so the alternatives were to register it or not add the key at all. Both
registrations are asserted in `lib/__tests__/cache-groups.test.ts` rather than left to review.

## Verification

`components/__tests__/rv178-client-gaps.test.ts` (8) and `lib/hooks/__tests__/use-guarded-action.test.ts`
(5), plus two extended assertions in `cache-groups.test.ts`. **Control-run: 10 of them fail against
the pre-fix source.**

Gate: `pnpm lint` 0 errors and **808 warnings, the same count as the base** (a diff of the two
lists, after the first run came back +2 — one was a dead helper in my own test) · `pnpm check:rules`
**Ran 78 of 78** · doc-size OK · `pnpm test` · `pnpm build`.

**The e2e run is inconclusive and is recorded as such.** 97 specs passed, then the dev server died
and 132 failed on `ERR_CONNECTION_REFUSED` — self-inflicted, because the full vitest suite was
running against the same box. Not a code failure, and not a pass either.

Not exercised: the device. These are all WebView-reachable JS changes so they ship on a Railway
deploy with no APK, but none of the six surfaces was opened on the S25.
