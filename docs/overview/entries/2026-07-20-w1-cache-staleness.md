# 2026-07-20 — W1: cache staleness fixes (wiring/caching-perf audit §1)

**Branch:** `claude/handoff-documentation-w1ud2j` · **Version:** 1.184.1

Top of the new wiring/caching-perf audit batch (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`
§1). The recurring cache-invalidation bug class — all three sub-fixes re-verified live on `main` first.

## What landed

1. **Achievements went stale after nutrition / body-metric writes.** `computeAchievements` reads
   `food_logs`, `nutrition_targets` and `body_metrics`, but `invalidateNutritionWrite` and
   `invalidateBodyMetricWrite` didn't clear the `achievements:` prefix (only `invalidateActivityWrites`
   did). Added `invalidateCache('achievements:')` to both — the Profile achievements card now refreshes
   on a food/weight/steps write instead of waiting out the TTL.
2. **Supplements "already taken" carried across midnight.** The `supplements` client cache held today's
   `loggedToday` status with no date component and an unguarded seed read. Switched the 3 client call
   sites to `cachedFetchToday` and the seed to `readTodayCacheSync` (the shared today-envelope variant),
   so the cached status is validated against the local date on read — even offline. (Invalidation via
   `invalidateSupplements` still clears it by key prefix.)
3. **`body-battery` TTL consistency.** Added a `BODY_BATTERY_TTL` named constant to `lib/cache-ttl.ts`
   and switched all 3 raw-`TTL_SHORT` sites to it (one canonical TTL per key).

## Verification

- tsc + lint clean; full suite green (1882). Extended `cache-groups.test.ts` to assert the new
  `achievements:` invalidation in both write groups.
- Pure client cache logic — no device-only behaviour, so no device-smoke gate (per the plan).

Struck W1 from the audit-batch queue. Next: W2 (workout-screen render perf) is top.
