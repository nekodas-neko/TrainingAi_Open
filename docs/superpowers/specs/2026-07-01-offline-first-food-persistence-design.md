# Offline-First Food Persistence + Local-DB Read Audit — Design Spec

**Status:** Approved to implement (food fix first). Branch: `fix/offline-first-food-persistence`.

## Problem

The on-device SQLite local store is meant to be the source of truth (API/Postgres = backup). But several domains **write** to the local store yet the UI **reads** them only from the server API (`cachedFetch`/`fetch('/api/…')`). Any write that hasn't synced (or whose sync failed) is invisible to the read path, so it silently disappears on navigation/app-restart. This is the recurring "logged food disappears" class of bug.

Root cause for food specifically: the local store has a `food_logs` table but **no `food_items` table**, so it can't render a log's name/macros offline — which is *why* the Nutrition page reads food from the server (`/api/nutrition/food-logs`, which joins `food_items`). The offline write is therefore write-only from the page's perspective.

## Audit findings (all outbox domains)

| Domain | Written local | Read source | Verdict |
|---|---|---|---|
| supplements / supplement_logs | ✅ | local store (nutrition-content) | ✅ correct — **the pattern to copy** |
| food_logs | ✅ | server only | ⚠️ **fix now** |
| activity_logs | ✅ | server only (activity-history-card) | ⚠️ follow-up |
| workout_log | ✅ | server-computed aggregates (weights-summary, strength-trend) | ⚠️ follow-up (harder: derived) |
| mood_logs | ✅ | server only (session-select) | ⚠️ follow-up |
| body_metrics | ✅ | local-first on Health ✅, server-only on Nutrition/Session-select | ⚠️ partial |
| injuries | ✅ | local-first on Health ✅, server-only in Workout screen | ⚠️ partial |

## The correct pattern (from supplements)

`nutrition-content.tsx` reads supplements via `getLocalStore(userId)` → `store.getSupplements()` / `getSupplementLogs(date)`, falling back to the API only when the store is unavailable/empty. The local store holds the **full** supplement definition, so it renders offline. Food must do the same — which requires storing food *items* locally.

## Fix (food) — scope of this branch

Keep the blast radius off the fragile server sync-delta core; hydrate the local item table from the page's own server fetch instead of extending the pull-delta.

1. **Local `food_items` table** (new migration in `lib/sqlite/migrations.ts`): `id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, sat_fat_g, source, updated_at`.
2. **Local store API** (`index.ts` + `sqlite-backend.ts`): `upsertFoodItem`, `getFoodItems(ids)`, and `getFoodLogsWithItems(date)` — the existing `food_logs` query LEFT JOINed to `food_items`, returning `FoodLogWithItem`-shaped rows (logs whose item isn't local yet are skipped until hydrated).
3. **Write item locally on create** (`lib/nutrition/log-food.ts`): after `createFoodItem` (API) returns an id, `store.upsertFoodItem(...)` with the fields we already have — so a just-added item is instantly renderable offline.
4. **Read local-first on the Nutrition page** (`nutrition-content.tsx`): load `store.getFoodLogsWithItems(date)` immediately (includes unsynced adds); still run the server `cachedFetch`, and when it returns, **upsert its items + logs into the local store** (hydration) and re-read local. Server stays authoritative + backup; local is the render source. Falls back to today's server-only behaviour when no local store (web).

Quick-edit and delete already write `food_logs` locally + outbox; with local-first reads they now reflect immediately.

## Follow-ups (separate PRs, documented not built here)

- **mood_logs / body_metrics / injuries**: point the server-only read sites at the local store first (small, mirrors supplements) — session-select, nutrition body-metadata, workout-screen injuries.
- **activity_logs**: read `store.getActivityLogs` in the activity history card.
- **workout_log**: harder — the reads are server-computed aggregates (weights-summary, strength-trend); needs local aggregation or accept eventual-consistency. Lowest priority.

## Guardrail

Add a CLAUDE.md standing rule: any domain that writes to the local store MUST have its UI read from the local store (local-first), never server-only. Include a checklist to verify on every new offline-first domain.

## Full local-DB review findings (4-facet audit, 2026-07-01)

**Fixed in this branch:**
- Food offline-first read (the core fix above).
- `clearLocalStoreData()` did not clear the new `food_items` table → other-user food data could linger on a shared device after sign-out. Added `DELETE FROM food_items`.
- Deleting a food log invalidated `nutrition-food-logs-<date>` but not `nutrition-weekly-summary`, so the weekly chart showed stale totals. Now invalidates both (local + web paths).

**Verified NOT bugs (audit false positives):** `distanceKm` "typo" (code is correct); "stranded supplement delete" (the outbox row is deleted on server-confirm regardless of the best-effort mark-synced re-read); the "critical" food-logs cache prefix mismatch (prefix invalidation is correct); nullable local `source` / `calories` REAL (the local store is per-user and stores only what it renders); 4 program-mirror tables carry unused `updated_at` columns (cosmetic).

**Server-only read sites → local-first (now DONE on this branch):**
- `injuries` (workout-screen) — reads `store.getInjuries()` first, API fallback.
- `mood_logs` (session-select `loadTodayMood`) — reads today's row from `store.getMoodLogs()` first.
- `activity_logs` (activity history card) — needed local schema columns (`calories_burned`, `start_time`) since the card renders them; added them (migration v11 + reconcile), captured `start_time` on write (calories hydrates from server), threaded `userId` into the card, and read `store.getActivityLogs()` local-first.
- `body_metrics` on nutrition/session-select is **NOT** a bug: those reads consume `/api/body-metadata`'s server-computed aggregates (`calsBurnedToday`, `weekToDate`) that can't come from `store.getBodyMetrics`. The writable weight/metrics read on the Health page is already local-first. Left as-is.

**Remaining follow-up:**
- `workout_log` aggregate reads (weights-summary/strength-trend) are server-computed — would need on-device aggregation. Hardest, lowest priority.
- **`food_items` in the pull-delta:** optional robustness — the Nutrition page already hydrates local items from its own server fetch on every load, so this only closes the brief pre-fetch window and cross-device background sync. Deferred to avoid touching the load-bearing `getSyncDelta` without device testing.
- **Cross-device soft-delete gaps:** `supplement_logs`/`injuries` deletions don't round-trip via the delta (single-user impact is negligible).
- **Migration ALTERs aren't `IF NOT EXISTS`:** pre-existing; already backstopped by `RECONCILE_COLUMNS`. Consider a `PRAGMA table_info` guard if it ever recurs.

## Testing / verification

- **Web (sandbox):** `getLocalStore` returns null → unchanged server-read behaviour; verify no regression (dev server + Playwright + tests).
- **Pure logic:** unit-test the log↔item join/mapping helper.
- **Device (required, cannot run in sandbox):** on the APK, add food, navigate away and back, force-close and reopen, and confirm it persists offline; confirm history still renders after hydration. Native SQLite only runs on the APK, so this is the authoritative check — do not auto-merge without it.
