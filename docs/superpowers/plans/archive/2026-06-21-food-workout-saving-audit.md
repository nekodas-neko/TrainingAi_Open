# Food/Workout Saving Audit — Implementation Plan
**Date:** 2026-06-21 | **Session:** 144

Full manual audit of every food-log and workout-log save path, cache invalidation chain, security posture, and logic correctness. Covers: `nutrition/food-logs`, `log-exercise`, `complete-workout`, `sync/push`, `sync/pull`, `body-metadata`, `water-log`, `mood`, `supplements`, `injuries`, `AI periodization`, `cache-groups`, and `sqlite/cache`.

---

## Findings Summary

### 🔴 Critical — Broken or Highly Visible

#### C1 — `strength-trend` missing from `invalidateWorkoutSummaries()`
**File:** `lib/cache-groups.ts` line 4–19  
**Impact:** After every completed workout, the Strength Trend sparklines (Health > Progress) show stale 1RM data until the TTL_MEDIUM cache expires (typically 10–15 min). New PRs are invisible until then.  
**Root cause:** `invalidateWorkoutSummaries()` clears `weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `next-session`, `muscle-recovery`, `readiness-score`, `achievements:`, `progress-summary`, `streak-data`, `calendar-data:` — but NOT `strength-trend`.  
**Fix:** Add `invalidateCache('strength-trend')` to `invalidateWorkoutSummaries()`.

#### C2 — `day-log:` prefix missing from `invalidateWorkoutSummaries()`
**File:** `lib/cache-groups.ts` line 4–19  
**Impact:** After a workout completes, if the user opens the Health > Calendar day-overlay for today, it shows the cached pre-workout exercise list (no exercises, or stale data). `day-log:${date}` uses a date-keyed cache and is not cleared on workout complete.  
**Fix:** Add `invalidateCache('day-log:')` to `invalidateWorkoutSummaries()`.

#### C3 — `QuickEditLogSheet` race condition (local-first path)
**File:** `components/nutrition/quick-edit-log-sheet.tsx` line 37–87  
**Impact:** When editing a food log quantity on the APK (local SQLite path):
1. Food log updated in local SQLite ✅
2. Mutation queued
3. `toast.success('Updated')`
4. `onSaved()` = `fetchData()` fires immediately
5. `fetchData()` calls `cachedFetch(...)` → serves stale cache → then fetches server
6. `pushMutations()` is fire-and-forget **after** `onSaved()` — server still has old quantity
7. Server fetch returns old quantity → UI reverts to old value

**Root cause:** `onSaved()` is called before `pushMutations` resolves. Server has stale data.  
**Fix:** In the local path, move `onSaved()` inside the `pushMutations().then(...)` callback and invalidate cache before calling it:
```ts
pushMutations(userId!).then(() => {
  invalidateCache(`nutrition-food-logs-${log.date}`).catch(() => {})
  onSaved()
}).catch(() => {})
```
Also invalidate cache in the web-fallback path before calling `onSaved()`.

#### C4 — AI prescription `consumed` status never set after workout completes
**File:** `app/api/complete-workout/route.ts` line 20–29  
**Impact:** After a user accepts and trains with a prescription, the pre-workout card still shows "Pending" on the next session. The server fires a new prescribe call immediately but the old prescription's `prescriptionStatus` is never set to `consumed`.  
**Root cause:** Known Tier-5 item from projectOverview.md. `complete-workout` fires `prescribe` asynchronously but doesn't first call `updatePrescriptionStatus(userId, programSessionId, 'consumed')`.  
**Fix:** Before firing the background prescribe call, call `repo.updatePrescriptionStatus(userId, programSessionId, 'consumed')`.

---

### 🟠 High — Significant UX or Data Issues

#### H1 — `PATCH /api/nutrition/food-logs/[id]` missing quantity bounds validation
**File:** `app/api/nutrition/food-logs/[id]/route.ts` line 10–16  
**Impact:** PATCH only checks `typeof quantityMultiplier !== 'number'` — no range check. A user could set serving size to `0`, `-5`, or `99999`.  
**Contrast:** POST validates `qm < 0.01 || qm > 100`.  
**Fix:** Add the same bounds check: `if (typeof quantityMultiplier !== 'number' || quantityMultiplier < 0.01 || quantityMultiplier > 100)`.

#### H2 — `body-metadata` GET sends `Cache-Control: private, max-age=30, stale-while-revalidate=60`
**File:** `app/api/body-metadata/route.ts` line 117–121  
**Impact:** When client-side `invalidateCache('body-metadata')` clears localStorage/SQLite cache and calls `fetch('/api/body-metadata')`, the browser's HTTP cache may serve a 30-second-old response. The fresh food/metrics data won't be reflected for up to 30s.  
**Root cause:** HTTP-level caching overrides the client-side invalidation because `cachedFetch` calls `fetch()` which honours browser HTTP cache.  
**Fix:** Change `Cache-Control` to `private, no-store` — the client-side `cachedFetch` already handles stale-while-revalidate with its own TTL.

#### H3 — Per-exercise log-exercise cache invalidation incomplete
**File:** `components/workout-screen.tsx` lines 612–616  
**Impact:** After logging a single exercise during a workout, the following caches are NOT cleared: `strength-trend`, `achievements:`, `progress-summary`, `streak-data`, `calendar-data:`. These ARE cleared when the workout completes via `invalidateWorkoutSummaries()`. The gap only matters if the user navigates to Health mid-workout — they'd see stale data.  
**Fix:** Add `invalidateCache('strength-trend')` to the per-exercise invalidation block (the other missing ones are acceptable to defer until completion).

#### H4 — `nutrition-food-logs-${today}` not invalidated before `QuickEditLogSheet.onSaved` (web path)
**File:** `components/nutrition/quick-edit-log-sheet.tsx` line 72–86  
**Impact:** Web fallback correctly awaits server write, but calls `onSaved()` (= `fetchData()`) without first invalidating the cache. `cachedFetch` serves stale 60s-old quantity first, then server returns the correct new value. User briefly sees old quantity flicker back.  
**Fix:** Add `await invalidateCache(`nutrition-food-logs-${log!.date}`)` before `onSaved()` in the web path.

---

### 🟡 Medium — Cache Gaps & Logic Issues

#### M1 — `invalidateWorkoutSummaries` missing `strength-trend`
Already listed as C1 — fix together.

#### M2 — `body-metadata` and `water-log` writes don't invalidate `day-log:` cache
**Files:** `app/api/body-metadata/route.ts` POST handler; `app/api/water-log/route.ts` POST handler  
**Impact:** The Health > Calendar day-overlay `DayLogResult.bodyMeta` is fetched by `day-log`, but `body-metadata` and `water-log` saves don't invalidate `day-log:${date}`. Day-overlay body weight/steps will be stale.  
**Fix:** After each POST response, invalidate `day-log:` on the client. Since these are server routes with no client cache context, the client callers must be updated. Both `session-select-content.tsx` and `health-content.tsx` have the `onLogged` callbacks — add `invalidateCache('day-log:')` there.

#### M3 — `log-exercise` reads full 141-entry exercise library per set logged
**File:** `app/api/log-exercise/route.ts` line 94–95  
**Impact:** Every set logged fetches all exercises just to determine `exerciseType`. This is ~141 DB rows on every set, ~3–8 sets per exercise, wasted CPU and DB time.  
**Fix:** Query only the specific exercise: `repo.getExerciseType(exercise)` — add a targeted lookup method to the repository, or use `WHERE LOWER(name) = LOWER($1) LIMIT 1`.

#### M4 — No rate limiting on `log-exercise`, `food-logs POST`, `complete-workout`
**Files:** `app/api/log-exercise/route.ts`, `app/api/nutrition/food-logs/route.ts`, `app/api/complete-workout/route.ts`  
**Impact:** An authenticated user could spam these routes. `log-exercise` does the most work: body metrics lookup, exercise library lookup, phase resolution, then a multi-row transaction. Moderate DoS risk from a single bad actor.  
**Fix:** Add `rateLimit` — recommended limits:
- `log-exercise`: 30 requests / 60s per userId
- `food-logs POST`: 60 requests / 60s per userId
- `complete-workout`: 5 requests / 60s per userId

#### M5 — `pushMutations` food_logs doesn't validate `mealTypeId`/`foodItemId` ownership
**File:** `lib/data/postgres/adapter.ts` lines 3259–3277  
**Impact:** A user who manipulates their local SQLite outbox payload could push a food_log with another user's `mealTypeId` or `foodItemId` (FK only checks existence, not ownership). The inserted row is scoped to their own userId for reads, so impact is limited — they can't read other users' data — but they create an inconsistent cross-user FK link.  
**Fix:** Add ownership validation before insert:
```ts
const owned = await this.db.select({ mt: /* count */, fi: /* count */ })
  .from(...) WHERE mealTypeId.userId = userId AND foodItemId.userId = userId
