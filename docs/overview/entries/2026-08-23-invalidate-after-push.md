# 2026-08-23 — Logging food evicted the caches before the server had the write (LB-4)

**Branch:** `fix/food-log-invalidate-after-push` · **Lane A** · user-visible fix

Home's Energy Balance card read *"208 kcal left"* while the Nutrition tab's identical card read
*"166"* — a 42 kcal gap that is precisely one unlogged entry.

The invalidation was there and firing. It was firing at the wrong moment:

```ts
await invalidateNutritionWrite()
pushMutations(userId!).catch(() => {})   // fire-and-forget
```

Every `useCachedValue` subscriber wakes on that eviction, refetches **immediately**, gets the
pre-log payload from a server that does not have the write yet, and **re-caches it**. Nothing
invalidates again once the push lands, so the stale value then stands for the key's full TTL. The
Nutrition tab looked right only because it appends the new log optimistically to its own state and
never consults the cache for it.

## Invalidate twice, not later

Moving the single call after the push would break offline logging outright — `pushMutations` never
resolves usefully with no network, so nothing would repaint at all, and offline-first is the point.
Both halves are needed: the immediate one for this device's screens, and a second once the server
actually has the write.

That pair is now one helper, `pushThenRevalidate` (`lib/local-store/push-then-revalidate.ts`), and
the three engine write paths use it — `log-food.ts`, `log-meal.ts`, `create-food-item.ts`. The
backlog entry named only the first; the other two carried the identical shape.

**It revalidates only on a push that moved something.** `null` means nothing reached the server (no
store, 5xx backoff, every request failed) and `pushed: 0` means there was nothing to send —
revalidating in either case re-caches the same stale payload the caller is trying to evict.

**It is its own module rather than a function inside `sync-engine.ts`**, for a practical reason: a
helper calling `pushMutations` through the module's *local* binding cannot have that call stubbed,
so the ordering — the entire fix — would be untestable. The first draft lived in `sync-engine.ts`
and its tests failed for exactly that reason before the design changed.

## Six more sites, filed rather than swept

The same shape survives at six `components/**` call sites: the activity done screen, the guided-walk
summary, a fitness-test result, the nutrition quick-edit sheet, and two in the saved-meals sheet.
Those are Lane B's files, so they are **LB-6** with the audit, the finder heuristic and the
one-line fix written down, rather than reached into from here.

`app/nutrition/nutrition-content.tsx`'s food-log *delete* already had the right shape and is the
thing to copy toward.

## Verified

- **5 helper tests**, mutation-checked both ways: dropping the guard fails the offline and
  nothing-to-push cases; never revalidating fails the success case.
- **A wiring test on the offline-first branch** asserting the immediate invalidation fires *and*
  that the same group invalidator is handed to the push — reverting the call site to a bare
  `pushMutations` fails it.
- Full suite 548 files / 4,538 tests; `pnpm check:rules` 52 of 52; food-item create → food-log POST
  → read-back exercised against a signed-in `pnpm dev`.

**Not exercised: the race itself.** The bug needs the refetch to beat the push, which a local dev
server against a local Postgres wins far more often than a phone on mobile data does — the backlog
entry said as much. What is proven here is the ordering, not the timing, and the on-device check is
the one the entry names: log a food item on the Nutrition tab, then look at Home without navigating
away or waiting for a TTL.
