## 2026-09-09 — `Recent` reads every meal bucket (LB-18)

**Branch:** `feat/lb-18-recent-all-buckets` · **Lane B** · PR #1012

### What shipped

`Recent` on Log Food no longer scopes to a meal bucket. `RecentFoodsPanel` reads
`getRecentFoodItems(12)` from the local store and `/api/nutrition/recent-for-meal` with **no**
`mealTypeId`, which the route reads as every bucket and answers with 12 rows rather than 5.

The owner settled this on the device: *"Recent doesnt need to be scoped to current meal bracket; I
think it should just be all recently entered foods/meals."* The Lane A sources landed 2026-09-02, and
LB-18 predicted the rest exactly — *"the swap is this component's fetch and nothing else."*

It was almost that. The `mealTypeId` prop and the `recentMealTypeId` `useMemo` that fed it are gone
too, which has a consequence worth naming: **nothing on that panel waits for the meal types any
more**, so the list paints as the sheet opens instead of after a bucket resolves.

### The cache key sits inside the old family on purpose

`nutrition-recent-for-meal:all`, not `nutrition-recent-all`. `invalidateCache` deletes
`WHERE key LIKE 'prefix%'` and `invalidateFoodLogWrites()` clears the prefix
`nutrition-recent-for-meal:`, so the new key is already evicted by every food write. A name outside
that prefix would have needed a new group in `lib/cache-groups.ts` — Lane A's file — for no
behavioural gain. That reasoning is in the file, because renaming the key silently removes it.

### What is still owed

**`Recent` is foods only.** The owner's answer was *"all recently entered foods/meals"* and this is
the bucket half. Mixing saved meals in is buildable — `listSavedMeals` already derives `lastUsedAt`
from `max(food_logs.logged_at)` and orders by it (migration 238), so the timestamp LB-18 once
described as missing has existed for weeks — but it needs a source returning both kinds interleaved,
which is a route change and so Lane A's. Recorded as a `Keep:` so the entry does not read as fully
answered.

### Verification

`e2e/recent-all-buckets.spec.ts` intercepts the request and asserts the URL carries **no**
`mealTypeId`. That is the whole regression surface and it is invisible to a type-check: the route
treats the param's absence as every bucket, so a stray param silently restores the old behaviour
while everything still compiles and renders.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. The entry's own caution is worth carrying to that
check — *"opening Log Food at 7 pm and being shown what you usually eat at dinner beats a global list
topped by breakfast coffee"* — so whether the global list actually reads better is the thing to look
at on the device, now that the owner has asked for it.

Patch bump — a behaviour change to an existing surface.
