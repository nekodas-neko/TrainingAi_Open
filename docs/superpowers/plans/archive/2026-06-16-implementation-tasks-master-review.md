# Master Implementation Task Review — 2026-06-16

> **Purpose:** Aggregate all outstanding bugs, risks, deferred features, and upgrade items from every audit
> and deep-dive plan into one ranked, cross-referenced backlog. Items marked ✅ were confirmed already
> shipped; all others remain open. This document supersedes individual audit/deepdive status sections
> and should be kept current as items are closed.
>
> **Method:** Full review of `2026-06-13-audit-*.md`, `2026-06-13-deepdive-*.md`, all sessions
> 104–125, and live code spot-checks. Each item references its canonical plan or session note.

---

## Confirmed already shipped (not re-listed below)

The following were fully addressed in sessions 104–125:

| Area | Items done |
|------|------------|
| **Security (audit)** | N1 IDOR rename, N2/N3 TTS rate+length, N4 exercise-gen rate, N5 sync-health bounds, N6 calendar-event validation, N7 library-create admin gate |
| **Caching (audit C1–C6)** | `lib/cache-groups.ts` created; workout-complete, set-log, program save/activate/delete, style save/delete, mood/body/activity writes all invalidate derived caches; `streak-data`/`calendar-data` added to `invalidateWorkoutSummaries` |
| **Logic (audit L1–L4)** | PR recorded after log transaction; latest bodyweight used for BW exercises; offline `useFor1rm` matches server; calorie-streak respects goal direction |
| **Performance (audit P1/P3/P5/P6)** | Workout store shallow selector; `SetCard` memoized with index callbacks; stale exercise-history fetch aborted; dead weekly-digest self-fetch removed |
| **UI/a11y (partial)** | `aria-label` + larger touch targets on nutrition icon buttons; sheet safe-area padding; nutrition loading skeleton |
| **1RM calculation** | `calculate1RM` corrected with prescription-relative correction factor (session 111) |
| **Phase system** | Multiple phase-progression bugs fixed (sessions 107–110) |
| **Admin cascade rename** | `adminUpdateExercise` cascades across all name-keyed tables (session 120) |
| **Goals / health** | AI goal recommender, Goals card redesign, 1RM mode toggle, weekly goal aggregation, Goals card on Health > Progress (sessions 112–123) |
| **Local-first sync** | Dexie IndexedDB store, `/api/sync/pull`, `/api/sync/push`, SyncProvider integration (session 124) |
| **Cache load-time** | `readCacheSync` + `cachedFetch` added to overview, calendar, session-select, nutrition for instant first paint (session 125) |

---

## Section 1 — Security (outstanding)

### S-DD-1 · ✅ · Cross-tenant IDOR: phase-set can reference another user's style UUID
- **Source:** `2026-06-13-deepdive-security.md` Task 1
- **Where:** `app/api/phase-sets/[id]/route.ts:20-32` → `adapter.ts:811-842` (`updatePhaseSet`)
- **Problem:** Ownership of the phase set is checked, but `primaryStyleId`/`secondaryStyleId` are written with no check that those style UUIDs belong to the caller. A user can pin another tenant's style into their own phase — leaking that tenant's progression config if styles are resolved server-side.
- **Fix:** Before writing, load `repo.listProgressionStyles(userId)` and reject (400) any `primaryStyleId`/`secondaryStyleId` not in the caller's owned set.
- **Effort:** Small (one lookup + guard).

### S-DD-2 · ✅ · Cross-tenant IDOR: food-log can reference another user's meal-type/food-item
- **Source:** `2026-06-13-deepdive-security.md` Task 2
- **Where:** `app/api/nutrition/food-logs/route.ts:23-32` → `adapter.ts:2135-2140` (`createFoodLog`); same in `saved-meals` POST/PUT
- **Problem:** `createFoodLog` inserts client `mealTypeId` + `foodItemId` with no ownership check. A crafted request references another user's meal type / food item, and subsequent joined reads surface that tenant's food data into the caller's diary.
- **Fix:** Validate both ids belong to `userId` before the write. Apply same guard to `saved-meals` POST/PUT.
- **Effort:** Medium (batched ownership lookup + test).

### S-DD-3 · ✅ · Unbounded array writes (DoS) — 6 routes
- **Source:** `2026-06-13-deepdive-security.md` Task 3
- **Routes (no array cap):**
  - `app/api/personal-records/seed/route.ts:16` — `entries[]`
  - `app/api/activity-logs/route.ts` — `splits`/`paceSeries`/`bestEfforts`
  - `app/api/progression-styles/route.ts` — `style.sets[]`
  - `app/api/nutrition/saved-meals/route.ts` + `saved-meals/[id]/route.ts` — `items[]`
  - `app/api/body-metadata/route.ts` — numeric fields with no `.min/.max`
- **Fix:** Zod `.max()` array caps (100–400 per field) and numeric bounds, returning 413 on violation.
- **Effort:** Small per route; do all at once.