if (!owned) { errors.push(...); continue }
```

---

### 🔵 Low / Security Hardening

#### L1 — Feedback screenshot: no server-side byte limit
**File:** `app/api/feedback/route.ts`  
**Impact:** The Zod schema accepts any string for `screenshot_data`. The client compresses to 800px JPEG, but a malicious client could send an arbitrarily large payload and bloat the DB.  
**Fix:** Add `z.string().max(500_000)` (≈ 500 KB base64 limit).

#### L2 — In-memory rate-limit not shared across Railway instances
**File:** `lib/rate-limit.ts`  
**Impact:** With multiple Railway instances, each has its own counter. Effective rate limit is `N × limit`. Only matters when app scales beyond one instance.  
**Fix:** (Deferred) Migrate to Redis-backed rate limiting if Railway adds second instance.

#### L3 — `morning-briefing` localStorage key uses `formatInTimeZone` but `deviceTz` could be wrong on first render
**File:** `app/session-select/session-select-content.tsx` line 652  
**Impact:** `BRIEFING_KEY` uses `deviceTz` which is set from `session.user.timezone`. If the session is loading, this could be `undefined` and fallback to UTC. Very unlikely in practice since auth is required.  
**Fix:** Ensure fallback: `formatInTimeZone(new Date(), deviceTz ?? DEFAULT_TZ, "yyyy-MM-dd")`.

#### L4 — `sync/push` food_logs hard-delete doesn't support cross-device delete propagation
**File:** `lib/data/postgres/adapter.ts` line 3261–3263 + schema `food_logs`  
**Impact:** Food log deletes from one device don't propagate to another via pull delta (no `deleted_at` column = no soft delete = delta can't include delete markers). For single-device usage (one APK) this is fine — both local SQLite and server stay consistent. Only affects multi-device scenarios.  
**Fix (deferred):** Add `deleted_at TIMESTAMPTZ` to `food_logs`, change `deleteFoodLog` to soft-delete, add to pull delta. Low priority for current single-device use case.

---

## Implementation Order

### Batch 1 — Fix immediately (2–3 hours)
These are the highest-visibility bugs with very small, safe fixes:

1. **C1 + C2** — Add `strength-trend` and `day-log:` to `invalidateWorkoutSummaries()` — **2 lines**
2. **C3** — Fix `QuickEditLogSheet` race condition — **~10 lines**
3. **C4** — Mark prescription `consumed` in `complete-workout` — **2 lines**
4. **H1** — Add bounds check to `PATCH food-logs/[id]` — **3 lines**
5. **H2** — Change `body-metadata` `Cache-Control` to `no-store` — **1 line**
6. **H3** — Add `strength-trend` invalidation to per-exercise block in workout-screen — **1 line**
7. **H4** — Add cache invalidation before `onSaved()` in QuickEditLogSheet web path — **1 line**

### Batch 2 — Medium fixes (1–2 hours)
8. **M2** — Add `day-log:` invalidation to water-log/body-metadata client callers
9. **M3** — Fix `log-exercise` exercise library lookup to use targeted query
10. **M4** — Add rate limits to log-exercise, food-logs POST, complete-workout

### Batch 3 — Security hardening (30 min)
11. **M5** — Add FK ownership validation to `pushMutations` food_logs
12. **L1** — Add screenshot size cap to feedback schema

---

## Files to Change

| File | Issue(s) |
|------|----------|
| `lib/cache-groups.ts` | C1, C2 — add `strength-trend` and `day-log:` to `invalidateWorkoutSummaries` |
| `components/nutrition/quick-edit-log-sheet.tsx` | C3, H4 — fix race + add cache invalidation |
| `app/api/complete-workout/route.ts` | C4 — mark prescription consumed |
| `app/api/nutrition/food-logs/[id]/route.ts` | H1 — add quantity bounds check |
| `app/api/body-metadata/route.ts` | H2 — change Cache-Control header |
| `components/workout-screen.tsx` | H3 — add strength-trend invalidation per exercise |
| `app/session-select/session-select-content.tsx` | M2 — add day-log: invalidation to water/body callbacks |
| `app/health/health-content.tsx` | M2 — add day-log: invalidation to body metric save callback |
| `app/api/log-exercise/route.ts` | M3 — targeted exercise type lookup + M4 rate limit |
| `app/api/nutrition/food-logs/route.ts` | M4 — rate limit POST |
| `app/api/complete-workout/route.ts` | M4 — rate limit |
| `lib/data/postgres/adapter.ts` | M5 — FK ownership check for food_logs in pushMutations |
| `app/api/feedback/route.ts` | L1 — screenshot size cap |

---

## Not Issues (Verified Correct)

- **`food_logs.updatedAt` sync:** DB trigger `trg_set_updated_at` (migration 078) fires on every UPDATE, so edit syncs correctly.
- **`body_metrics.updatedAt` sync:** Same DB trigger covers it. COALESCE upsert fires the trigger, bumping `updated_at`.
- **`morning-briefing` caching:** Cached in localStorage per `YYYY-MM-DD` key using user's timezone. One AI call per day. Correct.
- **`health-connect/ingest` auth:** Uses constant-time `safeCompare` (via `timingSafeEqual`) against `HEALTH_CONNECT_INGEST_SECRET`. Correct.
- **Admin routes:** `requireAdmin` always does a fresh DB lookup ignoring JWT's `isAdmin` claim. Intentionally safe — can't be bypassed by a stale JWT.
- **Date handling across API routes:** All surveyed routes use `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` or `todayInTz()`. No UTC slice bugs found in active code.
- **User ID scoping:** All write routes take userId from `session.user.id` (JWT), never from request body.
- **`complete-workout` cache invalidation:** `invalidateWorkoutSummaries()` IS called client-side in `workout-screen.tsx` before the server POST fires. This is the correct pattern for a local-first UI.
