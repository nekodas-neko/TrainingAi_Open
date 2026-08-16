> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Consolidated Remaining Sprints — 2026-06-17

> **Purpose:** Single source of truth for all work remaining after session 128 (v1.42.4). Merges
> outstanding items from `2026-06-12-uplift-batched-execution-plan.md` and
> `2026-06-16-implementation-tasks-master-review.md` into themed sprints ordered by **testability**.
>
> **Testability key:**
> - 🟢 **FULLY LOCAL** — testable end-to-end against local dev DB + dev server, shippable immediately
> - 🟡 **CODE LOCAL / VERIFY ON DEVICE** — code and TypeScript can be verified in sandbox; full functional test requires S25 Ultra
> - 🔴 **DEVICE ONLY** — cannot meaningfully test without physical device; write last
>
> **Authoritative detailed steps** for items marked "(uplift: X.Y)" live in
> `2026-06-12-uplift-batched-execution-plan.md`. Items marked "(MR: X-DD-Y)" are described in full
> in `2026-06-16-implementation-tasks-master-review.md`. Follow those documents for step-by-step
> implementation; this plan provides the execution roadmap and grouping.
>
> **Separate standalone plans** (not absorbed here):
> - `2026-06-17-per-session-phase-tracking.md` — execute first (Phase Tracking sprint)
> - `2026-06-08-nav-restructure-friends-system.md` — large deferred feature (Nav + Friends sprint)

---

## Active Plan Status

| Plan | Status |
|------|--------|
| `2026-06-17-per-session-phase-tracking.md` | ⏸️ PENDING — execute next |
| `2026-06-12-uplift-batched-execution-plan.md` | ⏸️ PENDING — all 21 tasks |
| `2026-06-08-nav-restructure-friends-system.md` | ⏸️ PENDING — large feature |
| `2026-06-16-implementation-tasks-master-review.md` | ⏳ Sprints 1-3 ✅; Sprints 4-7 pending |
| All May–June 11 plans + security/goals/health plans | ✅ COMPLETED |

---

# 🟢 TIER 1 — Fully Local (Ship First)

All items below can be coded, TypeScript-checked, and end-to-end tested against the local dev DB
(`DATABASE_URL` pointing at `trainingai_dev` on port 5433) with `pnpm dev`. No physical device required.

---

## Sprint 1 — Per-Session Phase Tracking 🟢

**Source:** `2026-06-17-per-session-phase-tracking.md` — fully detailed, follow that document.

**Why first:** Fixes a fundamental correctness bug where repeated sessions advance the wrong program.
All phase-engine callers change, so later sprints that touch API routes will be simpler to diff.

| # | Task | Files |
|---|------|-------|
| 0 | Cache bug — `completeWorkout` only clears `workout-data:meta`, not session-specific keys | `workout-screen.tsx` |
| 1 | DB: add `countAllSessionsSinceStart` (single `GROUP BY session_name` query) | `repository.ts`, `adapter.ts` |
| 2 | `workout-data` route — session path: per-session count + `sessionsPerCycle=1` | `app/api/workout-data/route.ts` |
| 3 | `workout-data` route — meta path: `perSessionPhaseStatus[]` array + leader phase | `app/api/workout-data/route.ts` |
| 4 | `log-exercise` route — per-session count for phase resolution | `app/api/log-exercise/route.ts` |
| 5 | `sync-workout` route — per-session count map, increment per new session row | `app/api/sync-workout/route.ts` |
| 6 | UI home card — look up today's session phase from `perSessionPhaseStatus` | `workout-select-content.tsx` |
| 7 | UI session-select — per-session phase badge per card; leader phase in progress card | `session-select-content.tsx` |
| 8 | Done screen — phase completion banner when session advances phase | `workout-screen.tsx`, `done-screen.tsx` |
| 9 | E2E verification (Push/Pull/Legs baseline scenario) + regression check | local dev server |

---

## Sprint 2 — Cache + Logic Correctness 🟢

