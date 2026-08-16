# Offline-First Architecture Review & Implementation Plan
*Session 140 — 2026-06-20*

**Goal:** Identify every gap in the offline-first strategy and produce a prioritised implementation plan. This document covers the current architecture state, what works, what doesn't, and what to build next.

---

## Architecture Overview

The app uses **three storage layers** working together:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — API Cache (lib/sqlite/cache.ts)                      │
│  SWR-style caching of GET responses: sessionStorage → localStorage → SQLite │
│  Covers: read-only derived data (workout-data, body-metadata, etc.)        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2 — Local Domain Store (lib/local-store/)                │
│  Capacitor SQLite tables mirroring server entities              │
│  Covers: body_metrics, mood_logs, food_logs, supplement_logs,   │
│          injuries, sleep_sessions, activity_logs, workout data  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3 — Mutations Outbox (lib/local-store/sync-engine.ts)    │
│  Write-first queue; drains to server when connectivity returns  │
│  Covers: body_metrics, mood_logs, food_logs, supplement_logs,   │
│          injuries                                               │
│  Separate: lib/sqlite/outbox.ts (workout-only sync_outbox)      │
└─────────────────────────────────────────────────────────────────┘
```

The infrastructure design is correct. Most gaps are **components not wired to use the local store** — they call server APIs directly instead.

---

## Domain Status Map

| Domain | Read Offline | Write Offline | Cache TTL | Outbox | Gap Level |
|--------|:---:|:---:|-----------|--------|-----------|
| Workout / Exercise / Sets | ✅ | ✅ | 6h | sync_outbox | Minor (dual outbox) |
| Program structure (sessions/exercises/sets) | ⚠️ | — | 6h | — | Medium |
| Body metrics (weight, HR, HRV, SpO2, steps, cal) | ✅ read | ❌ write | 30 min | missing wiring | **Critical** |
| Water log | ✅ read | ❌ write | 30 min | missing wiring | **Critical** |
| Mood logs | ✅ | ✅ | none | mutations | ✓ |
| Food logs | ✅ | ✅ | 60s | mutations | Cache inv. only |
| Sleep sessions | ✅ read | ❌ (HC-sourced) | 30 min | — | Acceptable |
| Activity logs | ✅ read | ❌ (HC-sourced) | — | — | Acceptable |
| Supplements (CRUD) | ✅ read | ❌ write | none | — | Medium |
| Supplement logs (toggle) | ✅ | ✅ | none | mutations | Cache inv. only |
| Injuries | ✅ | ✅ | none | mutations | Cache inv. only |
| Progression styles | ✅ read | — | 6h | — | Minor |
| Streaks / records / achievements | ✅ read | — | 6h | — | Minor |

---

## Critical Findings

### Finding 1 — Body Metrics Write Path Bypasses Local Store

The local store (`sqlite-backend.ts`) has full body metrics infrastructure: `upsertBodyMetric()`, `queueMutation()`, `sync_status` column, pull delta support. **But the components call server APIs directly.**

- `components/profile/water-log-sheet.tsx` → POSTs to `/api/water-log` (server-only)
- `components/health/body-metric-input.tsx` or equivalent → POSTs to `/api/body-metadata` (server-only)

**Fix:** Wire both components to call `store.upsertBodyMetric()` + `store.queueMutation()` + `pushMutations()` instead of hitting the server API directly. The server-side API routes stay as sync targets — they don't need changing.

---

### Finding 2 — Incomplete Cache Invalidation After Mutations

Several mutation paths don't invalidate relevant caches, causing stale UI after writes:

| Mutation | Missing Invalidations |
|----------|----------------------|
| Food log upsert | `nutrition-food-logs-{date}`, `nutrition-weekly-summary`, `nutrition-targets` |
| Supplement log toggle | Any supplement display caches |
| Injury upsert/resolve/delete | Injury card shows stale data until TTL expires |
| Water log write | `progress-summary`, `weekly-stats` (currently only invalidates `body-metadata`) |

---

### Finding 3 — Dual Outbox Systems

Two separate sync pathways exist:
- `lib/sqlite/outbox.ts` → `sync_outbox` table → `/api/sync-workout` (workout only)
- `lib/local-store/sync-engine.ts` → `mutations_outbox` table → `/api/sync/push` (all other domains)

This means partial syncs can leave workout data pushed but mood/metrics not pushed (or vice versa), with no unified retry. Low production risk now but will become a maintenance burden.

---

### Finding 4 — localStorage TTL Floor = 6 Hours

`lib/sqlite/cache.ts` extends all localStorage cache TTLs to `Math.max(ttl, 6h)`. After an APK kill and cold relaunch, the app always serves up to 6-hour-old data until SWR refreshes — even for caches intended to be 5-minute (`TTL_SHORT`). This is intentional (avoid blank state) but means freshness depends entirely on SWR completing, which can't happen offline.

For workout-data and program structure this is fine (data doesn't change mid-session). For readiness score and next-session recommendation it can be wrong by a day.

---

### Finding 5 — AI Periodization Engine is Network-Only

The planned `2026-06-18-ai-dynamic-periodization.md` calls Gemini on every `/api/periodization/evaluate` request. This is inherently online-only but should be handled gracefully:
- Signal aggregation (RPE trends, 1RM trajectory, recovery data) can and should run **locally from the SQLite store**
- The AI call should only fire when online; the result is cached server-side in `periodization_recommendations`
- The UI should serve the last accepted recommendation when offline, not blank

---

## Implementation Plan

### P0 — Body Metrics & Water Log Write Paths (1 session, highest impact)

These use the same DB column (`body_metrics` table). Both components need to be wired to local-first writes.

**Steps:**
- [ ] Confirm `sqlite-backend.ts` `upsertBodyMetric()` accepts all fields (weight, waterMl, steps, calories, HR, HRV, SpO2) — add any missing fields
- [ ] Confirm `mutations_outbox` domain `'body_metrics'` is handled in `/api/sync/push` — check the push handler for this domain
- [ ] In `components/profile/water-log-sheet.tsx`: replace `fetch('/api/water-log', ...)` with `store.upsertBodyMetric({ date, waterMl })` → `store.queueMutation(...)` → `pushMutations()`; only call the server route as fallback if store unavailable (web without SQLite)
- [ ] In the body metric input component(s): same pattern — local write first, then push
- [ ] After write: call `invalidateReadinessInputs()` + `invalidateCache('body-metadata')` + `invalidateCache('progress-summary')` + `invalidateCache('weekly-stats')`
- [ ] Add `water_logs` and `body_metrics` to the pull delta endpoint response if not already present (so reads work offline on first open)

**Expected outcome:** Weight, water, and metric logging work in airplane mode. Data queued and synced on reconnect.

---

### P1 — Cache Invalidation Completeness (0.5 sessions)

Fix all mutation paths that don't invalidate their downstream caches.

**Steps:**
- [ ] **Food logs** — In `nutrition-content.tsx` add `invalidateCache('nutrition-food-logs-${today}')` + `invalidateCache('nutrition-weekly-summary')` + `invalidateCache('nutrition-targets')` after any upsert (not just delete)
- [ ] **Supplement logs** — In `supplements-section.tsx` `toggleLog()` add `invalidateCache('supplements-${date}')` or equivalent key after toggle
- [ ] **Injuries** — In `injury-sheet.tsx` after save/delete/resolve add `invalidateCache('injuries')` (or whatever key injury card reads from)
- [ ] **Water log** — After write add `invalidateCache('progress-summary')` + `invalidateCache('weekly-stats')` alongside the existing `invalidateCache('body-metadata')`
- [ ] Add `invalidateReadinessInputs()` group call to water write and body metric write (these are inputs to the readiness score)

---

### P2 — Program Structure in SQLite (1 session, unblocks fully-offline workout start)

Currently the workout tab fetches full program structure (session exercises, set progressions) from `/api/workout-data` on every load. If that request is in cache (6h TTL) it works. If TTL expired and no connectivity, the workout tab fails to load.

**Steps:**
- [ ] Add tables to `sqlite-backend.ts`: `local_program_sessions`, `local_session_exercises`, `local_style_sets`
- [ ] Extend `getSyncDelta` on server (`/api/sync/pull`) to return `programSessions`, `sessionExercises`, `styleSets` — they already have `updated_at` from migration 069
- [ ] Extend `pullDelta()` in `sync-engine.ts` to write those tables
- [ ] In `app/api/workout-data/route.ts` (or the client component): read from local store first; fall back to network. Existing `cachedFetch` covers the fallback path already.
- [ ] Confirm `TTL_LONG` (6h) is still applied to the `workout-data` cache so SWR refreshes periodically

**Expected outcome:** The workout screen loads and starts a workout from SQLite even with no connectivity, as long as the user has synced at least once.

---

### P3 — Supplement CRUD Offline (0.5 sessions)

Supplement log toggling is already offline-first. Creating/editing/deleting the supplement definitions is not.

**Steps:**
- [ ] Add `supplements` domain to mutations outbox schema (`domain: 'supplements'`, `payload: { action: 'upsert'|'delete', ...fields }`)
- [ ] In `manage-supplements-sheet.tsx` save/delete: write to local store first, queue mutation, then push
- [ ] Handle `supplements` domain in `/api/sync/push`
- [ ] Pull delta already syncs supplements — no change needed there

---

### P4 — Unify Outbox Systems (1 session, technical debt)

Merge `sync_outbox` (workout) into `mutations_outbox` to get a single drain/retry path.

**Steps:**
- [ ] Add `domain: 'workout_session'` as a valid domain in `mutations_outbox`
- [ ] In `lib/sqlite/outbox.ts` `addToOutbox()`: write to `mutations_outbox` table with `domain='workout_session'` instead of `sync_outbox`
- [ ] In `/api/sync/push`: add handler for `domain='workout_session'` that calls the existing workout persistence logic (extracted from `/api/sync-workout`)
- [ ] Drain `mutations_outbox` in `SyncProvider` exactly as today; remove separate `drainOutbox()` call
- [ ] Migration: move any unsynced rows from `sync_outbox` to `mutations_outbox` on startup; drop `sync_outbox` table
- [ ] Keep `/api/sync-workout` around but deprecated; remove once confirmed clean

**Note:** This is medium-risk — defer to a dedicated session with full integration testing.

---

### P5 — AI Periodization Offline Graceful Degradation (design only)

The AI periodization engine (planned in `2026-06-18-ai-dynamic-periodization.md`) is network-dependent by design. The offline strategy:

1. **Signal aggregation runs locally** — `lib/periodization/signals.ts` should read from the SQLite local store (workout sessions, set logs with RPE, body metrics, mood logs) rather than querying the server. All inputs live locally after sync.

2. **AI evaluation is deferred when offline** — `/api/periodization/evaluate` returns 503 or a flag when Gemini is unavailable. The client shows "Evaluation pending — sync to get recommendation" instead of an error.

3. **Last recommendation is always available** — `periodization_recommendations` are pulled via delta sync. The UI shows the most recent recommendation (accepted or pending) from the local store, regardless of connectivity.

4. **No local AI model** — running Gemini locally isn't feasible in the APK. The design is: observe locally, evaluate online, serve recommendation from cache.

---

## Service Worker Notes

`public/sw.js` current strategy:
- `/api/*` — Never cached (always network-only)
- `/_next/static/*` — Cache-first (static assets persist)
- All pages — Network-first with cache fallback

**This is correct.** API routes must not be cached at the SW layer — that would hide network errors and serve stale API responses. The `cachedFetch` layer handles API response caching explicitly with TTLs and SWR.

One gap: the SW could pre-cache the offline fallback page to guarantee a non-blank screen when entirely offline. Currently if the user goes offline AND the page isn't in the SW cache, they get a browser "no internet" page.

---

## Priority Order

| Priority | Task | Sessions | Impact |
|----------|------|----------|--------|
| P0 | Body metrics & water log write path | 1 | Highest — daily use |
| P1 | Cache invalidation completeness | 0.5 | High — stale UI bugs |
| P2 | Program structure in SQLite | 1 | High — offline workout start |
| P3 | Supplement CRUD offline | 0.5 | Medium |
| P4 | Unify outbox systems | 1 | Medium (tech debt) |
| P5 | AI periodization offline design | design | Future (no blocking work) |

---

## What Does NOT Need Changing

- **Sleep sessions** — these come from Health Connect (device), not user input. Write path doesn't exist by design.
- **Activity logs** — same. HC ingestion is the only source. No user write path needed.
- **localStorage TTL floor (6h)** — intentional trade-off to avoid blank state. Acceptable given SWR always refreshes on connectivity.
- **Service worker API-never-cache rule** — correct. Don't change this.
- **Workout outbox (`sync_outbox`)** — works correctly today. Unification (P4) is cleanup, not a fix.