### S-DD-4 · ✅ · Validation gaps on profile / nutrition writes
- **Source:** `2026-06-13-deepdive-security.md` Task 4
- **Where:** `nutrition/food-items`, `nutrition/meal-types`, `nutrition/food-logs`, `nutrition/targets`, `user/profile`, `user/goals`
- **Problem:** Numeric goal/target fields accept negatives/extremes; strings have no length cap.
- **Fix:** Add Zod bounds (`.max()` on strings, `.min().max()` on numbers, hour fields `0–23`).
- **Effort:** Small.

### S-DD-5 · ✅ · Rate-limit gaps on barcode, nutrition/scan, mood
- **Source:** `2026-06-13-deepdive-security.md` Task 5
- **Routes missing `rateLimit()`:**
  - `app/api/nutrition/barcode/route.ts:37` — proxies Open Food Facts (unthrottled enumeration)
  - `app/api/nutrition/scan/route.ts` — paid Gemini vision model, no rate limit
  - `app/api/mood/route.ts:20` — POST, no per-user throttle
- **Fix:** `rateLimit('barcode:<userId>', …)`, `rateLimit('nutrition-scan:<userId>', …)`, `rateLimit('mood:<userId>', …)`.
- **Effort:** Small (one line per route).

### S-DD-6 · ✅ · `nutrition/scan` image-size guard measures wrong byte basis
- **Source:** `2026-06-13-deepdive-security.md` Task 6
- **Where:** `app/api/nutrition/scan/route.ts:43-46`
- **Problem:** `Buffer.byteLength(image, 'utf8')` on a base64 string under-reports the real payload by ~33%.
- **Fix:** Use `'base64'` encoding: `Buffer.byteLength(image, 'base64')`.
- **Effort:** One line.

### S-DD-7 · **Low** · Repository-pattern bypass (6 routes)
- **Source:** `2026-06-13-deepdive-security.md` Task 7
- **Routes:** `workout-entry/route.ts`, `exercise-gif/route.ts`, `friends/feed`, `friends/leaderboard`, `admin/exercises`, `admin/seed-exercise-gifs`, `profile/[userId]`, `program-week/route.ts` (creates `new PostgresWorkoutRepository(...)` instead of `getRepository()`).
- **Fix:** Move queries into `WorkoutRepository` methods; switch `program-week` to `await getRepository()`. Low priority — mostly read paths, all parameterized.
- **Effort:** Medium per route; do in slices.

---

## Section 2 — Caching / Data Correctness (outstanding)

### C-DD-1 · ✅ · Sign-out clears NO client cache layer — cross-user data leak
- **Source:** `2026-06-13-deepdive-caching.md` Task 1
- **Where:** `app/actions.ts:5-7` → `components/more/profile-tab.tsx` sign-out handler
- **Status:** **Confirmed still open** (live code check — `signOut()` only calls `authSignOut`, no cache wipe).
- **Problem:** `api_cache` (SQLite), `ta_cache:*`/`ta_sscache:*` localStorage/sessionStorage, and all `ta_*_goal*` keys are never cleared. A second account on the same device sees the first user's body-metadata, weekly-stats, nutrition, etc.
- **Fix:**
  1. Add `clearAllCache()` to `lib/sqlite/cache.ts` (`DELETE FROM api_cache`; remove every `ta_cache:`/`ta_sscache:` key; clear in-flight map).
  2. Also clear `ta_*_goal*`, `ta_avatar`, `ta_pill_colors` localStorage keys.
  3. In `profile-tab.tsx`, await `clearAllCache()` before calling the server `signOut()` action.
  4. Also wipe Dexie DB for the current user (call `getLocalStore(userId)` and clear/delete it).
- **Effort:** Medium. No migration needed.

### C-DD-2 · ✅ · Admin exercise edits don't invalidate `exercise-library` cache
- **Source:** `2026-06-13-deepdive-caching.md` Task 2
- **Where:** `components/admin/exercise-manager.tsx` `handleSave` / `handleDelete` / `handleSeed`
- **Status:** **Confirmed still open** (no `invalidateCache` calls in any of those handlers).
- **Problem:** `exercise-library` is cached at 6h TTL. Admin create/edit/delete/GIF-seed don't appear in the program builder or config for up to 6h.
- **Fix:** `await invalidateCache('exercise-library')` after each successful save/delete/seed (alongside the existing `load()`).
- **Effort:** Three lines.

### C-DD-3 · ✅ · AI workout-builder save invalidates only `workout-data`
- **Source:** `2026-06-13-deepdive-caching.md` Task 3
- **Where:** `components/workout-builder/builder-review.tsx:264` `handleSave`
- **Status:** **Confirmed still open** — only `invalidateCache('workout-data')` called.
- **Problem:** After the AI builder activates a program, the home "Next Session" card, config program list, and progression-styles cache all go stale.
- **Fix:** Replace the lone `invalidateCache('workout-data')` with:
  ```ts
  await invalidateProgramStructure()
  await invalidateCache('phase-sets')
  await invalidateCache('workout-templates')
  await invalidateCache('weights-summary')
  ```
- **Effort:** Four lines.

### C-DD-4 · ✅ · `invalidateProgramStructure()` omits `workout-templates`
- **Source:** `2026-06-13-deepdive-caching.md` Task 6
- **Status:** **Confirmed still open** — `lib/cache-groups.ts` `invalidateProgramStructure` does not include `workout-templates`.
- **Problem:** Deleting or creating a program doesn't clear the cached program list, so Config's synchronous `readCacheSync('workout-templates')` pre-paint can serve a stale list (deleted program reappears for one frame).
- **Fix:** Add `invalidateCache('workout-templates')` inside `invalidateProgramStructure()`. One line; fixes all callers.
- **Effort:** One line.