**Source mix:** Uplift batched plan Batches 3–4 (items 3.3, 3.4, 4.1, 4.2) + master review (L-DD-2, L-DD-3, C-DD-8, C-SESSION-2).

All items are DB + API + frontend changes fully exercisable via local Postgres and `pnpm dev`.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | uplift 3.4 | **High** | Fix mood log date-format mismatch (`YYYY/MM/DD` → `YYYY-MM-DD`) + invalidate `mood:` cache on save. **This is a silent data bug** — mood logs never load from cache because the date format doesn't match what's stored. | `session-select-content.tsx`, `warmup-screen.tsx`, `mood-checkin-sheet.tsx` |
| 2 | uplift 4.2 | Medium | Fix cross-month streak data gap (streak resets to 0 on month boundary) + align workout streak definition with achievements (1 rest-day tolerance) | `repository.ts`, `adapter.ts`, new `/api/streak-data/route.ts`, `session-select-content.tsx`, `achievements/route.ts` |
| 3 | uplift 3.3 | Medium | Cache 4 bare `fetch()` calls in `health-content.tsx` — training-load, sleep-correlation, weekly-stats, workout-data:meta | `app/health/health-content.tsx:261-276` |
| 4 | uplift 4.1 | Medium | Clear `ta_wc_*` sessionStorage keys when program config is saved (stale session cards after edit) | `lib/utils.ts`, `config-screen.tsx` |
| 5 | MR: C-DD-8 | Low | `stats-content.tsx` bare fetches → `cachedFetch`; add visible error/retry state | `app/stats/stats-content.tsx:54,73,98` |
| 6 | MR: C-SESSION-2 | Low | `exercise-history` N+1 uncached fetches → `cachedFetch('exercise-history:${name}', TTL_MEDIUM)` | active workout screen |
| 7 | MR: L-DD-2 | Low | Offline 1RM `reps > 30` guard missing in workout-screen snapshot | `workout-screen.tsx:438` |
| 8 | MR: L-DD-3 | Trivial | Drop redundant `.replace(/-/g, "/")` on already-slash date string | `stats/weekly-stats-hub.tsx:27` |

> **Test item 1 locally:** Log in as `test@local.dev`, open session-select → tap mood check-in → save.
> Reload page — mood card should stay "logged" (previously always reverted due to `YYYY/MM/DD` mismatch).
> Verify `GET /api/mood?date=2026-06-17` (dash format) returns the saved object.

---

## Sprint 3 — UI Polish (Visual + Quick Wins) 🟢

**Source mix:** Uplift batched plan Batch 1–2 (items 1.1–1.4, 1.10–1.11, 2.1–2.2) + master review sprint 5 lighter items.

All are frontend-only. No DB or API changes. Every item verifiable in `pnpm dev` browser.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | uplift 1.10 | Med | Add `pt-safe` to chat header (content sits flush against Android status bar) | `components/chat.tsx:501` |
| 2 | uplift 1.11 | Med | Add back-navigation header to activity pre-screen (no way to exit before starting) | `components/activity/pre-activity-screen.tsx` |
| 3 | uplift 2.1 | Med | `--card-tint-pct` CSS var + `accentCardStyle` light-mode fix (cards nearly invisible in light mode) | `lib/utils.ts:53`, `app/globals.css` |
| 4 | uplift 2.2 | Med | Health info-button `aria-label` + touch target `p-2` → `p-2.5` (4 buttons) | `app/health/health-content.tsx:589,732,765,792` |
| 5 | MR: U-DD-5 | Low | `prefers-reduced-motion` global block in globals.css — zero out meteor + ta-marquee keyframes | `app/globals.css` |
| 6 | MR: U-DD-4 | Low | Chart.js ticks/gridlines use CSS vars (`var(--muted-foreground)`, `var(--border)`) not hardcoded hex | `chart-message.tsx`, `weekly-nutrition-chart.tsx` |
| 7 | uplift 1.4 | Low | Weather-chip loading skeleton (`h-[26px] w-14 rounded-full bg-muted/60 animate-pulse`) | `components/weather-chip.tsx` |
| 8 | uplift 1.3 | Low | Standardize activity done-screen stat tiles: `bg-muted` → `bg-muted/60 border border-border` | `done-activity-screen.tsx:78,83,89,100,104,119` |
| 9 | MR: U-DD-6 | Low | WeeklyNutritionChart metric toggle buttons: `min-h-[40px] py-2 text-xs` (sub-44dp tap targets) | `weekly-nutrition-chart.tsx:96-106` |
| 10 | MR: U-DD-7 | Trivial | Replace `<p>`/`<div>` section titles with `<h3>` (2 locations) | `strength-progress-card.tsx:41,46`, `weekly-nutrition-chart.tsx:93` |
| 11 | MR: U-MISC-1 | Trivial | Dedupe `weeklyTarget` formula — import `getScheduledSessionsPerWeek` from `lib/schedule-utils` | `session-select-content.tsx:570-574` |
| 12 | uplift 1.1 | Low | Delete dead `app/history/history-content.tsx` (known issue H4) | `app/history/` |
| 13 | uplift 1.2 | Low | Delete orphaned `components/nutrition/saved-meals-section.tsx` (not imported anywhere) | `components/nutrition/` |

