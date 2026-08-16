# 2026-07-21 — Offline food-library search (W7 §6.1)

**Branch:** `feat/food-search-offline` · **Version:** 1.187.0

Completes the W7 §6.1 backlog item: food search reads the local store first so re-logging a
usual food works offline. Owner asked for "everything food related offline, saved meals included".

## What landed

- **`searchFoodItems(query)` on the local store** (`lib/local-store/`) — reads the local
  `food_items` table (name LIKE, %/_ escaped, LIMIT 20; empty query → most-recent), mirroring the
  server route `slices/nutrition.ts:searchFoodItems`. `food_items` is already hydrated on write and
  via the pull-delta, so it holds exactly the user's previously-logged/created foods — the "usual
  foods" set.
- **`getRecentFoodItemsForMeal(mealTypeId, limit)`** — local mirror of the server
  `listRecentFoodItemsForMealType` (last 100 logs for the meal type, dedup by item, take N) for the
  logger quick-pick.
- **Three search surfaces now read local-first** (local store → server revalidate → keep local on
  offline/failure), replacing raw `fetch('/api/nutrition/food-items?q=')` that returned nothing
  offline: `food-library-sheet.tsx` (My Foods search), `saved-meals-sheet.tsx` (build-a-meal
  ingredient search), and `capture-step.tsx` (recent-for-meal quick-pick). `userId` threaded through
  `food-logger-sheet.tsx` to `FoodLibrarySheet`/`CaptureStep`. Reference: the supplements local-first
  pattern in `nutrition-content.tsx`.

## Saved meals — no new sync domain needed (scope reconciliation)

On reading the code, the saved-meals **list is already offline-capable**: `saved-meals-sheet.tsx`
seeds from `readCacheSync('saved-meals')` (persists across APK kills via the localStorage mirror,
7-day offline floor) and fetches via `cachedFetch` (SWR keeps the cached list offline). Logging a
saved meal already uses the food-log outbox (`logMealItems`). So **viewing + re-logging saved meals
offline already works** once seen online once — building a dedicated `saved_meals` sync domain (new
local tables + a server `updated_at`/`deleted_at` migration + the full delta chain) would duplicate
the cache layer for no functional gain, and is deliberately NOT done.

The one genuine remaining gap is **creating/editing a saved meal while offline** (the POST/PUT/DELETE
have no outbox) — a separate write-sync project, left for an owner decision rather than built blind.

## Verification

- tsc + lint clean (0 errors).
- **APK-only feature, NOT device-verified in sandbox:** `getLocalStore` returns null on web, so the
  local-first branch is dead in `pnpm dev` — the web path is the unchanged server fetch (no
  regression). The offline behaviour only runs on the S25 native SQLite. Device-smoke: airplane-mode,
  open the food logger, confirm My-Foods search + build-a-meal ingredient search + the "recently
  logged here" quick-pick all return your previously-logged foods with no signal. Recorded as a
  Known-Issues row in `projectOverview.md`.
