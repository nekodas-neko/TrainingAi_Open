# 2026-09-25 — BF-177: three one-shot refetches lost a race that cannot be won by timing

Lane B, one entry, v1.465.57. `app/nutrition/use-energy-balance-refetch.ts` +
`app/nutrition/nutrition-content.tsx`, one new test file.

## The defect, and why it survived three fixes

The owner: *"The kcal left in the top right; doesnt load on the same page: it requires page
switching to show."* Shipped 2026-09-19, re-reported, fixed again, **FAILED on the S25 on
2026-09-23**, fixed again, **FAILED again on sweep 2**. Each fix added another one-shot refetch at
another write site.

The Device Verification trace is what ends the argument. On the APK the food write is local-first +
outbox, and the refetch fires at the *local* write:

```
+176ms GET energy-balance → remainingKcal=857   ← the card's own refetch, BEFORE the push
+238ms POST /api/sync/push → 200                ← the outbox lands the food
+677ms GET energy-balance → remainingKcal=846   ← correct, and not the card's request
```

So the card's refetch did not merely arrive early — it **re-cached the pre-log figure**, and the
number then sat wrong indefinitely. A fourth refetch, or a delay, would be guessing at a 60–70 ms
gap on one device. On the web the write is an awaited POST, which is why
`e2e/bf177-kcal-left-updates-after-log.spec.ts` was green through all of it.

## The signal was already being sent

`packages/shared/src/nutrition/log-food.ts` fires `invalidateNutritionWrite()` **twice on purpose** —
at the local write and again through `pushThenRevalidate` once the server has it, its own comment
saying *"otherwise the refetch this triggers re-caches the pre-log figures"*. The second one had been
arriving since #1467. Nothing on the Nutrition tab was listening for it.

This is the Q-402 shape for the fourth time in this entry's life: **evicting a key and re-rendering
the component that reads it are two different things.** The fix is `useInvalidationRefetch` in
`use-energy-balance-refetch.ts`.

## Two judgement calls worth the words

**Not where the entry said.** Review sweep 59's re-read pointed the fix at
`use-nutrition-derived-refresh.ts:33` — RV-104's hook, which owns two other keys and a different
load function. The subscription belongs in the hook that already owns this key, its retry ladder and
its date, so every consumer gets it and one place decides when the balance is refetched.

**The hook now takes the date, required.** The obvious version reads `lastDateRef`, which `refetch`
alone sets — so the subscription would be dead until the hook had already fetched once, which
excludes the case subscribing exists for: a write from Home's quick-add or the wrap-up sheet while
the Nutrition tab sits mounted in the persistent shell. Made a **required** second argument rather
than optional, because the failure mode of forgetting it is a subscription that silently never
fires.

## What it costs

Nothing on the log path. `cachedFetch` de-dupes by key, so the subscription's fetch at the first
invalidation and `handleFoodLogged`'s explicit `refetchBalance` attach to one request. The explicit
calls stay: the **web fallback** branch of `logFoodEntries` never reaches `pushThenRevalidate`, so
there the one-shot is the only refetch there is.

## The test pins a chain, not a call site

`app/nutrition/__tests__/bf177-balance-subscribes.test.ts` — five assertions over four links:
log-food's post-push invalidate → `invalidateNutritionWrite` clearing `energy-balance:` → the hook
subscribing to that prefix → refetching the day on screen. Three of them live in files nobody
editing the card would open, and the fix is alive only while all four hold. Control run against
`origin/main`: the three new-behaviour assertions fail, the two pre-existing links pass — which is
the right split, since those two were always true and are here to catch the chain being cut
elsewhere.

React is not exercised: both vitest projects are `environment: 'node'` with no
`@testing-library/react`.

## A stale sentence removed from the hook

Its docblock said *"**Accepted:** the ring updates instantly and 'kcal left' lands a round trip
later"* — and stood through three fixes while the device showed the round trip landing with the
wrong number. Rewritten to say what is now true: the balance lands once the server has the write,
one push rather than one round trip.

## Corrected: one of the two "unswept" readers was already clean

The entry recorded `components/nutrition/end-of-day/day-read-through-section.tsx:37` and
`app/health/day/day-detail-content.tsx:122` as two hand-rolled `cachedFetch` readers of
`energy-balance:`. The first is **not** — it uses `useCachedValue`, which subscribes, and its
docblock explains why it differs from `/health/day`. The second genuinely is hand-rolled, and stays
so deliberately: it guards each response against a date-swipe that has already moved on, and it
refetches after its own writes. Not swept in — it is a route page, not a tab in the persistent
shell, so there is no window in which another surface's write can strand it.

## Not verified

**The S25 look.** `Verify: device` on the entry, pass test unchanged: log a food on the S25, "kcal
left" changes within 3 s without leaving the tab. Native SQLite, the outbox push and Samsung's
WebView were not exercised here — and that mechanism is the entire subject of the fix, so this is
the verification rather than a formality. Exercised: `pnpm dev`, the full suite, and the gate.