---

## Sprint 4 — Performance + Infrastructure 🟢

**Source mix:** Uplift batched plan Batch 1–3 performance items + master review P-DD-3, P-DD-4.

GPS-related items (1.6, 2.3, 3.1) can be unit-tested locally and TypeScript-verified; real GPS
tracking only completes on device but that's a verification step, not a blocker for shipping.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | uplift 2.4 | Medium | Add `getDayExerciseNames(userId, date)` repo method — lighter than `getDayLog` for "done today" check | `repository.ts`, `adapter.ts`, `workout-data/route.ts:122-135` |
| 2 | MR: P-DD-3 | Medium | Gate per-login progression-style seeding behind a single `SELECT 1` check (currently N+1 per login) | `lib/data/postgres/adapter.ts:171-198,247-257,360-367` |
| 3 | uplift 2.3 | Medium | Incremental GPS distance (O(n²) → O(n)) — `appendPoint` accumulates last-two-points delta only | `lib/stores/activity-store.ts:99-108` |
| 4 | uplift 3.1 | Medium | Debounce activity-store `localStorage` writes to 2s (currently fires on every GPS point) | `lib/stores/activity-store.ts:140-145` |
| 5 | uplift 1.5 | Medium | Gate `useWeather` behind `enabled` param (currently fetches geolocation even when background is off) + dedup in-flight fetches | `lib/weather/use-weather.ts`, `dynamic-background.tsx:45-56` |
| 6 | uplift 1.6 | Medium | Throttle Leaflet route map re-renders to 2s interval + add offline fallback message | `components/activity/activity-route-map.tsx` |
| 7 | MR: P-DD-4 | Low | `useMemo` for BMI, BF%, weight-trend regression, energy-balance in health-content (computed inline every render) | `app/health/health-content.tsx:392-436` |

---

## Sprint 5 — Security Cleanup 🟢

**Source mix:** Uplift batched plan items 1.8, 3.2 + master review S-DD-7. All testable via local curl/API calls.

> **Note on uplift 1.9 (rate-limit `/api/friends` POST):** This route is created in Sprint 9
> (Nav + Friends). Add the rate-limit at that point rather than creating the file twice.
> **Note on uplift 1.7 (lazy-load ExerciseStatsSheet):** The master review confirms the pattern is
> already correct at `pre-workout-screen.tsx:13`. Verify with `grep -n 'ExerciseStatsSheet' components/workout/pre-workout-screen.tsx` — if it's already a `dynamic()` import, skip this item.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | uplift 3.2 | **High** | Fix write-IDOR in `POST /api/sync-workout` — ownership check before upserting `workout_sessions`/`exercise_logs`/`set_logs`. Add `getWorkoutSessionOwners`/`getExerciseLogOwners` repo methods. | `repository.ts`, `adapter.ts`, `sync-workout/route.ts` |
| 2 | uplift 1.8 | Medium | Timing-safe Health Connect ingest secret comparison (`crypto.timingSafeEqual`) | `app/api/health-connect/ingest/route.ts` |
| 3 | MR: S-DD-7 | Low | Repository-pattern bypass — 6 routes call `new PostgresWorkoutRepository(...)` instead of `getRepository()`. Move queries into repo methods. | `workout-entry/route.ts`, `exercise-gif/route.ts`, `friends/feed`, `friends/leaderboard`, `admin/exercises`, `program-week/route.ts` |