### C-DD-5 · ✅ · `nutrition-meal-types` never invalidated after meal-type edits
- **Source:** `2026-06-13-deepdive-caching.md` Task 4
- **Where:** `components/nutrition/meal-type-manager.tsx` PUT/DELETE/POST/PATCH reorder handlers
- **Problem:** Renaming/adding/deleting/reordering a meal type doesn't appear on the Nutrition page for up to 6h.
- **Fix:** `await invalidateCache('nutrition-meal-types')` after each of the four writes resolves.
- **Effort:** Four lines.

### C-DD-6 · ✅ · `overview-screen` body-metric log skips `body-metadata`/readiness invalidation
- **Source:** `2026-06-13-deepdive-caching.md` Task 5
- **Where:** `components/overview-screen.tsx:188-196` (`handleSaveLog`)
- **Problem:** Third body-metric widget-log site — the other two (health-content, session-select) were fixed in session 104 C6; this one was missed.
- **Fix:** After POST: `await invalidateCache('body-metadata'); await invalidateReadinessInputs();` before `fetchMeta()`.
- **Effort:** Two lines.

### C-DD-7 · ✅ · `activity-type-manager` admin edits don't invalidate `activity-types`
- **Source:** `2026-06-13-deepdive-caching.md` Task 7
- **Where:** `components/admin/activity-type-manager.tsx` `handleSave` / `handleDelete`
- **Problem:** A new/edited/deleted activity type doesn't appear when logging for up to 6h.
- **Fix:** `await invalidateCache('activity-types')` after each successful save/delete.
- **Effort:** Two lines.

### C-DD-8 · **Low** · `stats-content` uses bare `fetch()` with no error/retry
- **Source:** `2026-06-13-deepdive-caching.md` Task 8
- **Where:** `app/stats/stats-content.tsx:54,73,98` (bare `fetch()` + `.catch(()=>{})`)
- **Problem:** Fresh responses never written back to persistent cache; a failed fetch on cold cache silently renders empty with no error state.
- **Fix:** Replace three bare fetches with `cachedFetch<T>(key, url, ttl, setState)` matching the keys `weekly-stats`, `exercise-library`, `workout-data:meta`. Add a visible error/retry state.
- **Effort:** Small.

