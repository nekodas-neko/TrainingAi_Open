# Fix: cache staleness — achievements group gaps + supplements date guard

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §1. Branch:
`fix/cache-staleness-batch`.

## Problem

1. Logging food or a weight/step entry doesn't refresh an already-open Profile achievements card
   for up to 5 minutes (its TTL), because the writes that feed those achievements never invalidate
   the `achievements:` cache key.
2. A supplement checked off late at night can still show "already taken" the next morning — worse,
   indefinitely offline — because the `supplements` cache key holds today's `loggedToday` status
   with no date component and no freshness guard on read.
3. `body-battery` is fetched at 3 sites via a raw `TTL_SHORT` import instead of a named constant,
   inconsistent with every other multi-site "today" key.

## Root cause

- `invalidateNutritionWrite()` (`lib/cache-groups.ts:319-337`) and `invalidateBodyMetricWrite()`
  (`lib/cache-groups.ts:233-244`) don't call `invalidateCache('achievements:')`, unlike
  `invalidateActivityWrites()` (`lib/cache-groups.ts:192-214`) which does for the identical
  dependency shape (`computeAchievements()` in `lib/achievements.ts:77-160` reads `food_logs`,
  `nutrition_targets`, and `body_metrics` alongside `activity_logs`).
- The `supplements` cache key (`components/sync-provider.tsx:323`,
  `app/nutrition/nutrition-content.tsx:314,320`) is a bare literal with no date suffix, fetched
  with plain `cachedFetch`. The seed-read at `nutrition-content.tsx:105-113` has no freshness
  check, unlike the `body-metadata` seed four lines above it (`isBodyMetadataFresh` guard).
- `body-battery` TTL: `session-select-content.tsx:697-700`, `sync-provider.tsx:357`,
  `end-of-day-review.tsx:75` all import raw `TTL_SHORT` instead of a named constant from
  `lib/cache-ttl.ts`.

## Fix

1. Add `invalidateCache('achievements:')` to both `invalidateNutritionWrite()` and
   `invalidateBodyMetricWrite()` in `lib/cache-groups.ts`, mirroring `invalidateActivityWrites()`.
2. Give the supplements route/response a way to express "as of what date" and gate the read:
   simplest correct fix is switching the client call sites from `cachedFetch('supplements', ...)`
   to `cachedFetchToday('supplements', ...)` (the shared today-scoped variant already used
   elsewhere in this codebase for exactly this class of key — see `lib/sqlite/cache.ts`), so the
   cached payload is validated against today's local date on read the same way other today-keyed
   caches are. Apply at both call sites (`sync-provider.tsx:323`, `nutrition-content.tsx:314,320`)
   and guard the seed-read at `nutrition-content.tsx:105-113` the same way the `body-metadata` seed
   is guarded.
3. Add a `SUPPLEMENTS_TTL`-equivalent... no new TTL semantics needed since `cachedFetchToday`
   already handles same-day freshness; just ensure the TTL value used stays `TTL_MEDIUM` (no
   observed need to shorten it once the date guard exists).
4. Add a `BODY_BATTERY_TTL` named constant to `lib/cache-ttl.ts` (same value as current
   `TTL_SHORT`) and switch all 3 call sites to import it instead of raw `TTL_SHORT`.

## Files touched

- `lib/cache-groups.ts` (invalidateNutritionWrite, invalidateBodyMetricWrite)
- `lib/cache-ttl.ts` (new `BODY_BATTERY_TTL` constant)
- `components/sync-provider.tsx` (supplements fetch variant + body-battery TTL import)
- `app/nutrition/nutrition-content.tsx` (supplements fetch variant + seed-read guard + body-battery
  TTL import if present)
- `app/session-select/session-select-content.tsx`, `app/nutrition/end-of-day/end-of-day-review.tsx`
  (body-battery TTL import)

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: log a food entry / weight entry with the Profile achievements card open in another
  tab; confirm the achievements count refreshes without a manual reload once the TTL would
  otherwise still be stale (verify the invalidation fires, not just eventual TTL expiry).
- `pnpm dev`: toggle a supplement logged near local midnight (simulate by adjusting system clock
  or checking the date-guard logic directly), reload, confirm `loggedToday` doesn't carry over
  from the prior day.
- No device-only behavior here (pure client cache logic) — no device-smoke gate required, but
  spot-check on the S25 APK is still good practice per the general instant-paint rule.

## Rollback

Each change is additive/localized (new cache-group entries, a fetch-variant swap, a new TTL
constant) — revert the specific commit if a regression appears; no data migration involved.