---

## Sprint 6 — UI Accessibility (Heavier) 🟢

**Source:** Master review sprint 5 heavier items. All frontend, testable in browser.
Do sheets one at a time to minimise regression risk.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | MR: U-DD-1 | Medium | Migrate 4 hand-rolled nutrition sheets to Radix `<Sheet side="bottom">` + focus-trap + back-dismiss. Do one at a time: `food-logger-sheet.tsx`, `food-library-sheet.tsx`, `quick-edit-log-sheet.tsx`, `ai/chat-overlay.tsx` | 4 component files |
| 2 | MR: U-DD-2 | Medium | Replace 11 hand-rolled `<button className="rounded-xl bg-foreground ...">` in nutrition with `<Button>` (consistent focus ring + disabled state) | `components/nutrition/*` |
| 3 | MR: U-DD-3 | Medium | Create `lib/ui/fetch-with-toast.ts` wrapper; replace silent `catch(() => {})` on user-initiated write paths with `toast.error(...)` | `health-content.tsx`, `nutrition-content.tsx`, food/meal sheets |

---

## Sprint 7 — Sync Code Work (Local-Codable) 🟢

**Source:** Master review section 7. LS-2 through LS-4 and the two native test items can be coded
and verified against local IndexedDB in DevTools — no physical device required.

| # | ID | Priority | Description | Files |
|---|-----|---------|-------------|-------|
| 1 | MR: LS-3 | Medium | Audit `onSaved` callers where `id='local-pending'` is returned — add guards before any ID-dependent server operation | `mood-checkin-sheet.tsx`, `warmup-screen.tsx` |
| 2 | MR: LS-2 | Medium | Body metrics Dexie fast-path — seed `metaRecent` from `LocalBodyMetric[]` synchronously before `cachedFetch` arrives (matches sleep session pattern from session 124) | `app/health/health-content.tsx` |
| 3 | MR: LS-4 | Low | "Sync now" button in Profile > About — resets `lastSyncAt` to epoch + calls `pullDelta()` | `components/more/profile-tab.tsx` |
| 4 | MR: N-DD-6 | Low | Extract `computeRestNotificationAction(phase, restStartMs, restSec, now)` as a pure function into `lib/notifications.ts` + Vitest unit tests. Zero Capacitor dependency — fully sandbox-testable. | `lib/notifications.ts` (new), `workout-screen.tsx:260-271` |
| 5 | MR: N-DD-7 | Low | Export `HC_READ_TYPES` constant + Vitest parity test asserting the `requestPermissions` array, `canRead.has(...)` keys, and `readRecords` types all use the same set. Catches future HRV/calories mismatches at CI time. | `lib/health-connect-sync.ts`, new test file |

---

## Sprint 8 — Component Breakup (Technical Debt) 🟢

**Source:** Master review section 8. Internal refactors; no user-visible behaviour change.
Do piecemeal — each is a separate commit and branch. Pull-request each slice for easy review.

