# 2026-09-02 — `Recent` gets an unscoped source, and the migration it was said to need does not exist (LB-18)

**Lane A · branch `lane-a/saved-meal-last-used` · no version bump**

The owner settled this on the device on 2026-08-30: *"Recent doesnt need to be scoped to current
meal bracket; I think it should just be all recently entered foods/meals."* Lane A owns "the
source"; Lane B does the swap.

## The entry's central claim was false, and checking it removed a migration

LB-18 says a saved meal has no last-used timestamp, that this is why `My Foods` can only order by
`createdAt DESC`, and that a recency ordering across foods and meals therefore **needs a Lane A
schema change, not a Lane B sort** — *"say so in the plan rather than discovering it mid-PR."*

`listSavedMeals` already derives `lastUsedAt` from `max(food_logs.logged_at)`, orders by
`lastUsedAt DESC NULLS LAST, createdAt DESC`, and reads `idx_food_logs_saved_meal_recent` from
migration 238. Its own comment explains the choice: *"a 'last used' column… needs a write on every
log, an un-write on every delete, and it is wrong forever if either is missed"* — the Stored
Counters rule, applied correctly by whoever built it.

So the planned work — a migration, a local SQLite version, `RECONCILE_COLUMNS`, the sync chain —
was **the whole of it, and none of it was needed.** What was actually missing is one line: a query
without a `WHERE meal_type_id`.

I had already mapped that migration's chain in detail before finding this, including establishing
that `saved_meals` is not in `getSyncDelta` and pulls as a full list rather than a delta. That
mapping is correct and was wasted, which is the argument for reading the code *before* the plan
rather than after.

## What shipped

- `listRecentFoodItems(userId, limit)` — repository, adapter, and `slices/nutrition.ts`.
- `getRecentFoodItems(limit)` — the local store, so it works offline exactly as the scoped one does.
- `mealTypeId` is now **optional** on `GET /api/nutrition/recent-for-meal`. Absent means every
  bucket, and returns 12 rather than 5 — a global list drawn from every meal of the day would
  otherwise cut off mid-breakfast.

**Both scoped and unscoped share one body on each side.** The de-duplication and the 100-row scan
window are the parts that would drift silently if copied, and the window is load-bearing: the query
reads the last 100 *logs* and collapses them to distinct items, so a bucket where the same three
things are eaten repeatedly still yields three items rather than one.

**The route keeps its name rather than gaining a sibling.** A second near-identical route for the
same concept is how two recency rules end up disagreeing, and the owner's answer makes the unscoped
list the default rather than a variant. The name reads slightly stale; the alternative is worse.

## What is not done

Lane B's swap — dropping the query param in `RecentFoodsPanel`. That component's comment already
predicted the shape: *"the swap is this component's fetch and nothing else."* LB-18 stays queued
with a `Keep:` for it.

Mixing saved **meals** into the `Recent` list, which the entry also mentions, is a surface decision
about what that tab contains, not a missing query — `listSavedMeals` can already order them by
recency.

## Verification

- Full suite: **6,290 passed / 59 skipped / 744 files**. `pnpm check:rules` — **Ran 67 of 67**.
  `tsc` clean.
- Five assertions against a real Postgres: items come from every bucket most-recent-first (asserted
  as an **absolute list**, since a bug dropping one bucket would still satisfy an ordering-only
  check); the scoped query still sees only its own bucket; a food eaten in two buckets appears once;
  deleted logs are excluded; and the query is user-scoped.
- **Mutation-tested**: making the unscoped path keep the meal filter fails four of the five.
- **Against `pnpm dev`** with a real session: no `mealTypeId` returns 4 items across buckets and a
  200 where it used to be a 400; with one it returns 3, correctly excluding the dinner item.

**Not exercised:** the local-store half runs only on the device — `getLocalStore` returns null under
vitest and in the web sandbox — so `getRecentFoodItems` is verified by mirroring the server's shape
and by typecheck, not by execution. No UI calls it yet.
