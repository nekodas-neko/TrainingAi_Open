# Deep-Dive Audit #2 — Caching & Offline (2026-06-13)

Scope: client cache invalidation on every write path, three-tier read order, loading/empty/error/offline
states, sign-out cache wipe. Excludes session-104 caching plan items C1–C7 (verified correct) and the
deferred SyncProvider warm-dedupe / U31 error-handling. Everything below is **new** or a write site the
session-104 plan missed.

Skill: `.agents/skills/caching-conventions/SKILL.md` + `.agents/skills/pwa-offline-patterns/SKILL.md`.
Cache key registry and `invalidateProgramStructure()` / `invalidateWorkoutCardCache()` / `invalidateReadinessInputs()`
helpers live in `lib/cache-groups.ts`; cache primitives in `lib/sqlite/cache.ts`.

---

## Task 1 — Sign-out clears NO client cache layer (cross-user data leak) · **High**

- **Where:** `app/actions.ts:5-7` (server action) invoked from `components/more/profile-tab.tsx:757`.
- **Problem:** `signOut()` only calls `authSignOut({ redirectTo })`. Nothing clears the SQLite `api_cache` table, `ta_cache:*` localStorage, `ta_sscache:*` sessionStorage, or the `ta_*_goal*` localStorage keys. A second account on the same device sees the first user's cached **global-keyed** data (`body-metadata`, `weekly-stats`, `workout-data`, `nutrition-*`). The skill states this must be wiped on sign-out ("1.15.0") — it is currently unwired; no `clearAllCache` helper exists anywhere.
- **Fix:** Add `clearAllCache()` to `lib/sqlite/cache.ts` (`DELETE FROM api_cache`; remove every `ta_cache:`/`ta_sscache:` key; clear the in-flight map). Add a client sign-out handler in `profile-tab.tsx` that `await`s it (and removes the `ta_*_goal*` keys + `ta_avatar`/`ta_pill_colors`) **before** calling the `signOut()` server action.
- **Verify:** Sign in as user A, populate caches, sign out, sign in as user B → `ta_cache:*`/`ta_sscache:*` empty, no A data visible. Playwright-checkable.

## Task 2 — Admin exercise edits don't invalidate `exercise-library` · **High**

- **Where:** `components/admin/exercise-manager.tsx:265-283` (`handleSave`), `:285-297` (`handleDelete`), `:299-317` (`handleSeed`).
- **Problem:** All three mutate the global catalogue but none call `invalidateCache('exercise-library')`. That key is warmed at 6h TTL and read via `readCacheSync`/`cachedFetch` in `config-screen.tsx:142/158` and `add-exercise-sheet.tsx:51`, so admin create/edit/delete/GIF-seed don't appear in the builder/config for up to 6h. The registry explicitly lists "Admin exercise edits" as an `exercise-library` invalidator; the user-facing `add-exercise-sheet` does it correctly — admin is the inconsistent one.
- **Fix:** `await invalidateCache('exercise-library')` after each successful save/delete/seed (alongside the existing `load()`).
- **Verify:** Edit an exercise in admin → open the builder swap panel without reload → change is present.

## Task 3 — AI workout-builder save invalidates only `workout-data` · **High**

- **Where:** `components/workout-builder/builder-review.tsx:264` (`handleSave`).
- **Problem:** The primary "create + activate a new program" path POSTs an active program, clones a phase set (`:222`), seeds PRs (`:272`), but only calls `invalidateCache('workout-data')`. It misses `next-session`, `progression-styles`, `muscle-recovery`, `phase-sets`, `workout-templates`. Result: after the AI builder activates a program, the home "Next Session" card shows the old session (the C3 bug, fixed only for config), and config's lists are stale.
- **Fix:** Replace the lone call with `await invalidateProgramStructure()` + `invalidateCache('phase-sets')` + `invalidateCache('workout-templates')` + `invalidateWorkoutCardCache()` (the helpers config-screen uses), plus `weights-summary` since PRs were seeded.
- **Verify:** Build & activate a program via the AI builder → home "Next Session" reflects the new program immediately.

## Task 4 — `nutrition-meal-types` never invalidated after meal-type edits · **Med**