| # | ID | Lines | Priority | Description |
|---|-----|-------|---------|-------------|
| 1 | MR: CB-4 | 1342 | High | Split `app/health/health-content.tsx` → per-card components under `app/health/components/` + calc hooks (`useWeightTrend`, `useBmiClassification`, `useEnergyBalance`). Pairs with Sprint 4 P-DD-4 memoization. |
| 2 | MR: CB-3 | 1602 | High | Split `app/session-select/session-select-content.tsx` → each dashboard widget card becomes its own component. |
| 3 | MR: CB-2 | 1639 | High | Split `components/config/config-screen.tsx` → `ProgramEditorSheet`, `StyleEditorSheet`, `PhaseSetsSection`, `ProgramListCard`, hooks `useStyleEditor`/`useProgramEditor`. |
| 4 | MR: CB-1 | 2407 | High | Split `lib/data/postgres/adapter.ts` → per-domain modules under `lib/data/postgres/`. Start with Nutrition + Social slices. |
| 5 | MR: CB-5 | 777 | Med | Split `components/workout-builder/builder-wizard.tsx` → per-step components under `components/workout-builder/steps/`. |
| 6 | MR: CB-6 | 775 | Med | Split `components/more/profile-tab.tsx` → per-section components. |
| 7 | MR: CB-7 | 802 | Low | Split `components/chat.tsx` → extract `getSessionSuggestions` and weight-dial sub-UI. |

---

## Sprint 9 — Nav Restructure + Friends (Large Feature) 🟢

**Source:** `2026-06-08-nav-restructure-friends-system.md` — fully detailed, follow that document.

**Estimate:** 2–3 sessions. Execute when there are no active bug firefights.
**All testable locally** — DB migration (`055_friends_and_titles.sql`) runs against local dev DB;
all new routes and UI testable with `test@local.dev`.

**Don't forget:** After creating `app/api/friends/route.ts` in Task 5 of that plan, add the
rate-limit from Sprint 5 item 3 (uplift 1.9: `rateLimit('friend-request:${userId}', 10, 15min)`)
in the same commit.

**What it delivers:**
- New nav: Home / Nutrition / Workout / Health / More (5 distinct tabs)
- `/nutrition` standalone page (extracted from Health tab)
- `/workout` route (session-select moved here; `/session-select` redirects)
- `/more` page with Profile / Achievements / Friends / Config tabs
- Friend system: send requests by email/friend-code, activity feed, leaderboard
- Achievement tier borders (bronze/silver/gold), trophy case (3 pinnable slots), equippable titles
- Season badges in profile

---

# 🟡 TIER 2 — Code Locally, Verify on Device

Items in this tier can be written, TypeScript-checked, and linted in the sandbox. However,
full functional verification requires the Samsung Galaxy S25 Ultra (Capacitor native plugin APIs
or Health Connect sync cannot be exercised in a browser).

**Approach:** Write and push the code changes via local dev. Schedule a dedicated on-device
testing session after each sprint to confirm the native behaviour works.

---

## Sprint 10 — Native / Health Connect (Code Locally) 🟡

**Source:** Master review section 5.

N-DD-6 and N-DD-7 were moved to Sprint 7 (fully local). The three items below all need the device
to confirm the Health Connect integration actually passes/receives the right data.

| # | ID | Priority | Code change | What needs device |
|---|-----|---------|-------------|-------------------|
| 1 | MR: N-DD-3 | Medium | Add `'TotalCaloriesBurned'` to the `requestPermissions` read array + gate each `aggregateRecords` call behind `canRead.has('TotalCaloriesBurned')` | Confirm calories-burned actually populates from HC after sync |
| 2 | MR: N-DD-4 | Medium | Change `'HeartRateVariabilitySdnn'` → `'HeartRateVariabilityRmssd'` in permissions array, `canRead.has(...)`, and `readRecords({type:...})` — 3 line changes | Confirm HRV reads and lands in body-metadata |
| 3 | MR: N-DD-5 | Medium | Add `App.addListener('resume', handler)` in `workout-screen.tsx` that re-derives `remainingMs` from `store.restStartMs` and reschedules/cancels the rest-timer notification | Confirm rest-timer reconciles correctly after app is suspended mid-rest |

> **Files for all three:** `lib/health-connect-sync.ts` (N-DD-3, N-DD-4), `components/workout-screen.tsx:260-271` (N-DD-5).

---

# 🔴 TIER 3 — Device-First (Write After Device Testing Session)

These items cannot be meaningfully started without a device in hand, or depend on on-device
results to know what code to write.

---

