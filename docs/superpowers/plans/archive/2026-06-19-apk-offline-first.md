# APK Offline-First — Overview & Plan

**Goal:** The APK should be fully usable without a network connection. The only features that legitimately require the internet are AI chat (Gemini) and food barcode/search (external food database). Everything else — logging workouts, body metrics, food (re-use of cached items), water, supplements, reading historical data — should work offline and sync in the background when connectivity returns.

---

## Current State

The architecture is largely correct. The gaps are coverage, not design.

**What already works offline on the APK:**
- Workout logging — Capacitor SQLite outbox (`lib/sqlite/outbox.ts`), drains to server when online
- Body metrics writes — Dexie local store + mutation outbox → `/api/sync/push`
- Mood log writes — same pattern
- All read-only data within cache TTL — `cachedFetch` + localStorage/SQLite cache

**Two local storage systems exist in parallel:**
- `lib/sqlite/` — Capacitor SQLite (APK-native): workout outbox + API response cache
- `lib/local-store/` (Dexie/IndexedDB): entity data for body metrics, mood, sleep, workout sessions, activity logs, programs, progression styles

The `LocalStore` interface (`lib/local-store/index.ts`) was designed to allow a `SQLiteLocalStore` to replace `DexieLocalStore` as a drop-in, but that's not implemented yet. Dexie works fine in Capacitor WebView today.

**What still requires network (and shouldn't have to):**
- Water log writes
- Supplement check-off writes
- Food log writes (manual entry / re-use of previously cached food items)
- Reading the full program structure (session exercises, set progressions) — only program name/id is in Dexie, not the detail needed to start a workout
- Nutrition tab reads once cache TTL expires
- Streak, personal records, achievements reads once cache TTL expires

---

## Storage: Not a Concern

All entity data for 30 days fits comfortably in ~2–3 MB. Capacitor SQLite lives in the APK's private data directory — device storage, no browser quota. A Galaxy S25 Ultra has 256 GB. This is not a constraint at any realistic scale.

---

## Architecture: How It Works After This Is Built

1. **On first open / after login:** Full sync pulls all data from the server into the local store (capped at a 90-day window per the existing sync engine). Program structure, food items, all entity data lands in Dexie.
2. **All reads hit local store first.** UI renders instantly without spinners. The network call runs in the background to refresh stale data.
3. **All writes go local first.** Data appears in the UI immediately. The mutation is queued in the outbox. `SyncProvider` pushes the outbox on mount and on connectivity restore.
4. **Network is only needed for:** AI chat, food barcode/search, and the background sync itself.

---

## What Needs to Change

### Phase 1 — Extend Delta Pull to Full Program Structure

Currently Dexie stores only `{ id, name, isActive }` for programs and `{ id, name }` for progression styles. The workout screen still fetches full structure from `/api/workout-data` on every load.

**Changes:**
- Add `programSessions`, `sessionExercises`, `styleSets` tables to Dexie
- Extend `getSyncDelta` on the server to return these (they already have `updated_at` from migration 069)
- Extend `pullDelta` in `lib/local-store/sync-engine.ts` to write them into Dexie
- Wire `app/api/workout-data/route.ts` (or the component) to read from Dexie first, fall back to API fetch

This is the highest-value change because it means the workout tab — the core feature — loads and starts fully offline.

### Phase 2 — Water Log Offline Writes

Simplest write to add. No foreign keys, single numeric value per day.

**Changes:**
- Add `waterLogs` table to Dexie: `{ date: string, waterMl: number, updatedAt: string, syncStatus }`
- Wire `components/profile/water-log-sheet.tsx` to write Dexie-first, queue mutation (`domain: 'water_logs'`)
- Extend `/api/sync/push` to accept `water_logs` domain and call existing `repo.upsertBodyMetrics` (water is a column on `body_metrics`) or a dedicated method
- Extend `/api/sync/pull` delta to include water data (it's already in `body_metrics` rows)
- Read path: water display component reads from Dexie first

### Phase 3 — Supplement Logs Offline Writes

Similar simplicity. The check-off records are `{ supplementId, date, checkedAt }`.

**Changes:**
- Add `supplementLogs` table to Dexie
- Add `supplements` table to Dexie for the supplement definitions (needed to render the nutrition tab offline)
- Wire `components/nutrition/supplements-section.tsx` to write Dexie-first
- Extend push/pull delta to cover supplements and supplement_logs
- Reconcile supplement reminders from Dexie rather than always fetching `/api/supplements`

### Phase 4 — Food Logs Offline (Manual Re-use of Cached Items)

More complex due to foreign keys (`food_items` → `food_logs` → `meal_types`). But achievable with a clear scope cut: **barcode scanning and new food searches still require network** — those look up external databases. What goes offline is re-logging a food item the user has used before.

**Changes:**
- Add `foodItems`, `mealTypes`, `foodLogs` tables to Dexie
- Delta pull includes: food items the user has previously logged (last 90 days), meal type definitions, food logs
- Write path for manual entry against a cached food item: write Dexie-first, queue mutation
- Write path for a new barcode/search result: network required, but on success write the food item to Dexie so it's available offline next time
- Nutrition tab reads from Dexie first for today's logs and recent history
- Macro totals and nutrition goals are computed client-side from Dexie data

### Phase 5 (Optional) — SQLiteLocalStore Unification

Replace `DexieLocalStore` on the APK with `SQLiteLocalStore` backed by `@capacitor-community/sqlite`. The `LocalStore` interface is already defined to make this a drop-in swap. Benefits: one DB on the APK (no split between Capacitor SQLite outbox and Dexie entity store), no WebView storage quota dependency, simpler debugging via standard SQLite tooling.

This is a quality improvement, not a blocker — Dexie works correctly in Capacitor WebView today. Defer until the coverage work (Phases 1–4) is stable.

---

## Scope Cuts — Things That Stay Network-Dependent

These are explicitly out of scope or acceptable as network-required:

- **AI chat** — Gemini API, always network
- **Food barcode scanning** — external food database lookup, always network (but result gets cached to Dexie for re-use)
- **New food item search** — same as barcode
- **Program config changes** (editing exercises, creating new programs) — these are rare, config-time operations, not daily use. Cache TTL covers reads; writes can require network.
- **Friends/social feed** — network required, that's fine
- **GPS activity tracking** — network for map tiles, always
- **First-run/login** — needs network to authenticate and seed the local store

---

## Migration / Backward Compatibility

No DB migrations are needed on the server for Phases 1–3. The `updated_at` columns (migration 069) already exist. The push/pull endpoints just need their domain allowlist and delta queries extended.

Phase 4 (food logs) may need soft-delete columns on `food_logs` if deletion needs to propagate offline — assess when implementing.

---

## Rough Effort Estimates

| Phase | Effort | Risk |
|---|---|---|
| Phase 1 — Program structure in Dexie | ~1 day | Medium — touches workout load path |
| Phase 2 — Water log offline | ~2–3 hours | Low — single-column, proven pattern |
| Phase 3 — Supplement logs offline | ~3–4 hours | Low-medium — two tables, reminder reconciliation |
| Phase 4 — Food logs offline | ~1.5 days | Medium-high — FK chain, client-side macro computation |
| Phase 5 — SQLiteLocalStore | ~1 day | High — full storage layer swap |

Phases 2 and 3 can be done together in a single session. Phase 1 is independent and high value. Phase 4 is a dedicated session.
