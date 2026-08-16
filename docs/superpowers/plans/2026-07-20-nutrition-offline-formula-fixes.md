# Fix: nutrition offline-first gap + duplicate BMR formula + date-arithmetic consistency

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §6. Branch:
`fix/nutrition-offline-formula-batch`.

## Problem

1. Food-item search/reuse (the primary "quick re-log a usual meal" flow) is server-only, even
   though the `food_items` domain writes to the local store specifically to support offline reads
   — a partial recurrence of the exact incident CLAUDE.md's Offline-First section documents.
2. BMR and age-from-DOB are each computed in two independent places with no shared import — no
   observed drift today, but the same shape as prior 1RM/weekly-cadence duplicate-formula
   incidents.
3. `weekly-summary`'s date window uses the banned `Date.now() - N*86400000` pattern instead of the
   canonical `shiftDateStr` helper — numerically harmless under fixed-offset AEST today, but
   inconsistent with its sibling route and the exact pattern that caused real bugs elsewhere.

## Root cause

1. `lib/local-store/index.ts` exposes `upsertFoodItem` (write) but no `getFoodItems`/
   `searchFoodItems` read method. `components/nutrition/food-library-sheet.tsx:39-48` and
   `saved-meals-sheet.tsx:93-103` search via `cachedFetch`/bare `fetch` only, with no local-store
   fallback — even though `lib/nutrition/log-food.ts:199-206` upserts every logged food item
   locally.
2. `lib/nutrition/goal-recommendation.ts:24,48-56` has the canonical Mifflin-St Jeor + sex-offset
   formula but doesn't export a standalone helper; `app/health/hooks/use-health-calcs.ts:52-53`
   re-implements it inline with hardcoded sex offsets. Age-from-DOB arithmetic
   (`Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))`) is
   duplicated verbatim at `use-health-calcs.ts:47-49` and
   `app/api/nutrition-goals/recommend/route.ts:188`.
3. `app/api/nutrition/weekly-summary/route.ts:13` computes
   `formatInTimeZone(new Date(Date.now() - 6 * 86_400_000), tz, 'yyyy-MM-dd')` instead of
   `shiftDateStr(today, -6)`, unlike the sibling `app/api/nutrition/adherence/route.ts:20-21`.

## Fix

1. Add `getFoodItems(query?: string)`/`searchFoodItems(query: string)` to the local-store interface
   (`lib/local-store/index.ts` + the SQLite backend), mirroring the existing
   `getFoodLogsWithItems` read pattern. Wire `food-library-sheet.tsx` and `saved-meals-sheet.tsx`
   to read local-first (store results shown immediately, server search as fallback/enrichment when
   online), matching the supplements reference pattern CLAUDE.md names
   (`app/nutrition/nutrition-content.tsx`'s supplements reads).
2. Export a standalone `mifflinStJeorBmr(input)` helper (and the `SEX_OFFSET` map) from
   `lib/nutrition/goal-recommendation.ts`, and have `use-health-calcs.ts` import it instead of its
   inline copy. Extract the age-from-DOB calculation into a shared helper (candidate location:
   `lib/date-utils.ts`, since it's a date computation, or `lib/nutrition/goal-recommendation.ts` if
   it's considered nutrition-domain-specific) and import it at both `use-health-calcs.ts:47-49` and
   `app/api/nutrition-goals/recommend/route.ts:188`.
3. Change `weekly-summary/route.ts:13` to use `shiftDateStr(today, -6)`, matching `adherence`'s
   pattern.

## Files touched

- `lib/local-store/index.ts`, `lib/local-store/sqlite-backend.ts` (new read methods)
- `components/nutrition/food-library-sheet.tsx`, `components/nutrition/saved-meals-sheet.tsx`
- `lib/nutrition/goal-recommendation.ts` (export `mifflinStJeorBmr`/`SEX_OFFSET`)
- `app/health/hooks/use-health-calcs.ts`
- `app/api/nutrition-goals/recommend/route.ts`
- `lib/date-utils.ts` (or `lib/nutrition/goal-recommendation.ts`, implementer's call — shared
  age-from-DOB helper)
- `app/api/nutrition/weekly-summary/route.ts`

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: log a food item, then search for it again in the food-library sheet and the
  saved-meal ingredient search — confirm it appears (this validates the online path still works
  after the refactor); the true offline-local-first behavior can only be confirmed on-device
  (native SQLite doesn't run in the web sandbox per CLAUDE.md's Offline-First checklist item 5).
  **Device-smoke gate required**: verify on the S25 APK in airplane mode that a previously-logged
  (and synced) food item is browsable/searchable offline. If no device is available this session,
  land with an explicit "NOT device-verified" Known-Issues row.
- `pnpm dev`: confirm the health-page energy-balance widget's BMR and the nutrition goal
  recommendation's BMR agree for the same user/weight/height/age/sex after the de-dup (they should
  — they're now the same function).
- `pnpm dev`: confirm `weekly-summary` still returns the correct 7-day window after the
  `shiftDateStr` swap (spot-check a date near a month boundary, since `shiftDateStr` is the
  overflow-safe helper CLAUDE.md requires for exactly this reason).

## Rollback

All three fixes are additive/refactor-only (new read methods, a re-exported helper, a date-helper
swap) — revert per-commit if a regression surfaces. No schema/migration changes.