## Sprint 11 — Local-First Sync On-Device Validation 🔴

| # | ID | Priority | Description |
|---|-----|---------|-------------|
| 1 | MR: LS-1 | **High** | Install latest build on S25 Ultra. Open Chrome DevTools → Application → IndexedDB → confirm `trainingai-local-db` exists and `bodyMetrics`/`moodLogs` tables populate. Log a body weight → confirm Dexie write appears immediately → confirm sync push sends it to Railway within the sync window. |
| 2 | MR: LS-5 | Low | Unify the two outbox systems (Capacitor SQLite outbox + Dexie `mutationsOutbox`) into a single `LocalStore`-backed outbox. **Prerequisite:** LS-1 must pass and `SQLiteLocalStore` parity (F-13) must be implemented first. |
| 3 | MR: LS-6 | Low | Nutrition food-log local-first. Complex FK (`food_items`, `meal_types` must be in local store). Defer until body-metric and mood patterns are proven stable on device (LS-1 passed). |

---

## Future Features Backlog (no spec yet)

| # | ID | Tier | Feature | Notes |
|---|-----|------|---------|-------|
| 1 | F-12 | 🟢 | Denormalized `user_stats` lifetime counters | Prerequisite for making `/api/achievements` a single fast read; add `total_volume`/`total_sets`/`total_sessions` columns updated inside `logExerciseAndSets` |
| 2 | F-1 | 🟢 | Exercise ID FK (not name-keyed) | Large refactor — add `exercise_id uuid` FK to 4 tables, backfill, remove cascading rename complexity |
| 3 | F-13 | 🔴 | APK SQLite parity (`SQLiteLocalStore`) | Implements `LocalStore` interface using Capacitor SQLite; prerequisite for LS-5 |
| 4 | F-3 | 🟢 | Workout reminder notifications | Pattern from meal reminders; add `reminder_enabled`/`reminder_time` to `schedule_days` |
| 5 | F-11 | 🟢 | `weekly` schedule branch for Goals card verification | Workouts target not end-to-end verified (session 122 gap) |
| 6 | F-2 | 🟢 | Push notifications (web/background) | Needs service worker + server push infrastructure |
| 7 | F-4 | 🟢 | Voice logging (reps/weight via dictation) | Gemini STT or Web Speech API |
| 8 | F-5 | 🟢 | ShareMilestoneCard (OS share sheet for PRs/achievements) | Deferred from session 68 |
| 9 | F-6 | 🟢 | Body-fat-aware goal recommendations | Katch-McArdle cross-check when BF% available |
| 10 | F-8 | 🟢 | Per-exercise equipment selection in program editor | Dumbbell RDL vs Barbell RDL picker |
| 11 | F-9 | 🟢 | Custom GIFs for GIF-absent exercises | Ab Wheel, Face Pull, Pec Deck, Hip Flexor Raise |
| 12 | F-10 | 🟡 | Mobile token pruning | Cleanup on expired token detection |

---

## Summary

```
🟢 SHIP FIRST (local dev DB)
  Sprint 1  → Per-session phase tracking       (9 tasks, correctness bug fix)
  Sprint 2  → Cache + logic correctness         (8 items, silent bugs)
  Sprint 3  → UI polish quick wins              (13 items, no DB/API)
  Sprint 4  → Performance + infrastructure      (7 items)
  Sprint 5  → Security cleanup                  (3 items)
  Sprint 6  → UI accessibility — Radix sheets   (3 items, higher effort)
  Sprint 7  → Sync code work (local-codable)    (5 items incl. N-DD-6/7 tests)
  Sprint 8  → Component breakup                 (7 items, piecemeal)
  Sprint 9  → Nav restructure + friends         (20+ tasks, 2-3 sessions)

🟡 CODE NOW / DEVICE LATER
  Sprint 10 → Native/Health Connect code        (3 items: N-DD-3, N-DD-4, N-DD-5)

🔴 DEVICE SESSION REQUIRED
  Sprint 11 → Local-first on-device validation  (LS-1 test + LS-5/LS-6 when ready)
```