- **Where:** `components/nutrition/meal-type-manager.tsx:79` (PUT), `:97` (DELETE), `:113` (POST), `:143` (PATCH reorder).
- **Problem:** `nutrition-meal-types` is cached at 6h via `cachedFetch` in `app/nutrition/nutrition-content.tsx:60`. None of the four mutations invalidate it → renaming/adding/deleting/reordering a meal type doesn't reflect on the Nutrition page (or in meal-reminder reconciliation) for up to 6h.
- **Fix:** `await invalidateCache('nutrition-meal-types')` after each of the four writes resolves.

## Task 5 — `overview-screen` body-metric log skips `body-metadata`/readiness invalidation · **Med**

- **Where:** `components/overview-screen.tsx:188-196` (`handleSaveLog`).
- **Problem:** POSTs `/api/body-metadata` then only calls `fetchMeta()`. Unlike the now-fixed `health-content.tsx:382-383` and `session-select-content.tsx:732-733`, it omits `invalidateCache('body-metadata')` + `invalidateReadinessInputs()`. The shared `body-metadata` cache (Health/Nutrition/Profile) and `readiness-score`/`weekly-stats` stay stale up to TTL. Third body-metric widget-log site; session-104 C6 patched only the other two.
- **Fix:** After the POST: `await invalidateCache('body-metadata'); await invalidateReadinessInputs();` before `fetchMeta()`.

## Task 6 — `invalidateProgramStructure()` omits `workout-templates` · **Med**

- **Where:** `lib/cache-groups.ts:25-32`; affects callers `config-screen.tsx:484/506/529` and the builder (Task 3).
- **Problem:** `workout-templates` (program list) is warmed at 6h and read via `readCacheSync('workout-templates')` at `config-screen.tsx:140` for instant pre-paint. No write path invalidates it, so on a cold navigation to Config the synchronous read serves a stale list first (a deleted program reappears / wrong active flag for one frame).
- **Fix:** Add `invalidateCache('workout-templates')` inside `invalidateProgramStructure()` — one line, fixes all program-mutation callers at once.

## Task 7 — `activity-type-manager` admin edits don't invalidate `activity-types` · **Med**

- **Where:** `components/admin/activity-type-manager.tsx:122-140` (`handleSave`), `:142-157` (`handleDelete`).
- **Problem:** `activity-types` warmed at 6h, consumed by the activity-logging UI; neither mutation invalidates it → a new/edited/deleted activity type doesn't appear when logging for up to 6h. Same class as Task 2.
- **Fix:** `await invalidateCache('activity-types')` after each successful save/delete.

## Task 8 — `stats-content` uses bare `fetch()` instead of `cachedFetch` (no error/retry) · **Low**

- **Where:** `app/stats/stats-content.tsx:54,73,98` (with `.catch(()=>{})` at `:57/:81/:107`).
- **Problem:** Uses `readCacheSync` for pre-paint (good) but revalidates with raw `fetch()`, so the fresh response is never written back to the persistent cache (other screens / next cold start don't benefit) and a failed fetch is silently swallowed — on a cold cache with no network the weekly-stats hub renders empty with no error/retry.
- **Fix:** Replace the three bare fetches with `cachedFetch<T>(key, url, ttl, setState)` (keys `weekly-stats`, `exercise-library`, `workout-data:meta` exist) and add a visible error/retry state when there's no cached data.

---

## Already correct (no action)
`food-logger-sheet`, `saved-meals-sheet` quick-log, `nutrition-content` delete, `nutrition-targets-form`,
`water-log-sheet`, `mood-checkin-sheet`, `done-activity-screen`, `health-content`/`session-select-content`
body writes, `add-exercise-sheet`, `config-screen` program/style/phase-set writes. No date-keyed cache
bypasses `todayInTz()`.

## Verification & commit
- After each task: make the edit, navigate away and back **without a full reload** — new data must appear immediately.
- `pnpm exec tsc --noEmit && pnpm lint && pnpm test`; Playwright smoke for Task 1 (two-account cache wipe) and Task 3 (next-session refresh).
- User-visible ("edits show up immediately") → bump `package.json` **patch**, add a `lib/changelog.ts` entry naming the symptom fixed.
