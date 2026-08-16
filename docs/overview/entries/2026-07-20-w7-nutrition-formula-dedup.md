# 2026-07-20 — W7: nutrition formula dedup + date consistency (wiring/caching-perf audit §6, 2/3)

**Branch:** `fix/nutrition-offline-formula-batch` · **No version bump** (refactor, no user-visible behavior change)

Seventh (final) audit-batch item. Shipped the two clean, sandbox-verifiable fixes; deferred the
device-gated offline-first one.

## Shipped

- **§6.2 — one BMR formula, one age formula.** Exported `mifflinStJeorBmr(weightKg, heightCm,
  ageYears, sex)` + `SEX_OFFSET` from `lib/nutrition/goal-recommendation.ts` (it already held the
  canonical Mifflin-St Jeor); the health-page energy-balance widget (`use-health-calcs.ts`) now
  imports it instead of re-hardcoding the sex offsets. Both inline `365.25`-day age-from-DOB copies
  (`use-health-calcs.ts`, `nutrition-goals/recommend/route.ts`) now use the already-canonical
  calendar-based `ageFromDob` in `lib/date-utils.ts` — slightly more accurate near birthdays; the
  route gained a null-guard 400 for an implausible DOB.
- **§6.3 — date arithmetic.** `nutrition/weekly-summary` now derives its window start with
  `shiftDateStr(today, -6)` (matching the sibling `adherence` route) instead of the banned
  `Date.now() − 6×86_400_000` ms-offset pattern.

## Deferred

- **§6.1 offline food-item search** — the primary "quick re-log a usual meal" flow is server-only
  despite `food_items` writing locally. A proper fix needs a new `searchFoodItems` local-store read
  (interface + SQLite backend + FoodItem mapping), local-first wiring in `food-library-sheet.tsx`
  (which lacks `userId`, so it must be threaded through `food-logger-sheet` + parents) and
  `saved-meals-sheet.tsx`, and is **APK-only verifiable** (native SQLite doesn't run in the
  sandbox). Left as its own focused, device-smoke-gated pass — annotated in the backlog W7 row.

## Verification

- tsc + lint clean (0 errors). Nutrition / goal-recommendation unit suites green (63). Server/JS +
  UI only; the two shipped fixes are sandbox-verifiable (no device gate).
