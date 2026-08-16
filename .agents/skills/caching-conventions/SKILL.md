---
name: caching-conventions
description: Use this skill whenever adding a new cachedFetch call, calling invalidateCache after a save/update/delete, choosing a cache key name, or debugging "stale data after save" / "changes don't show until I reload" bugs. Also trigger whenever an API route's response is consumed via cachedFetch on the client, or the user reports a screen showing old data after editing config, logging an item, completing a workout, or saving settings.
---

# Caching & Cache Invalidation

TrainingAI's client-side cache (`lib/sqlite/cache.ts`) has caused more recurring bugs than almost any other subsystem — Known Issue #1 ("Cache not invalidated after config saves") has resurfaced repeatedly. This skill exists so new code doesn't add to that list.

## The three storage layers

1. **SQLite** (`api_cache` table) — used only inside the Android APK (`isSQLiteAvailable()`)
2. **localStorage** fallback (`ta_cache:<key>`) — used on web/PWA, has its own TTL via `expiresAt`
3. **sessionStorage mirror** (`ta_sscache:<key>`) — written on every `setCached`, read synchronously via `readCacheSync<T>(key)` so a component's `useLayoutEffect` can render cached data before the first paint (async reads always miss frame 1)

All three are managed for you by `getCached`, `setCached`, `invalidateCache`, and `cachedFetch` — never read/write `localStorage`/`sessionStorage` cache entries directly.

## The read pattern: `cachedFetch`

```ts
cachedFetch<T>(key, url, ttlSeconds, onData)
```

Stale-while-revalidate: calls `onData(cached)` immediately if a fresh entry exists, then always fetches `url` in the background and calls `onData(fresh)` again, updating the cache. Per-key in-flight locking prevents duplicate concurrent fetches for the same key.

## The write rule (this is the part that keeps getting missed)

**Every API call that creates, updates, or deletes data must call `invalidateCache(keyPrefix)` for every cache key that reads that data — immediately after the write succeeds, before or alongside any local state update.** `invalidateCache` does a prefix match (`LIKE 'prefix%'` / `startsWith`), so a coarse prefix like `nutrition-food-logs-` clears all per-date entries at once.

## Known cache key registry

When adding a new cached resource, check this list first — reuse an existing prefix if the data overlaps, otherwise add a new entry here (in this skill file) so the next session knows it exists.

| Key / prefix | Holds | Invalidated by |
|---|---|---|
| `workout-data` / `workout-data:meta` / `workout-data:<sessionType>` | Program + exercise list for a session | Saving program config, completing a workout |
| `exercise-library` | Exercise catalogue | Admin exercise edits, AI-generated exercises |
| `phase-sets` | Phase set templates/progressions | Creating/renaming/deleting/cloning phase sets |
| `body-metadata` | Today + recent body metrics, goals | Logging weight/body fat/steps/water/etc. |
| `nutrition-food-logs-<date>` (prefix `nutrition-food-logs-`) | Food logs for a date | Logging/editing/deleting a food entry |
| `nutrition-weekly-summary` | 7-day nutrition rollup | Any food log change |
| `nutrition-targets` | Macro/calorie targets | Saving nutrition settings |
| `mood:` | Mood check-ins | Saving a mood log |
| `activity-logs` | Logged activities (runs, walks, etc.) | Logging/deleting an activity |

## Checklist when adding new cached data

1. Pick a key — reuse an existing prefix if this data is affected by the same writes, otherwise add a new row to the table above
2. Choose a TTL appropriate to how often it changes (seconds for "today" data, hours for catalogue/config data)
3. Read via `cachedFetch<T>(key, url, ttl, setState)`
4. In **every** write path (POST/PUT/DELETE route caller) for data covered by that key, call `await invalidateCache(keyPrefix)` after the write resolves
5. Manually test: make the change, navigate away and back (or just re-render) **without a full reload** — the new data must appear immediately, not after a refresh

## Sign-out

Sign-out must clear all cached data (1.15.0) so a second account on the same device never sees the first user's cache — if you add a new persistent cache layer, wire it into the sign-out cache wipe too.
