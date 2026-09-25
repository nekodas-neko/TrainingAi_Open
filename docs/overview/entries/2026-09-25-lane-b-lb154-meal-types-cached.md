# 2026-09-25 — LB-154: the entry described the wrong defect, and the fix is an offline win

Lane B, v1.465.59. `components/nutrition/food-logger-sheet.tsx` (two call sites),
`scripts/check-bare-api-fetch.js` (one baseline row deleted).

## Two corrections before the fix

The entry says the site *"bypasses the cache entirely"*. It does not — line 245 already reads
`readCacheSync<MealType[]>('nutrition-meal-types')`, and the bare `fetch` is only the **miss path**.
The real defect is narrower and different: that fallback never **wrote** what it fetched, so every
cold scan paid a request and left the key empty for the next one, and it sat outside `cachedFetch`'s
in-flight dedup while the nutrition screen behind the sheet fetches the same key on mount.

The entry also warns that converting it *"means reconciling those two types, not just swapping the
call"* — the local store's `getMealTypes` returning a narrower row than `mealTypeForHour` wants. That
obstacle belongs to a **different** alternative. It applies to reading the local store; it does not
apply to `cachedFetch`, which returns the route's own payload. The conversion is a swap, and the
narrow-row comment stays in the file because it still explains why the local store is not used here.

## The sibling that was the better half of the fix

The same file has a second bare GET twelve lines up — `/api/nutrition/saved-meals` — baselined
together with the first. Converting it is not tidying:

`handleScannedSavedMeal` resolves local store → network. Its own docblock says why that order
matters: *"a label is scanned in a kitchen, which is exactly where the network is not."* But the
fallback was a bare `fetch`, so **offline, with a perfectly good `saved-meals` list in the cache, a
scanned label failed** and showed *"That meal is not in your library"*. `cachedFetch` consults that
cache, so the kitchen case the docblock is built around now actually holds.

One subtlety recorded in the code: `cachedFetch` can fire `onData` twice — the cached list, then the
network's — so the find resolves with `?? null` rather than `?? meal`. The fresher answer has to win
**both** ways round, including when the meal was deleted on another device and the cached list still
carries it.

## No new test, deliberately

The regression guard already exists and is stronger than a bespoke test: `check-bare-api-fetch.js`'s
baseline row for this file was **deleted rather than lowered**, so a re-introduced bare GET here fails
Custom Rules outright instead of fitting under a remaining allowance. `check-cache-ttl-divergence.js`
covers the other half — both keys take the TTL every other reader uses (`TTL_LONG` for
`nutrition-meal-types`, `TTL_MEDIUM` for `saved-meals`), and a divergent one would fail there. The
behavioural change sits inside a component closure, and React is not unit-testable in this repo (both
vitest projects are `environment: 'node'`).

## LB-155's count

67 → **65**; tracked 26 across 19 files → **24 across 18**. Amended on `LB-155`, which owns the
figure. LB-154 is removed from the queue.

## Not exercised

The scan flow itself — it needs a camera and a printed label, so neither site was driven end to end.
What was: the full suite, the scanner, and `/nutrition` compiling and rendering. The offline claim is
reasoned from `cachedFetch`'s cache-first behaviour rather than observed with the radio off, and the
APK is where that would be seen.