### C-SESSION-1 · **Low** · Session tab workout data still uses custom `sessionStorage` key
- **Source:** `projectOverview.md` session 125 remaining gaps
- **Where:** `fetchWorkoutData` in session-select — per-session workout detail prefetch uses `ta_wc_${sess.id}` sessionStorage key rather than `cachedFetch`.
- **Problem:** Re-fetches from network on every cold launch. Low impact (background prefetch, doesn't block visible UI).
- **Fix:** Convert to `cachedFetch` with key `workout-card:${sess.id}` and `TTL_LONG`.

### C-SESSION-2 · **Low** · `exercise-history` N+1 uncached fetches per workout
- **Source:** `projectOverview.md` session 125 remaining gaps
- **Where:** Active workout screen — each exercise fetches its own history via uncached `fetch()`.
- **Problem:** 5–8 serial/parallel uncached requests when opening the workout screen.
- **Fix:** Convert to `cachedFetch` with key `exercise-history:${exerciseName}` and `TTL_MEDIUM`.

---

## Section 3 — Performance (outstanding)

### P-DD-1 · ✅ · Activity-tracking screens subscribe to the whole Zustand store
- **Source:** `2026-06-13-deepdive-performance-breakup.md` Task PER-1
- **Where:** `components/activity/active-activity-screen.tsx:16-21`, `pre-activity-screen.tsx:12`, `done-activity-screen.tsx:25`
- **Problem:** `const { … } = useActivityStore()` with no selector — every GPS sample mutation (`appendPoint`) triggers a re-render of all three screens and the dynamically-loaded Leaflet map. Drains battery during a long GPS workout.
- **Fix:** Subscribe with `useShallow((s) => ({ …only fields used… }))` in all three screens (matching the already-correct parent `activity-screen.tsx:9`).
- **Effort:** Small.

### P-DD-2 · ✅ · `chart.js` statically bundled into home/health/stats/nutrition initial chunks
- **Source:** `2026-06-13-deepdive-performance-breakup.md` PER-2 + `deepdive-ui-charts-animations.md` C1/C2/C5
- **Where:**
  - `components/ai-chat-overlay.tsx:8` statically imports `ChartMessage` → home screen initial chunk
  - `components/weekly-ai-summary.tsx:7` statically imports `ChartMessage` → health/stats initial chunk
  - `app/nutrition/nutrition-content.tsx:11` statically imports `WeeklyNutritionChart` → nutrition chunk
- **Fix:** `next/dynamic(() => import(...), { ssr: false })` wrapping each consumer (matching the already-correct `ExerciseStatsSheet` pattern in `pre-workout-screen.tsx:13`).
- **Effort:** Small per site; do all three at once.

### P-AUDIT-2 · ✅ · Mid-workout `/api/achievements` fetched 3× (15 full-table aggregate scans)
- **Source:** `2026-06-13-audit-performance.md` Task P2 (deferred from session 104)
- **Where:** `components/workout-screen.tsx` — mount fetch + pre-exercise-complete fetch + done-screen fetch
- **Problem:** Heaviest queries in the app run during the active workout, on battery. Only the done-screen XP delta is user-visible.
- **Fix (minimal):** Remove the mount-time and pre-screen-complete fetches; capture the "before" XP from `readCacheSync('achievements:<userId>')` for the delta calculation. Keep only the post-completion done-screen fetch.
- **Fix (durable, separate task):** Denormalize lifetime counters into a `user_stats` table; rewrite `lib/achievements.ts` aggregates to read from there (removes the scans entirely).
- **Effort:** Minimal fix = small; durable fix = medium + migration.

### P-DD-3 · **Medium** · N+1 per-login progression-style seeding
- **Source:** `deepdive-performance-breakup.md` PER-3 (also audit P4, deferred from session 104)
- **Where:** `lib/data/postgres/adapter.ts:171-198, 247-257, 360-367` (inside `upsertUser`, runs every login)
- **Problem:** ~17 individual `SELECT … LIMIT 1` checks + per-set/per-phase `INSERT`s in nested loops on every login.
- **Fix:** Gate with one `SELECT 1 FROM progression_styles WHERE user_id=$1 LIMIT 1`; if present, skip all seeding. Only when absent: multi-row `db.insert().values([...])` for styles/sets/phase-sets.
- **Effort:** Medium.

### P-DD-4 · **Low** · Unmemoized derived computations in `health-content.tsx`
- **Source:** `deepdive-performance-breakup.md` PER-5
- **Where:** `app/health/health-content.tsx:392-436` — BMI, BF classification, weight-trend linear regression, energy balance all computed inline, every render.
- **Fix:** `useMemo` keyed on `metaRecent`/relevant scalars. Falls out naturally from the CB-4 breakup (do together).
- **Effort:** Small.

---

## Section 4 — UI / Accessibility (outstanding)

### U-DD-1 · **Medium** · Hand-rolled nutrition sheets bypass shared Radix `<Sheet>`
- **Source:** `2026-06-13-audit-ui-consistency.md` Task U1 (deferred from session 104)
- **Sheets:** `food-logger-sheet.tsx:269`, `food-library-sheet.tsx:47`, `quick-edit-log-sheet.tsx:56`, `components/ai/chat-overlay.tsx:111`
- **Problem:** Hand-rolled `fixed inset-x-0 bottom-0` overlays miss focus-trap, `role=dialog`, safe-area insets, and Android back-dismiss semantics.
- **Fix:** Migrate all four to `<Sheet open onOpenChange>` + `<SheetContent side="bottom" className="pb-[max(1rem,env(safe-area-inset-bottom))] …">`. The hand-rolled `useSheetBackDismiss` hook (session 87) stays for any that can't use native Radix dismiss.
- **Effort:** Medium per sheet; low risk if done one at a time.

### U-DD-2 · **Medium** · Deferred: shared `<Button>` for 11 hand-rolled nutrition primary buttons
- **Source:** `2026-06-13-audit-ui-consistency.md` Task U6 (deferred from session 104)
- **Where:** 11 `<button className="rounded-xl bg-foreground text-background …">` in `components/nutrition/*`
- **Fix:** Replace with `<Button>` (default variant). Gives consistent focus ring + disabled state.
- **Effort:** Small (mechanical swap).

### U-DD-3 · **Medium** · Deferred: shared fetch-error toast on user-initiated action failures
- **Source:** `2026-06-13-audit-ui-consistency.md` Task U2 (deferred from session 104)
- **Where:** Write paths in `health-content.tsx`, `nutrition-content.tsx`, food/meal sheets all swallow errors silently.
- **Fix:** Create `lib/ui/fetch-with-toast.ts` thin wrapper; replace `catch(() => {})` on write/action paths with `toast.error(...)`. Leave background reads silent.
- **Effort:** Small.

### U-DD-4 · **Medium** · chart.js charts hardcode theme colours
- **Source:** `deepdive-ui-charts-animations.md` C3 + C4
- **Where:** `components/chart-message.tsx:95` (bg-white / dark:bg-zinc-900 wrapper, hardcoded gridline text); `components/nutrition/weekly-nutrition-chart.tsx:82-86` (ticks `'#888'`, grid `rgba(255,255,255,0.06)` — invisible in light mode)
- **Fix:** Use CSS vars `var(--muted-foreground)` for ticks/legend, `var(--border)` for gridlines. Drop the `bg-white` wrapper in favour of the card surface.
- **Effort:** Small.

### U-DD-5 · **Medium** · Animations ignore `prefers-reduced-motion`
- **Source:** `deepdive-ui-charts-animations.md` A1 + A2 + A3
- **What's missing:**
  - `components/ui/meteors.tsx:49` — `.meteor-particle` animation never zeroed under reduced motion
  - `components/workout/muscle-recovery-card.tsx:30-35` — `ta-marquee` applied via inline style (can't be Tailwind-gated)
- **Fix:** Add a global `@media (prefers-reduced-motion: reduce)` block in `app/globals.css` that zeros `meteor`, `ta-marquee`, and the weather particle keyframes. Keep functional animations (timer ring, `border-run`) intact.
- **Effort:** Small (CSS only).

### U-DD-6 · **Low** · `WeeklyNutritionChart` metric toggles are sub-44dp tap targets
- **Source:** `deepdive-ui-charts-animations.md` U-new-1
- **Where:** `components/nutrition/weekly-nutrition-chart.tsx:96-106` — Calories/Protein/Carbs/Fat toggles at `px-2.5 py-1 text-[10px]`
- **Fix:** `min-h-[40px] py-2 text-xs` on each toggle button.
- **Effort:** One line.

### U-DD-7 · **Low** · Section headers missing semantic `<h2>`/`<h3>` in two places
- **Source:** `deepdive-ui-charts-animations.md` U27
- **Where:** `components/health/strength-progress-card.tsx:41,46`, `components/nutrition/weekly-nutrition-chart.tsx:93`
- **Fix:** Replace `<p>` / `<div>` card/section titles with `<h3>`.
- **Effort:** Trivial.

### U-MISC-1 · **Low** · `weeklyTarget` formula duplicated in `session-select-content.tsx`
- **Source:** `projectOverview.md` session 122 follow-up
- **Where:** `app/session-select/session-select-content.tsx` ~lines 570-574
- **Problem:** Fourth copy of the cadence formula — diverges silently if anyone changes `lib/schedule-utils.ts`.
- **Fix:** Import `getScheduledSessionsPerWeek` from `lib/schedule-utils` and remove the inline formula.
- **Effort:** Trivial.

---

## Section 5 — Capacitor / Native (outstanding)

### N-DD-1 · ✅ · `lib/haptics.ts` static-imports `@capacitor/haptics` into the web bundle
- **Source:** `deepdive-native-health.md` Task 1
- **Where:** `lib/haptics.ts:1`
- **Problem:** The static import pulls the plugin into the PWA bundle — risks `"failed to resolve module specifier"` on web and ships dead code to every browser user.
- **Fix:** Convert each exported fn to gate + dynamic import:
  ```ts
  export async function hapticTick() {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
  }
  ```
  Bundle-verifiable via `pnpm build` (sandbox OK). Haptic feel ⚠️ on-device.
- **Effort:** Small.

### N-DD-2 · ✅ · `barcode-scanner.tsx` static-imports `@capacitor-community/barcode-scanner`
- **Source:** `deepdive-native-health.md` Task 2
- **Where:** `components/nutrition/barcode-scanner.tsx:8`
- **Problem:** Calls are gated on `isNativePlatform()` but the static import still bundles the plugin for web.
- **Fix:** Dynamically `import('@capacitor-community/barcode-scanner')` inside `startNative()`/`stopNative()`.
- **Effort:** Small.

### N-DD-3 · **Medium** · `TotalCaloriesBurned` permission never requested — calories-burned never syncs
- **Source:** `deepdive-native-health.md` Task 4 (new finding, not the H7 known issue)
- **Where:** `lib/health-connect-sync.ts:120,258` — both `aggregateRecords({type:'TotalCaloriesBurned'})` calls run ungated, but `'TotalCaloriesBurned'` is not in the `requestPermissions({read:[...]})` array.
- **Problem:** Permission never granted → every sync throws a permission error (swallowed by catch) → `caloriesBurned` has likely never populated from Health Connect.
- **Fix:** Add `'TotalCaloriesBurned'` to the read-permissions array and gate each aggregate behind `canRead.has('TotalCaloriesBurned')`. ⚠️ On-device only.
- **Effort:** Small code change; verification needs device.

### N-DD-4 · **Medium** · H7: HRV read key mismatch — dead code since introduced
- **Source:** `deepdive-native-health.md` Task 3 / Known Issue H7
- **Where:** `lib/health-connect-sync.ts:312,315`
- **Problem:** `canRead.has('HeartRateVariabilitySdnn')` / `readRecords({type:'HeartRateVariabilitySdnn'})` — neither key is in the permissions array, and neither matches the plugin's `RECORDS_TYPE_NAME_MAP` key `'HeartRateVariabilityRmssd'`. HRV has never synced.
- **Fix:** Add `'HeartRateVariabilityRmssd'` to the read-permissions array; change both `canRead.has(...)` and `readRecords({type:...})` to `'HeartRateVariabilityRmssd'`. Also note Known Issue H6: even after this, `RecordConverter.kt` may still not structure the record — needs APK-level native patch. ⚠️ On-device.
- **Effort:** Small code change; verification needs device.

### N-DD-5 · **Medium** · Rest-timer notification not reconciled on app resume
- **Source:** `deepdive-native-health.md` Task 5
- **Where:** `components/workout-screen.tsx:260-271`
- **Problem:** No `App.addListener('resume', …)` for the rest timer — if the alarm is evicted or the rest phase changed while suspended, it isn't reconciled. Meal reminders reconcile correctly (session 106 pattern); rest timer doesn't.
- **Fix option A:** Add a `resume` listener that re-derives `remainingMs` from `store.restStartMs` and reschedules/cancels.
- **Fix option B:** Document the one-shot alarm as intentionally fire-and-forget (acceptable for this use case).
- **Effort:** Small either way.

### N-DD-6 · **Low** · Extract rest-timer reconcile logic as a pure, tested function
- **Source:** `deepdive-native-health.md` Task 6
- **Where:** `components/workout-screen.tsx:260-271`
- **Fix:** Extract `computeRestNotificationAction(phase, restStartMs, restSec, now)` → `{type:'schedule',delayMs} | {type:'cancel'}` into `lib/notifications.ts` and add Vitest unit tests. Matches the pattern established for `computeMealReminderActions`.
- **Effort:** Small.

### N-DD-7 · **Low** · Health Connect permission-key/read-array mismatch not guarded by a test
- **Source:** `deepdive-native-health.md` Task 7
- **Problem:** The recurring H6/H7/calories bug class (permission key ≠ read key) ships silently because nothing asserts parity between the three sets.
- **Fix:** Export a `HC_READ_TYPES` constant map from `lib/health-connect-sync.ts`; add a Vitest test asserting the `requestPermissions` array, `canRead.has(...)` keys, and `readRecords/aggregateRecords` types all use the same set.
- **Effort:** Small.

---

## Section 6 — Logic / Correctness (outstanding)

### L-DD-1 · ✅ · `workout-entry` PATCH has duplicate `calc1RM` missing the reps>30 guard
- **Source:** `deepdive-logic.md` Task 1
- **Where:** `app/api/workout-entry/route.ts:9-15` (private `calc1RM`), used at `:51`
- **Problem:** Editing an existing log with >30 reps recomputes `estimated_1rm` with an absurd inflated value. The canonical `log-exercise` route has a `reps <= 30` guard; this duplicate missed it. Live path: called from stats and health edit flows.
- **Fix:** Replace the private `calc1RM` with an import of the shared one from `lib/1rm.ts` and add the same `r <= 30` guard. (While here: also add Zod bounds and an ownership check per S-DD-7.)
- **Effort:** Small.

### L-DD-2 · **Low** · Offline 1RM snapshot in `workout-screen` omits the reps>30 guard
- **Source:** `deepdive-logic.md` Task 2
- **Where:** `components/workout-screen.tsx:438`
- **Problem:** No reps cap on the offline `estimated1rm` computation — a high-rep set briefly inflates the client-side value until the server response replaces the row.
- **Fix:** `snapReps[i] != null && snapReps[i] <= 30 ? calc1RM(w, snapReps[i]) : 0`.
- **Effort:** One line.

### L-DD-3 · **Low** · Redundant `.replace(/-/g, "/")` on an already-slash date string
- **Source:** `deepdive-logic.md` Task 4
- **Where:** `components/stats/weekly-stats-hub.tsx:27`
- **Problem:** `localDateString()` already returns `YYYY/MM/DD`; the `.replace` is a no-op that misleads readers.
- **Fix:** Drop the `.replace(...)`.
- **Effort:** Trivial.

---

## Section 7 — Local-First Sync Follow-ups (deferred from session 124)

These were explicitly scoped out of session 124 and remain follow-on work.

### LS-1 · **High** · First on-device Dexie test
- **Problem:** The entire IndexedDB local store, delta pull/push, and local-first writes have only been tested against the local dev DB via curl. Device testing may surface Dexie compatibility issues, field mapping mismatches, or conflict-resolution edge cases.
- **Action:** Install on Samsung Galaxy S25 Ultra, check IndexedDB in DevTools, confirm body-metric and mood writes sync bidirectionally.

### LS-2 · **Medium** · Body metrics fast-path not wired for raw weight chart
- **Where:** `app/health/health-content.tsx` — `metaRecent`/`metaToday` still reads exclusively from `cachedFetch('body-metadata', …)`.
- **Fix:** Add a Dexie fast-path reading `LocalBodyMetric[]` and seeding the weight chart state synchronously before the `cachedFetch` result arrives (same pattern as sleep sessions in session 124 Task 9).

### LS-3 · **Medium** · Mood log `onSaved` returns synthetic record with `id='local-pending'`
- **Where:** `components/mood-checkin-sheet.tsx` and `components/workout/warmup-screen.tsx`
- **Problem:** The `onSaved` callback now returns a locally-constructed `MoodLog`-shaped object. Any caller that uses the returned `id` for server-side operations (edit/delete) will fail until the record syncs and the real ID is known.
- **Action:** Audit `onSaved` callers; if any use `id`, add a "pending" guard or defer the ID-dependent operation until after sync confirmation.

### LS-4 · **Low** · Manual full-resync button in settings
- **Fix:** Add a "Sync now" button in Profile > About that resets `lastSyncAt` to epoch and calls `pullDelta()`. Useful after edge-case data staleness.

### LS-5 · **Low** · Unify two outbox systems
- **Problem:** Workout data uses `lib/sqlite/outbox.ts` (Capacitor SQLite); health data uses Dexie `mutationsOutbox`. Both drained in `SyncProvider` but separate systems.
- **Action:** After APK SQLite parity (`SQLiteLocalStore` implementing `LocalStore`) is implemented, unify into a single outbox backed by `LocalStore`.

### LS-6 · **Low** · Nutrition food logs — local-first
- **Note:** Complex FK (`food_items`, `meal_types`). Deferred until the body/mood pattern is proven on device.

---

## Section 8 — Component Breakup / Technical Debt

These are internal refactors with no user-visible behaviour change. Each is its own small task.

| # | Task | File (lines) | Priority | Notes |
|---|------|-------------|----------|-------|
| CB-1 | Split `adapter.ts` by domain | `lib/data/postgres/adapter.ts` (2407) | High | Per-domain modules under `lib/data/postgres/`; single `WorkoutRepository` facade delegates. Start with Nutrition + Social slices. |
| CB-2 | Split `config-screen.tsx` | `components/config/config-screen.tsx` (1639) | High | Extract `ProgramEditorSheet`, `StyleEditorSheet`, `PhaseSetsSection`, `ProgramListCard`, hooks `useStyleEditor`/`useProgramEditor`. |
| CB-3 | Split `session-select-content.tsx` | `app/session-select/session-select-content.tsx` (1602) | High | Each dashboard widget card becomes its own component under `app/session-select/components/`. Hooks for localStorage loaders and drag/hide/persist. |
| CB-4 | Split `health-content.tsx` | `app/health/health-content.tsx` (1342) | High | Per-card components under `app/health/components/`; calc hooks (`useWeightTrend`, `useBmiClassification`, `useEnergyBalance`) extracted + memoized. |
| CB-5 | Split `builder-wizard.tsx` | `components/workout-builder/builder-wizard.tsx` (777) | Med | Per-step components under `components/workout-builder/steps/`. |
| CB-6 | Split `profile-tab.tsx` | `components/more/profile-tab.tsx` (775) | Med | Per-section components; the sign-out cache-wipe (C-DD-1) lands here too. |
| CB-7 | Split `chat.tsx` | `components/chat.tsx` (802) | Low | Extract `getSessionSuggestions` and weight-dial sub-UI. |

---

## Section 9 — Future Features (unplanned, no spec yet)

These are ideas / product gaps that don't have a plan document yet. All need design/spec before implementation.

| # | Feature | Context |
|---|---------|---------|
| F-1 | **Exercises ID-referenced (not name-keyed)** | Session 120 architectural note. Add `exercise_id uuid` FK to `session_exercises`, `exercise_logs`, `personal_records`, `exercise_gif_cache`; backfill from `exercise_library`. Removes cascading rename complexity entirely. **Large refactor — needs dedicated plan.** |
| F-2 | **Push notifications (web/background)** | No service worker yet. `@capacitor/local-notifications` covers in-app alerts. PWA background push requires service worker + server push infra. |
| F-3 | **Workout reminder notifications** | Meal reminders (session 102) provide the pattern. Add `workout_schedule_days.reminder_enabled` + `reminder_time`; reconcile on SyncProvider mount + resume. |
| F-4 | **Voice logging** | Capture reps/weight via dictation. Needs Gemini STT or Web Speech API integration. |
| F-5 | **ShareMilestoneCard** | OS share sheet for achievement/PR milestones. Deferred from session 68. |
| F-6 | **Body-fat-aware goal recommendations** | `calculateBaseline` uses total bodyweight Mifflin-St Jeor. If body fat % available, add Katch-McArdle cross-check and protein dosing per kg lean mass. |
| F-7 | **Calendar training load legend for 4+ sessions** | Abbreviations or collapsible legend. |
| F-8 | **Per-exercise equipment selection in program editor** | Manual builder doesn't let you pick Dumbbell RDL vs Barbell RDL. |
| F-9 | **Custom GIFs for dataset-absent exercises** | Ab Wheel, Face Pull, Pec Deck, Hip Flexor Raise have no GIFs. |
| F-10 | **Mobile token pruning** | U21 — implement token cleanup on expired token detection. |
| F-11 | **`weekly` schedule branch verification** | Goals card Workouts target for weekly-schedule programs not end-to-end verified (session 122 follow-up). |
| F-12 | **Denormalized lifetime counters for achievements** | Prerequisite for P-AUDIT-2 durable fix and for making `/api/achievements` lightweight. Add `user_stats` table with running `total_volume`/`total_sets`/`total_sessions` updated inside `logExerciseAndSets`. |
| F-13 | **APK SQLite parity** | Implement `SQLiteLocalStore` using `lib/sqlite/` as a drop-in replacement for `DexieLocalStore` (same `LocalStore` interface). Prerequisite for LS-5 outbox unification. |

---

## Recommended execution order

### Sprint 1 — Security + Critical Correctness ✅ Done (2026-06-16, v1.42.1)
1. ✅ **S-DD-1** — Phase-set style IDOR (one ownership lookup)
2. ✅ **S-DD-2** — Food-log meal-type/food-item IDOR (batched lookup)
3. ✅ **C-DD-1** — Sign-out cache wipe (`clearAllCache` helper + profile-tab wiring)
4. ✅ **L-DD-1** — `workout-entry` high-rep 1RM guard (import shared `calc1RM`)
5. ✅ **S-DD-3** — Unbounded array caps (6 routes, all Zod `.max()`)
6. ✅ **S-DD-4** — Validation gaps on profile/nutrition writes
7. ✅ **S-DD-5** — Rate limits: barcode, nutrition/scan, mood
8. ✅ **S-DD-6** — `nutrition/scan` image-size uses correct `'base64'` byte basis

### Sprint 2 — Caching correctness ✅ Done (2026-06-16, v1.42.2)
8. ✅ **C-DD-4** — Add `workout-templates` to `invalidateProgramStructure()` (one line)
9. ✅ **C-DD-2** — Admin exercise edits invalidate `exercise-library` (three lines)
10. ✅ **C-DD-3** — AI builder save uses full `invalidateProgramStructure()` (four lines)
11. ✅ **C-DD-5** — Meal-type edits invalidate `nutrition-meal-types`
12. ✅ **C-DD-6** — `overview-screen` body-log invalidates body-metadata + readiness
13. ✅ **C-DD-7** — Activity-type admin edits invalidate `activity-types`

### Sprint 3 — Performance wins ✅ Done (2026-06-16, v1.42.3)
14. ✅ **P-DD-1** — Activity store shallow selector (highest-value mobile perf fix)
15. ✅ **P-DD-2** — Lazy-load chart.js via `next/dynamic` (C1/C2/C5 — do as one PR)
16. ✅ **N-DD-1** — `haptics.ts` dynamic import (web bundle fix)
17. ✅ **N-DD-2** — `barcode-scanner.tsx` dynamic import
18. ✅ **P-AUDIT-2** — Remove mid-workout achievements fetches (minimal fix; durable fix = F-12 prerequisite)

### Sprint 4 — Native / Health Connect
19. **N-DD-3** — `TotalCaloriesBurned` permission (calories-burned sync)
20. **N-DD-4** — HRV key fix (`Rmssd`) — on-device verification
21. **N-DD-5** — Rest-timer resume reconciliation (or document as fire-and-forget)
22. **N-DD-6** — Extract rest-timer as pure testable function
23. **N-DD-7** — `HC_READ_TYPES` constant + parity test

### Sprint 5 — UI polish
24. **U-DD-5** — `prefers-reduced-motion` global block in globals.css
25. **U-DD-4** — Chart theme colours via CSS vars
26. **U-DD-1** — Radix `<Sheet>` migration for 4 nutrition sheets (one at a time)
27. **U-DD-2** — Shared `<Button>` for 11 nutrition primary buttons
28. **U-DD-3** — Fetch-error toast helper
29. **U-DD-6** — WeeklyNutritionChart toggle touch targets
30. **U-DD-7** — Section header semantics `<h3>`
31. **U-MISC-1** — Dedupe `weeklyTarget` formula in session-select

### Sprint 6 — Local-first sync validation + follow-ups
32. **LS-1** — On-device Dexie test
33. **LS-2** — Body metrics fast-path for weight chart
34. **LS-3** — Mood log `onSaved` caller audit
35. **L-DD-2** — Offline 1RM reps>30 guard

### Sprint 7 — Technical debt (component breakup, do piecemeal)
36. **CB-4** — Split `health-content.tsx` (pair with PER-5 memoization)
37. **CB-3** — Split `session-select-content.tsx`
38. **CB-2** — Split `config-screen.tsx`
39. **CB-1** — Split `adapter.ts` (start with Nutrition + Social domains)
40. **CB-5/6/7** — Builder, profile-tab, chat (medium priority)

### Backlog — Future features (need specs first)
- **F-1** (exercise ID refactor), **F-12** (denormalized counters), **F-13** (APK SQLite parity), then F-2 through F-11 per product priority.

---

## Gap analysis — items not in any prior plan

The following issues were identified that have no existing plan document:

| # | Gap | Where |
|---|-----|-------|
| G-1 | **`updatePhase` `styles` IDOR** (S-DD-1) — never in any prior plan; found in deepdive only | deepdive-security Task 1 |
| G-2 | **Food-log cross-tenant IDOR** (S-DD-2) — never in any prior plan | deepdive-security Task 2 |
| G-3 | **Sign-out cache wipe** (C-DD-1) — 1.15.0 cleared *some* cache but not the SQLite layer or Dexie | deepdive-caching Task 1 |
| G-4 | **`invalidateProgramStructure()` missing `workout-templates`** (C-DD-4) — not in original cache plan | deepdive-caching Task 6 |
| G-5 | **`exercise-history` N+1 per workout** (C-SESSION-2) — first called out in session 125 notes | session 125 remaining gaps |
| G-6 | **Body metrics fast-path for weight chart** (LS-2) — identified but deferred in session 124 | session 124 known gaps |
| G-7 | **`workout-entry` high-rep 1RM guard** (L-DD-1) — found only in deepdive; not in audit logic plan | deepdive-logic Task 1 |
| G-8 | **`TotalCaloriesBurned` permission** (N-DD-3) — new finding in deepdive; never in prior plans | deepdive-native Task 4 |
| G-9 | **Denormalized lifetime counters** (F-12) — prerequisite for P-AUDIT-2 durable fix; no plan yet | P-AUDIT-2 notes |
| G-10 | **`weekly` schedule branch for Goals card** (F-11) — noted in session 122 but no follow-up plan | session 122 remaining gap |
