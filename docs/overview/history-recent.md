# TrainingAI — Session History (recent: Sessions ~105–176)

> Historical session log, archived from `projectOverview.md`. Covers sessions ~105–176 plus older roadmap and version-history tables (including the relocated shipped-feature version log below).
> For current status, the live "What's Left To Do" list, and the document map, see `projectOverview.md`.

---

## Version-history table (relocated from projectOverview.md, session 210)

> Moved here during the 2026-07-05 documentation cleanup to keep the index lean. This is the shipped-feature version log for sessions ~129–175.

### What was shipped (sessions 129–168, v1.42.1 → v1.69.0)

| Version | Feature |
|---------|---------|
| v1.75.0 | ✅ Session 175 — **End of Day review (#83).** Replaces the end-of-night `MealBackfillSheet` with a full wrap-up sheet: day summary + Body Battery, per-meal food backfill (reuses the offline `logFoodEntries`), pre-filled 1–5 wellness scales (physical tiredness / mental drain / movement / hydration / late-heavy-meal), a sore-muscle picker, and a free-text journal. New **offline-first `day_checkins` domain** end-to-end: Postgres table (migration `102`) + Drizzle schema, `getDayCheckin`/`saveDayCheckin`, sync push branch + `/api/sync/push` domain, `getSyncDelta`/`applyDelta`, **local SQLite v12** table + store methods + outbox, `GET/POST /api/day-checkin`. Every structured field is a segmented scale that opens **pre-filled** from existing signals (`prefillEveningScales`); journal is the only free text; deterministic `buildTodayInsight` card (no AI call). Components under `components/nutrition/end-of-day/`. tsc/lint clean, 372 tests (+ TDD pre-fill/insight tests), CI green. ⚠️ Offline write/persist pending on-device spot-check. |
| v1.74.5 | ✅ Session 175 — **Resilient on-device SQLite open + complete schema mirror (#85).** A partially-applied version upgrade (`ADD COLUMN` isn't idempotent → "duplicate column" on retry → whole upgrade rolls back) made `open()` throw and left the **entire** local store dead, so every local read (food/activity/sleep/mood) returned empty — the deepest cause of "data vanished on reload". `lib/sqlite/sqlite-service.ts` now wraps the versioned open: on failure it closes the half-open handle and reopens at **version 1** (capacitor-sqlite never downgrades, so no re-run of the broken upgrade), then the idempotent `reconcileSchema()` brings the schema current. `reconcileSchema` was extended to a **complete mirror** of the persistent schema — audited migrations v1–v11 and added the 17 earlier tables (`workout_sessions`, `exercise_logs`, `set_logs`, `sync_outbox`, `sync_meta`, `api_cache`, `body_metrics`, `mood_logs`, `sleep_sessions`, `activity_logs`, `local_programs`, `local_progression_styles`, `mutations_outbox`, `food_logs`, `supplements`, `supplement_logs`, `injuries`) + 4 earlier columns (`set_logs.rpe`, `activity_logs.steps/avg_hr/max_hr`) the reconcile lists were missing — so a reopen-at-v1 can restore whatever any partial upgrade dropped, not just the most recent tables. 366 tests, CI green. Native path; verified at logic/test level. |
| v1.74.4 | ✅ Session 175 — **Food no longer vanishes on reload (#84).** After the offline-first migration (#82) the Nutrition page read food **local-store-only**, so any on-device DB hiccup blanked the list even though the data was saved. `loadFoodLogs` (`app/nutrition/nutrition-content.tsx`) now renders the local copy instantly for offline-first speed, then **always fetches and renders the authoritative server copy when online** (hydrating the local store for next-time offline), and falls back to the server copy if the local read/hydrate throws — a local-store error can never blank the list again. ✅ Device-confirmed persisting. |
| v1.73.1 | ✅ Session 173 — **Treadmill GPS + activity-save fixes (#74).** (1) Treadmill was GPS-tracked because its `is_distance_based` flag had drifted to `true` in prod (migration 094's `ON CONFLICT DO NOTHING` never corrects an existing row); migration `101` forces it `false` → timer-only with manual distance. (2) Native APK activity save silently lost the entry on a same-minute `(user_id, date, start_time)` collision (Samsung Health/Health Connect or Oura) — the `pushMutations` insert used an id-only conflict target and threw, stranding the outbox mutation while the local write "succeeded". Fixed by targeting the partial unique index (`targetWhere`) when a start_time is present, matching the graceful web path (`saveActivityLog`). Reproduced + verified vs local DB; 331 tests, CI green. ⚠️ Native path not exercisable in-sandbox. |
| v1.71.4 | ✅ Session 171 — **AI periodization counts self-heal (#56).** `sessions_in_phase` is a stored counter (incremented on complete-workout, decremented only via the app delete flow), so directly inserted/deleted test sessions left it stale. New `reconcileSessionsInPhase(userId, programId)` (`slices/periodization.ts`) recomputes each session's count from actual non-empty `workout_sessions` with `started_at >= phase_started_at`, only writing rows that drift; `program-overview` route calls it before reading states. Verified on the dev DB (99→3, 50→1, phase-window respected). |
| v1.71.3 | ✅ Session 171 — **Oura sleep latency fix (#55).** The v2 sleep model field is `latency` (seconds); the type, sync route, and webhook all read a non-existent `onset_latency`, so `sleep_sessions.onset_latency_sec` was always NULL → the timeline "Fell asleep" event (and all latency consumers) showed nothing. Renamed to `latency` in `lib/oura/types.ts` + both readers; the sleep upsert COALESCEs the column so a re-sync backfills existing rows. Corrected CLAUDE.md + `docs/oura-ring-data-reference.md`. Confirmed against the bundled Oura OpenAPI (`PublicModifiedSleepModel` has `latency`, no `onset_latency`). |
| v1.71.2 | ✅ Session 171 — **Saved activities on the timeline (#54).** The day-timeline sourced walks only from `getOuraWorkouts`, so a saved `activity_log` never appeared. Now fetches `listActivityLogs(userId, yesterday, date)` and renders them (start–end, distance, rounded duration, calories), deduping any Oura walk that overlaps a saved log. Robust `HH:MM:SS`→`HH:MM` time parsing (the bug that first dropped the event). `WalkCard` shows a non-walk/run activity's own title. Also rounds the day-sheet activity duration (`health-content.tsx`). |
| v1.71.1 | ✅ Session 171 — **Timeline polish (#53).** "Yesterday" divider is now bold foreground + a rule line (was muted/indented, blended in). Workout events carry `endTime` → cards show a start–end range. Workout events include `exerciseNames`, listed on the home + full timeline cards. |
| v1.71.0 | ✅ Session 171 — **Activity/timeline/activity-tracking batch (#51).** (1) **Activity-score blend** — `lib/activity/blend-activity.ts` adds a bounded (≤14) training credit on top of Oura's activity score, scaled by today's logged volume vs. the user's median session, discounted by Oura's `training_volume` contributor; applied in `/api/readiness-score`; `+N` chip badge + breakdown on the Activity page. (2) **Timeline meals** use exact `loggedAt` in-window, else window end. (3) **Yesterday** workouts/walks/sleep on the timeline + a "Fell asleep · N min latency" event. (4) **Periodization** `sessions_in_phase` decrements on workout delete (phase-window guarded) + cache invalidation on the client delete path. (5a) **Auto-detect** thresholds centralised (`lib/activity/detection-thresholds.ts`) + tightened to Balanced (≥750 m / ≥2.5 km/h / ≥7 min); phone GPS path got its missing lower bounds. (5b) **Steps** from `daily_activity.steps` written to `body_metrics.steps`. (5c) **"Workout detected" card** moved Health → Home. No migration. tsc/lint clean, 264 tests (+7 new). ⚠️ Pending production check (blend constants, steps after real Oura sync, card on Home). |
| v1.70.1 | ✅ Session 169 — **Mood check-in sync hotfix (#47)** (device-confirmed). The mood mutation pushed via the local-first outbox omits `sleepQuality` (the check-in no longer collects it), and `adapter.pushMutations`'s mood branch passed that `undefined` into the NOT NULL `mood_logs.sleep_quality` column → insert rejected → mutation stranded in the on-device outbox → mood never persisted → daily check-in re-prompted on every app open. `/api/mood` already had the `?? 'ok'` default; the sync-push path was missed. Fixed by defaulting `sleepQuality ?? 'ok'` there (stranded mutations drain on next sync). Reproduced against local dev DB. Food "disappearing" investigated alongside — all server/client paths tested clean (push 200, persists); self-resolved on deploy, no food code change. |
| v1.70.0 | ✅ Session 169 — **Program structure in the SQLite pull delta (#45)** — closes the last device-deferred offline-first item. Server `getSyncDelta` (`lib/data/postgres/adapter.ts`) now returns 5 nested arrays (`programSessions`/`sessionExercises`/`schedules`/`scheduleDays`/`styleSets`), gated on a changed parent program/style so an unchanged window returns empty (respects `since`). `SyncDelta` (`lib/data/repository.ts`) + `lib/local-store/types.ts` extended. New **v9** local migration (`lib/sqlite/migrations.ts`) adds the 5 mirror tables + extra `local_programs` columns, all registered in `RECONCILE_TABLES`/`RECONCILE_COLUMNS` for self-heal; no FK constraints, no pragmas. `applyDelta` (`sqlite-backend.ts`) replaces a program's/style's children wholesale (delete-then-insert by parent id). New pure assembler `lib/local-store/program-assembler.ts` (7 unit tests) rebuilds the active program into `WorkoutExercise[]`; `workout-screen.tsx` seeds from `getActiveProgramLocal()` when no cache exists (network still overwrites). Fixed latent bug: `saveProgressionStyle` never bumped `updatedAt`, so set-only edits never surfaced in the delta. Read-only mirror — no outbox/push paths. ⚠️ Client half device-only; pending on-device verification. |
| v1.69.0 | ✅ Session 168 — **Backlog-clearing sweep (6 PRs).** Tech debt: `app/health/health-content.tsx` split — section renderers (~745 lines) extracted to `app/health/health-sections.tsx` (`getHealthSections(ctx)`), shell 1973→1196, no behaviour change (#34); food-logs POST ownership validation moved off a direct `getPool()` query behind a new `repo.foodLogRefsValid()` (#35). **AI periodization Tier 5:** deterministic accumulation ceiling — at 6 accumulation sessions an AI "stay" is overridden to recommend intensification (#37); deload floor — after 2 deload sessions, force a transition back to accumulation, with a "New program" action on the prescription card deep-linking to `/config?new=program` (#40); low-confidence prescriptions now list what's limiting confidence (few sessions, no mood/soreness, no 1RM history, program too new for ACWR, no sleep/HRV) and require a two-step confirm below 40% (#41). New pure helpers `lib/ai-periodization/phase-guards.ts` + `confidence.ts` with 13 unit tests. **Decisions:** 12.3-B `exercise_id` NOT NULL = won't-do; AI exercise-swap = dropped; program-structure-in-pull-delta = device-deferred. |
| v1.68.1 | ✅ Session 167 — **Home-screen & Health bug-fix sweep** (device-verified). Timeline wake-up now selects the primary night sleep (rows ≥3h, preferring the Oura row) so a 12-min nap can't show as "Woke up 9:14 PM / 0h 12m" (`app/api/day-timeline/route.ts`). Empty/abandoned/deleted workouts (0 logged exercises) filtered from the timeline **and** the HR-chart workout band (`/api/workout-sessions/day`). Activity durations rounded on display (`activity-history-card.tsx`, `activity-detail-sheet.tsx`). Missing `.pt-safe-or-4` CSS utility defined so the Sleep/Readiness/Activity/HR detail-page back buttons clear the status bar (`globals.css`). Daily check-in no longer re-prompts after save (a racing `/api/mood` null no longer clobbers the optimistically-cached mood) and "Rest day" persists via a date-stamped marker instead of being reverted by a `next-session` refetch (`session-select-content.tsx`). AI Periodization, Muscle Volume This Week, Weekly Volume vs Target, muscle-recovery heatmap + injuries now seed from cache for instant paint (`health-content.tsx`, `ai-periodization-status-card.tsx`, `ai-weekly-volume-card.tsx`). Health > Progress: both Sets and 1RM views show the best 1RM as the end label (`max(PR, latest est)`), with the bar showing the last working set (Sets) or current 1RM estimate (1RM) — `lib/health/strength-progress.ts`. PRs #33, #36, #38. |
| v1.68.0 | ✅ Session 166 — **Local-first finally operational on-device** + workout fixes. **Root cause found via on-device logs:** v4 migration's `PRAGMA journal_mode=WAL` ran inside the Capacitor SQLite plugin's upgrade transaction → SQLite "cannot change into wal mode from within a transaction" → the local DB never opened on Android, silently degrading the whole app to network-only. Fixed: WAL set post-open outside any transaction (#27); added `exercise_logs.muscle_groups` / `inter_exercise_rest_sec` and `set_logs.set_start_ms` / `set_end_ms` (v8 migration + `reconcileSchema` backstop) that local writes referenced but no migration created (#28). Also: month-end workout crash — `aestMidnight(y,m,d+1)` built invalid dates like `2026-06-31` on the last day of a month, 500ing `/api/workout-data` and `/api/progress-summary` (#23); deleting a workout now removes the empty session + invalidates timeline/HR/training caches (#26); home HR widget + Health Oura section now seed from cache for instant paint (#19, #25); CI skips root-level markdown (#20). `initSQLite` now logs the real open/upgrade error. |
| v1.67.0 | ✅ Session 166 — **Body Battery** energy widget on the home screen (below the Oura score chips). Garmin-style tank that opens at the morning readiness score and is integrated forward off the per-minute `oura_heartrate` series: recharges below ~5% HR reserve, drains in proportion to reserve when elevated, holds through data gaps. Colour-shifting progress bar (red→amber→green by level) with an expandable wake→now arc + charged/drained breakdown. Computed on read (no migration), cached 5 min, mount fetch + pull-sync refresh. `app/api/body-battery/route.ts`, `components/body-battery-card.tsx`. Tested live against the local dev DB. |
| v1.66.0 | ✅ Session 165 — Health detail page visual overhaul. Sleep, Readiness, and Activity detail pages now use `DetailHero` with themed SVG backgrounds (night sky + crescent moon / sunrise blue sky + clouds / dusk mountain silhouette). Score arcs rendered inside the hero with a dark gradient overlay for readability. 14-day `TrendSparkline` added to all four detail pages (Sleep, Readiness, Activity, Heart Rate). Back navigation fixed: `Link href="/health"` instead of `router.back()`. React hydration mismatch fixed: cache reads moved out of `useState` lazy initializers into `useEffect`. Stress/Recovery display on Activity page corrected from seconds to minutes (`/ 60`). AI insight 429 errors silenced in console; rate limit now gates only actual AI calls (cache reads don't count against quota). |
| v1.65.1 | ✅ Session 165 — Stability hotfix marathon after the local-first expansion (PR #11). **Two production outages resolved:** (1) DB connection crash-loop — added a `pg` pool `error` handler (a missing handler turned a DB blip into an `unhandledRejection` process crash-loop); (2) connection saturation — added `statement_timeout` + `idle_in_transaction_session_timeout` and lowered pool `max` 20→10 (`lib/data/postgres/client.ts`), chunked the sync push. **Workout data loss fixed:** the on-device sync outbox silently never sent exercise logs (v7 SQLite migration didn't apply on device), so workout logging now POSTs directly to `/api/log-exercise` (`components/workout-screen.tsx`), bypassing the local-first outbox. Earlier same session: full local-first sync expansion (workout/Oura/PR domains, PR #11) + `projectOverview.md` split into `docs/overview/history-*.md`. PRs #11–#16. |
| v1.65.0 | ✅ Session 164 — "Why this?" session explain: "Why this? →" link on recommendation card navigates to `/session-explain`. Full breakdown page shows score ring (0–100, color-coded), weighted contributor bars (muscle recovery/balance/freshness), per-signal cards (Oura readiness, 14-day sleep trend, 14-day HRV trend, energy level, sore muscles, consecutive training days), ranked alternatives, and streaming Gemini AI insight. Dynamic weight shifting now activates when readiness < 60 or sleep trend < 85% (recovery weight 40%→55%). Energy level feeds deload recommendations (drained = strong, low bumps one tier). HRV warning when 14-day trend < 85% of baseline. 27 new tests in `ai-dynamic.test.ts`. |
| v1.64.1 | ✅ Session 164 — Nutrition saved-state bug fix + meal card UI uplift. `SavedMealsSheet.quickLog` was calling `onLogged()` (→ `fetchData()`) before `invalidateCache()`, so `lsGet` read the stale localStorage value before it was cleared — logged items never appeared. Fixed by awaiting cache invalidation before `onLogged()`. Meal card headers now show P/C/F gram breakdown alongside calories when items are logged. |
| v1.64.0 | ✅ Session 163 — Workout screen UI redesign: warmup screen has 10-min progress bar + compact muscle heatmap. Rest timer continues past zero showing red overtime (+N seconds). Working weights auto-scale from 1RM (fixed useEffect not re-firing when exerciseIndex stays at 0). Exercise summary + done screens fixed for safe-area insets. Pre-exercise ready screen now shows session timer, prominent "Load the bar to X kg" card, and segmented 2-min warmup timer (W1/W2/W3 × 40s each) — no intermediate loading screen. 1RM estimation changed from MAX to AVERAGE across all sets for smoother progression. |
| v1.63.0 | ✅ Session 162 — Sync cache invalidation: `pullDelta` now returns `{ synced, domains }` indicating which domain groups received rows (biometrics/programs); `sync-provider.tsx` calls `invalidateBiometrics()` or `invalidateProgramStructure()` immediately after, eliminating stale data after background sync. Health > Body de-duplication: removed duplicate Readiness/Activity/Sleep contributor bar sections from `OuraSection`; replaced with tappable "→" links to detail pages. Home screen component breakup: extracted `MiniSparkline`, `EarlyDeloadCard`, `GoalsCheckinCard`, `HomeCardWidget` (React.memo) from `session-select-content.tsx` (1828 → focused files under `components/home/`). |
| v1.62.1 | ✅ Session 161 — Adapter slices + tech debt: AI Periodization and Oura Ring domains extracted from `adapter.ts` into `slices/periodization.ts` + `slices/oura.ts` (adapter 3231 → 2552 lines). Two timezone bugs fixed (`activity-history-card.tsx` weekStartDate, `weekly-muscle-sets` label). 4 dead files deleted. `OuraConnectionSection` rename to resolve naming collision. |
| v1.62.1 | ✅ Wakeup time fix — day timeline now prefers the Oura sleep row when both Samsung Health and Oura logged the same night. Samsung records in-bed time (~8:10 PM); Oura records actual sleep onset. `app/api/day-timeline/route.ts`. |
| v1.62.1 | ✅ Phase 8 CB-1 (partial): Programs adapter slice — extracted programs, block periodization, and progression styles (~670 lines) from `adapter.ts` into `lib/data/postgres/slices/programs.ts`, following the pattern of the existing nutrition.ts and social.ts slices. Adapter reduced from 3901 → 3230 lines. |
| v1.62.0 | ✅ Home screen day timeline widget — vertical event strip (wakeup, workouts, meals, walks) rendered on the home screen below the score chips. `components/home-day-timeline.tsx`, `app/api/day-timeline/route.ts`. Walk/run events use the same quality filters (≥500m, ≥1.5 km/h, ≤3h) as Phase 2.2. |
| v1.62.0 | ✅ Phase 11.4: AI insight cards — per-section AI health insights on each detail page. Rate-limited (5/hr), cached in DB (once per section/date), force-refresh button. `components/health/ai-insight-card.tsx`, `app/api/ai/health-insight/route.ts`, migration 088. |
| v1.62.0 | ✅ Phase 11.3: Day timeline page — `app/health/timeline/page.tsx` + `/api/day-timeline`. Aggregates wakeup, meals, workouts, walks in parallel; sorted by time; tz-aware. |
| v1.62.0 | ✅ Phase 11.1: Four Oura detail pages — `/health/readiness`, `/health/sleep`, `/health/heart-rate`, `/health/activity`. Each has large score arc, contributor bars, day chart, AI insight card. |
| v1.62.0 | ✅ Phase 9.2: Oura score chip row — four tappable band-tinted pills (Readiness/HR/Sleep/Activity) above the readiness card on home. `components/oura-score-chip-row.tsx`. |
| v1.62.0 | ✅ Phase 9.1: Mood check-in collapsible sections — Sore Muscles and Issues collapsed by default, auto-expand when editing a log with existing data in those sections. |
| v1.62.0 | ✅ Phase 4.14: Completed session visual indicator — green `ring-1 ring-green-500/40` on trained-today session card, `CheckCircle2` badge, green "Start Again" button. `app/workout-select/workout-select-content.tsx`. |
| v1.62.0 | ✅ Phase 2.3: Mood log date format bug — components were writing `YYYY/MM/DD` (from `toLocaleDateString`) while the API reads `YYYY-MM-DD`; replaced with `todayInTz()`. Cache invalidated on save. |
| v1.62.0 | ✅ Phase 2.2: Walk detection quality filters — `MIN_DISTANCE_M=500`, `MIN_AVG_SPEED_KMH=1.5`, `MAX_DURATION_SEC=3h` in both `app/api/oura/workouts/route.ts` and `app/api/day-timeline/route.ts`. Eliminates home-pottering false positives. |
| v1.62.0 | ✅ Phase 2.1: Sleep discrepancy fix — `mergeByDate` in `app/api/sleep-sessions/route.ts` treats the Oura row as authoritative for duration when exactly one of two same-date rows has `oura_id` non-null (Samsung data preserved for display). |
| v1.62.0 | ✅ Phase 1.6: Scoped cache invalidation — `pull-to-sync` triggers targeted group invalidations (`invalidateWorkoutSummaries`, `invalidateReadinessInputs`, plus body/sleep/training keys) instead of a blanket `invalidateCache('')`. `lib/cache-groups.ts` exists and is imported across the app. |
| v1.62.0 | ✅ Phase 1.3: Composite indexes (migration 087) — `idx_workout_sessions_user_started`, `idx_exercise_logs_user_exercise_date`, `idx_set_logs_exercise_log`, `idx_body_metrics_user_date`, `idx_sleep_sessions_user_date`. |
| v1.62.0 | ✅ Phase 1.1: Migration tracking table — `schema_migrations` table; `ensureSchema` skips already-applied files on boot; catches `23505` for Railway multi-replica race. |
| v1.62.0 | ✅ Phase 1.4 + Phase 0.1: `next.config.ts` — `poweredByHeader: false`, AVIF/WebP image formats, static-asset immutable cache headers, security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), CSP report-only. |
| v1.62.0 | ✅ Phase 0.4: Oura webhook GET constant-time compare — `timingSafeEqual` with length guard for the verification_token check. |
| v1.62.0 | ✅ Phase 0.3: Rate limiting — `pw-change:${userId}` (5/hr) on password change; `mobile-token:${ip}` (10/5 min) on token exchange. |
| v1.62.0 | ✅ Phase 0.2: JWT session maxAge — 7-day session, 24h rolling update in `auth.config.ts`. |
| v1.62.0 | ✅ Phase 1.7: Connection pool — `max: 20` in production, `10` in dev. |
| v1.62.0 | ✅ Phase 0.6: Repository pattern — no remaining `new PostgresWorkoutRepository()` direct instantiations in `app/` routes; all go through `getRepository()`. |
| v1.62.0 | ✅ Adapter slices — `lib/data/postgres/slices/nutrition.ts` (nutrition/food/meals), `social.ts` (friends/feed/leaderboard) already extracted previously. |
| v1.62.0 | ✅ Phase 2.5: AI periodization baseline "Baseline needed" fix — "Use prior data →" button in the AI periodization card submits existing personal records as baseline without requiring new AMRAP tests. Backend already supported `useExisting: true`; UI button added to `components/health/ai-periodization-status-card.tsx`. |
| v1.62.0 | ✅ Phase 12.5: Voice logging — microphone button on active set card uses Web Speech API to parse spoken reps/weight ("80kg 5 reps", "5 by 80", "80×5", etc.). Handles Chrome and webkit prefix. Hidden on unsupported browsers. `components/workout/set-card.tsx`. |
| v1.62.0 | ✅ Phase 12.4: Web push notification infrastructure — VAPID-based server push via `web-push` package. `lib/push.ts` (server), `lib/push-client.ts` (client subscribe/unsubscribe), `app/api/push/subscribe/route.ts` (GET/POST/DELETE), `public/sw.js` updated with push+notificationclick handlers, `push_subscriptions` DB table (migration 098), Profile → Preferences toggle. Gracefully no-ops when VAPID env vars are not set. |
| v1.62.0 | ✅ Phase 12.3 (Phase A): Exercise ID FK — nullable `exercise_id UUID FK → exercise_library.id` added to `session_exercises`, `exercise_logs`, `personal_records`, `exercise_media`. Backfill by exact name match. `logExerciseAndSets` and `upsertPersonalRecord` now resolve and write `exercise_id`. Migration 099. Phase B (NOT NULL enforcement) deferred until 24h on production. |
| session 158 | ✅ Implementation plan written (no code shipped) — `docs/superpowers/plans/2026-06-28-perf-ux-activity-nutrition-fixes.md` covers 14 areas: mood tracker collapsible sections, home screen loading perf, muscle SVG caching, training tab caching, AI periodization baseline bug, activity tracking quality filters, workout completed UI, end-of-day nutrition notification, Oura-style home chip row, 4 detail pages (Readiness/Sleep/HR/Activity), de-duplication strategy, timeline feature, AI insights per section (rate-limited/cached), sleep discrepancy fix. |
| v1.61.0 | ✅ Activity HR chart + mood check-in redesign (session 157): Activity detail sheet now fetches per-minute HR from `oura_heartrate` for the activity's exact time window and renders a compact red line chart with elapsed-time x-axis. `/api/oura/hr-window` extended to accept `date+startTime+endTime` params (server converts using session timezone) alongside the existing ISO timestamp form. Daily check-in redesigned into 3 clearly divided sections: Energy (auto-defaults from Oura readiness score), Sore Muscles (always-visible, grouped by Upper/Lower/Core body region), Issues (Stiff, Heavy Legs, Joint Pain, Sick, Low Motivation). Sleep quality question removed — Oura captures this. Tight back removed from issues — maps to Back in sore muscles. AI periodization `sore_muscles` flag still auto-injected into bodyState when any muscle is selected. |
| v1.60.3 | ✅ GPS transport filter + Health carousel (session 156): Auto-detect exercise now discards train/bus rides — trains average under 27 km/h including stops, but individual GPS segments between stations exceed 8 m/s (28.8 km/h). If >10% of consecutive GPS point pairs are that fast the session is dropped as motorised transport. Health tab replaced the instant tab-switch with a full drag carousel: all three panels (Body/Training/Progress) render side-by-side; finger drag moves the track in real time via `translateX`, snaps to the nearest tab on release with a cubic-bezier transition. Over-dragging past the edge has 0.2× resistance. Each panel has its own PullToSync. |
| v1.60.2 | ✅ Perf/UI bug fixes (session 155): Pull-to-sync threshold raised (72→100px indicator, 20→36px direction-lock) to prevent accidental activation during normal scrolling. Training load section seeds from cache on Health tab open — no more skeleton flash on repeat visits. Swipe left/right on Health screen cycles through Body/Training/Progress tabs. Home screen Deload/Rest/Full buttons and rest-day card now use Lucide icons instead of emojis. Auto-detect exercise discards sessions with avg speed >27 km/h (car drives). Activity distance rounded to 2 dp. Recommended session card lazy-seeds from sessionStorage/localStorage — no micro-load skeleton on each navigation. HR graph y-axis padded ±10 bpm around min/max — line no longer pinned to edges. Exercise review sheet shows HR sparkline (Oura data) and date/time context in header. |
| v1.60.1 | ✅ Exercise detection frequency fixes (session 154): Root cause of 40+ queued sessions was a dedup bug — `ExerciseDetectedCard` re-fetched all unreviewed Oura workouts on every page mount and added them without checking if they were already in the Zustand store (by `ouraWorkoutId`). Fixed. DB query now filters out zero-distance Oura workouts and limits unreviewed results to the last 30 days. API route filters out sessions shorter than 5 minutes. Saving a GPS phone session now auto-marks any overlapping Oura workout as reviewed (prevents same walk appearing twice). "Dismiss all" button clears entire backlog in one tap. |
| v1.60.0 | ✅ Treadmill sessions + Oura workout auto-detection (session 153): Treadmill activity type added — timer-based session, post-workout distance entry, steps auto-calculated (height × 0.415 stride ratio), HR from local Oura heartrate cache with on-demand backfill. Oura walk/run workouts surfaced on Health > Training tab as "Exercise Detected" review cards. Background GPS auto-detection service for Android (Capacitor guard); Zustand persist store for `PendingSession[]`. New API: `GET/PATCH /api/oura/workouts`, `GET /api/oura/hr-window`. DB migrations: `094_treadmill.sql`, `095_oura_workouts.sql`. |
| v1.59.3 | ✅ Done screen scroll + HR graph fix (session 153): When HR data was loaded on the done screen, `justify-center` caused content to overflow without scrolling, pushing Share/Done buttons below the safe area. Wrapped content in `overflow-y-auto` + `min-h-full justify-center` so the screen scrolls when tall but stays centred when short. Added `grace: 8%` to the HR recovery chart y-axis so the BPM line no longer clips the top edge. |
| v1.59.2 | ✅ Scroll lag + pull-to-sync fixes (session 152): Removed drag-to-reorder from Home and Health screens entirely; show/hide widget edit mode preserved. Fixed `PullToSync` swallowing downward scroll gestures via direction-locking (20px threshold before activating; lock to 'scroll' mode on first upward delta). Removed accidental `overscroll-behavior: none` that broke upward scroll. |

| v1.59.1 | ✅ Readiness card routing fix (session 151): The new `ReadinessCard` component (from session 149) was mistakenly wired into `overview-screen.tsx` (`/overview` route) — but the home tab navigates to `/` which renders `session-select-content.tsx`. Replaced the old 90-line inline readiness card in `session-select-content.tsx` with `<ReadinessCard readiness={readiness} />`. Also removed the now-unused `BedDouble`, `HeartPulse`, `Heart`, `Zap` icon imports from that file. |
| v1.59.1 | ✅ Pull-to-sync gesture (session 150): iOS-style pull-down-to-sync on Home, Health, and More screens. Non-passive `touchmove` listener (required for `e.preventDefault()`), `scrollTop <= 2` guard prevents conflict with normal scrolling, 0.5× resistance factor, 72px indicator threshold (144px physical drag). Phases: `idle → pulling → ready → syncing`. Sync fires in background — indicator dismisses after 650ms, data continues syncing silently. Sync covers all directions: `pushMutations` (local→Railway), `drainOutbox` (outbox→Railway), `pullDelta(userId, true)` (Railway→local, bypass throttle), `POST /api/oura/sync` (Oura Ring→Railway). Cache fully cleared after sync (`invalidateCache('')`) then all screen data re-fetched in background. No success toast — indicator spin+dismiss is the only feedback. Error toast only if Oura sync rejects. HC sync also made fully silent (removed all toasts from `health-connect-provider.tsx`). New file: `components/pull-to-sync.tsx`. |
| v1.59.0 | ✅ Compact readiness card (session 149): replaced the bloated ~120px readiness card with a compact ~52px tappable strip. Collapsed: 44px SVG arc with score inside (green/amber/red by label), Readiness + label, divider, three icon chips (MoonIcon sleep score, ZapIcon activity score, HeartIcon current HR bpm) with `—` placeholders when null. Expanded (tap to toggle, AnimatePresence): score breakdown table (Oura base → ACWR adj → temp deviation → final), readiness/sleep/activity contributor bars (all, sorted ascending, color-coded), HR Today 2×2 grid (Current/Min/Avg/Max). ACWR grace period: skipped for first 28 days of any new program. API extended with `activityScore`, `sleepContributors`, `activityContributors`, `hrCurrent/Min/Avg/Max`. `getActiveProgram` + `getHrForWindow` folded into parallel fetch. No emojis — all Lucide icons. New file: `components/readiness-card.tsx`. |
| v1.58.0 | ✅ Health screen drag-to-reorder + home card widgets (session 148): Health screen cards can now be drag-to-reordered per-tab (Body/Training/Progress) with a LayoutGrid button in the header toggling edit mode (grip handles appear only in edit mode, matching home screen pattern). Home screen gained 3 new card widgets: ACWR (training load), Muscle Status (injury heatmap), and HR Chart (Oura intraday heart rate — identical rendering to the health screen version including sleep/workout shading and legend). Home Widgets section in More tab simplified to flat list. `compact` + `showLegend` props added to `HrDayChart`. |
| v1.57.0 | ✅ 24h HR chart + sleep hypnogram (session 147): Full-day heart rate chart in Oura section (midnight→midnight, 5-min smoothed line). Sleep window highlighted in indigo (from Oura source field); gym session window highlighted in orange (from `workout_sessions` table so it shows regardless of Oura's source tagging). Session name shown in legend ("Workout: Push"). Sleep hypnogram added to sleep detail sheet — 5-min stage timeline from `sleep_phase_5_min`. Home screen flash eliminated (readiness + workout meta now read from localStorage cache before first paint). HR recovery workout chart: fixed set markers (LinearScale), replaced S1 text with exercise colour legend. New API: `GET /api/oura/hr-day` (per-day HR series), `GET /api/workout-sessions/day` (session start/end times). New migration: `093_sleep_phase.sql`. |
| v1.56.2 | ✅ Oura Ring sync fixes (session 146): Four bugs fixed. (1) `allDates` in sync route excluded sleep-only dates so HRV/RHR were never written to `body_metrics` on nights where readiness/activity scores weren't ready yet — fixed by including `sleepByDay.keys()`. (2) `upsertOuraSleep` used `oura_id` as conflict target, crashing when a sleep session conflicted with the `(user_id, sleep_start)` unique constraint (e.g. existing Samsung Health row for same night) — changed target to `(user_id, sleep_start)` so Oura data merges into the existing row. (3) `avg_heart_rate` and `lowest_heart_rate` are INTEGER columns but Oura returns floats (e.g. 75.75) — added `Math.round()` before insert to prevent Postgres type rejection. (4) OAuth scope had `spo2Daily` (invalid) instead of `spo2` — fixed in `buildAuthUrl`; users must disconnect/reconnect to get SpO2 scope. Health tab sleep card now shows `—` for stale data (>1 day old) instead of old Samsung Health entries. Added `docs/oura-ring-data-reference.md` with full field-by-field reference of all Oura v2 endpoints. |
| v1.56.1 | ✅ Crash fix (session 145): React render crash when completing an AMRAP baseline set in an AI Dynamic program. Root cause: Zustand 5.0.13 uses `useSyncExternalStore` internally, which bypasses React 18 automatic batching — the 8 sequential `store.set*()` calls in `handleCompleteSet` produced 8 synchronous re-renders, one of which rendered with inconsistent state (e.g. `mode='exercise-summary'` but arrays already cleared). Fix: atomic `commitExerciseSummary` action in `lib/stores/workout-store.ts` that applies all 8 field updates in a single `set()` call, reducing to 1 re-render with fully consistent state. Also added `error?.message` display in `app/workout/error.tsx` to aid future diagnostics. |
| v1.56.0 | ✅ Food/workout saving audit (session 144). Fixed: strength-trend + day-log missing from invalidateWorkoutSummaries (stale sparklines/calendar); QuickEditLogSheet APK race condition (onSaved before push, causing UI revert); AI prescription never marked consumed after workout; PATCH food-logs missing quantity bounds check; body-metadata HTTP cache defeating client invalidation; per-exercise strength-trend not cleared mid-workout; day-log not cleared after body-metadata/water saves; full exercise library scanned per set (now single-row lookup). Added rate limits. Added FK ownership check to pushMutations food_logs. Capped feedback screenshot at 500 KB. Also: food now appears in meal card immediately (optimistic UI update); dark mode brand accent colours fixed (CSS compound-selector); SQLite→API fallback fixed across 8 write paths; week strip session name colour fix. |
| v1.55.0 | ✅ Exercise library expanded from 75 → 141 exercises (migrations 081 + 082). All exercises now have equipment tags (barbell/dumbbell/cable/machine/kettlebell/bodyweight) and correct primary/secondary muscle assignments. New: muscle group filter row (Chest/Back/Shoulders/Arms/Legs/Glutes/Core/Traps) in the exercise picker. New: exercise preview sheet — ℹ️ button on each exercise in the picker and program editor opens an animated GIF + equipment badges + muscle tags + instructions. 11 muscle assignment corrections. 50+ GIF matcher entries added. |
| v1.54.0 | ✅ AI dynamic periodization engine: Gemini-powered prescription (sets/reps/pct) per session based on RPE trend, ACWR, sleep/HRV, soreness, rep completion, weekly volume. AMRAP baseline → accumulation → intensification → realisation → deload phases. Emergency deload (deterministic, no AI call) when ACWR>1.5, 4+ consecutive days, or rep completion <70%. Pre-workout UI: baseline banner + prescription card with accept/dismiss/transition actions. Health tab: periodization status card + weekly volume vs target bars. Program config: training goal, auto-apply, time budget per session. Migration 079 (schema) + 080 (muscle group lowercase normalization). |
| v1.53.0 | ✅ Full local-first write paths: water log, food logs (create/edit/delete), supplement CRUD, activity log, saved meal logging all write to SQLite first then push to server in background. Workout 'Complete' button is now instant (was 5s delay). Bug fix: waterMl missing from upsertBodyMetrics SQL (water sync was silently dropping values). supplements + activity_logs domains added to pushMutations outbox. |
| v1.52.0 | Session 140: offline-first architecture deep-dive audit. No code shipped. Plan doc at `docs/superpowers/plans/2026-06-20-offline-first-architecture-review.md`. Key finding: body metrics + water log write paths bypass local store (server-only); program structure not in SQLite pull delta; cache invalidation incomplete after food/supplement/injury mutations. Prioritised fix plan written. |
| v1.52.0 | SQLite-first offline store: replaced Dexie/IndexedDB with @capacitor-community/sqlite; added food_logs, supplements, supplement_logs, injuries to local store + delta sync; supplement toggles and injury edits now write locally first on APK |
| v1.51.0 | RPE recording: horizontal slider (6–10) on active set card, intensity-based defaults (80%→8, 90%→9, 100%→10), 2-column done-set grid with RPE+time+rest, stable layout (pre-allocated grid cells), safe-area padding fix, RPE persisted to DB |
| v1.50.4 | Bug fixes: Samsung WebView canvas crash (SVG sparkline), 1RM label regression, Strength Trend moved to bottom, Goals steps weekly target, admin safe-area top, sync throttle bypass |
| v1.50.3 | Bug fixes: Health/Progress SSR crash (initial attempt), supplement button safe-area, Workout Config back button |
| v1.50.2 | C-SESSION-1: workout-card prefetch migrated from raw sessionStorage to cachedFetch; TS errors fixed (pnpm install); all plan docs marked ✅ COMPLETED |
| v1.50.1 | Bug fixes: 1RM reps>30 exclusion, working-mode label; perf: Dexie body metrics fast-path; accessibility: Radix Sheet migration for 3 bottom sheets |
| v1.50.0 | Feedback submission system, injury log + heatmap, supplement tracker + reminders, calendar legend truncation fix |
| v1.49.0 | Strength Trend card in Health > Progress (90-day 1RM sparklines) |
| v1.48.0 | Done screen real volume/sets, per-PR share buttons, weekly volume stat |
| v1.47.0 | Weekly Muscle Volume card (sets/muscle vs. 10–20 target) |
| v1.46.0 | Exercise library picker in Workout Config |
| v1.45.1 | Achievements page performance (pre-computed counts) |
| v1.45.0 | Workout reminder notifications (per schedule, cancels on workout start) |
| v1.44.0 | Lean-mass-aware nutrition goals (Katch-McArdle BMR), calendar legend wrap |
| v1.43.0 | Sprint batch: HC bug fixes, cache correctness, sync, component breakup |
| v1.42.x | Per-session phase tracking, food logging fix, 1RM UI consistency, crash fixes, security sweep |

---

---

## Session 173 — Treadmill GPS + Activity-Save Fixes (2026-07-01) ✅ Shipped (v1.73.1, PR #74)

### Headline
User reported a treadmill session that (a) GPS-tracked and drew a wandering "route" with a nonsense distance/pace on a stationary machine, and (b) showed a "saved" toast but never appeared as a logged activity. Two independent root causes, both fixed.

### Bug 1 — treadmill was GPS-tracked
`components/activity/active-activity-screen.tsx` starts a GPS watcher (and renders the map/distance/pace) whenever `isDistanceBased` is true. That flag comes from `activity_types.is_distance_based` via `/api/activity-types` → `startActivity`. Migration `094_treadmill.sql` inserts treadmill with `is_distance_based = false`, but with `ON CONFLICT (id) DO NOTHING`, so a row that pre-existed or drifted to `true` in production was never corrected (the local dev DB, seeded fresh, was correctly `false` — which is why it couldn't be reproduced locally). The screenshot proved the prod flag was `true` (GPS/distance/pace only render when distance-based).
- **Fix:** migration `101_treadmill_not_distance_based.sql` — `UPDATE activity_types SET is_distance_based = false WHERE id = 'treadmill'`. Treadmill reverts to its intended design: a timer with post-workout manual distance entry. Client caches activity-types for ≤6h (`TTL_LONG`), so the device self-corrects on the next revalidation after deploy.

### Bug 2 — saved activity showed "saved" but never appeared
`activity_logs` has a partial unique index `activity_logs_user_date_start_time_idx ON (user_id, date, start_time) WHERE start_time IS NOT NULL` (migration 071). The **web paths** (`/api/activity-logs` POST, `/api/sync-health`) both go through `repo.saveActivityLog`, which handles a same-minute collision gracefully (`onConflictDoNothing` + select-existing). But the **native APK sync-push path** — `adapter.pushMutations`'s `activity_logs` branch — inserted with an **id-only** conflict target (`onConflictDoUpdate({ target: id })`). When another source (Samsung Health via Health Connect → `syncHealthConnect` → `/api/sync-health` → `saveActivityLog`, or Oura) had already logged an activity at the same minute, the insert raised a duplicate-key error on the *other* index → the mutation errored and stayed in the on-device outbox forever. The local SQLite write has no such unique index, so it "succeeded" and the user saw a "saved" toast, but the server (and the server-rendered timeline) never got it.
- **Fix:** when `start_time` is present, target the `(user_id, date, start_time)` partial index with `targetWhere: isNotNull(startTime)` so a same-minute overlap merges (this save wins) instead of throwing — bringing the native push path in line with the already-graceful web path. Falls back to the id target when start_time is null.
- **Note on the user's specific incident:** they had no Oura data saved at that time (synced it afterwards), so the likely collision source on their Galaxy S25 is Samsung Health via Health Connect auto-recording the treadmill. The fix covers any same-minute source; the exact trigger for the one incident isn't provable without device logs, but the reproduced asymmetry (local allows the collision, server web-path is graceful, server native-push-path threw) matches the "saved but never appeared" symptom exactly.

### Verification
Reproduced the duplicate-key throw against the local dev DB via psql, then confirmed the new `ON CONFLICT (user_id, date, start_time) WHERE start_time IS NOT NULL DO UPDATE` merges cleanly. Verified drizzle emits that exact partial-index target via `.toSQL()`. Migration applies (treadmill → `false`). tsc clean (one pre-existing unrelated `web-push` error), eslint 0 errors, 331 tests pass, all 6 CI checks green. Bumped v1.73.0 → v1.73.1 + changelog. The native sync-push path can't be exercised in-sandbox (no Capacitor), so it's verified at the DB/SQL level. Awaiting on-device confirmation.

### Follow-ups from on-device testing (v1.73.2, v1.74.1)
User tested on-device after the v1.73.1 deploy — treadmill correctly ran timer-only (GPS fix confirmed) — and surfaced two more gaps:

- **v1.73.2 (#76) — saved activity didn't refresh the calendar.** The done-screen save (`components/activity/done-activity-screen.tsx`) hand-rolled its cache invalidation (`activity-logs`, `weekly-stats`, `muscle-recovery`, `achievements:`) and omitted `calendar-data:` + `home-day-timeline`. The Training Calendar caches per-month data as `calendar-data:<YYYY-MM>` for 30 min, so a freshly-saved activity persisted server-side but the calendar kept serving its stale (dot-less) copy — it looked like the save had failed. Root-caused by noting the 10-second test walk had no Samsung Health/Oura collision (so #74's fix couldn't apply) and confirming at the DB level that `getCalendarData` *does* return the saved row. Fixed by routing both save paths through a shared `invalidateActivityCaches()` helper that also busts `calendar-data:` and `home-day-timeline`.
- **v1.74.1 (#79) — treadmill steps didn't count toward day/week totals (✅ device-confirmed).** Treadmill sessions compute a step count (height × distance) stored on `activity_logs.steps`, but the day/week step totals in `/api/body-metadata` (`todayRow.steps`, `weekToDate.steps` — what the goals card renders) read only `body_metrics.steps` (pedometer/Health Connect). Fixed by folding `activity_logs` steps into the today/week totals at read time: broadened the activity-logs fetch from today-only to week-to-date, added today's activity steps to `todayRow.steps` (surfacing them even with no `body_metrics` row) and the week's to `weekToDate.steps`, and added `body-metadata` to `invalidateActivityCaches()`. Only treadmill logs carry a step count (walks/runs record distance), so this can't pull in unrelated data. Verified at the DB level (2000 pedometer + 4000 treadmill → 6000) and **confirmed working on-device by the user**.
- **CI/merge note:** #79's first CI didn't trigger (transient GitHub hiccup — an empty commit and a close/reopen both failed to start a run); the real blocker turned out to be that parallel merges (#78, v1.74.0) had advanced `main` past the branch base. Rebasing onto latest `main` (resolving the `package.json`/`changelog.ts` version conflict → v1.74.1) re-triggered CI, which passed, and auto-merge landed it.

**Still open:** an *old* activity the user had recorded before v1.73.1 deployed never appeared — most likely stranded in the on-device sync outbox from before the collision fix shipped. A pull-to-sync should drain it now (the stuck mutation succeeds on retry against the fixed server path); if not, it was lost on-device and needs re-logging. Also deferred: making an already-mounted calendar live-update after a save (currently it refetches on re-mount / navigation).

---

## Session 172 (cont.) — RPE Autoregulation + AI-Dynamic Polish (2026-07-01) ✅ Shipped (v1.72.1–v1.73.0, PRs #59–#72)

### Headline
Continuation of the v1.72.0 "AI dynamic made real" work. On-device testing surfaced a string of gaps in the newly-live prescription loop, each fixed and shipped, culminating in **RPE-based autoregulation (v1.73.0, #72)** — the RPE slider now genuinely drives progression. All work on branch `claude/ai-periodization-trainer-overview-ss1ukn`, one PR per change, squash-merged (branch restarted from fresh `main` each time). Final: tsc/lint clean, 331 unit tests (+30 new over the session), CI green, runtime-verified against the local dev DB.

### RPE-based autoregulation (v1.73.0, #72) — the headline feature
Designed with the user across four spec PRs (#69–#71) then implemented in #72. The RPE slider previously did almost nothing (stored per set; only a program-wide average >2.0-over-expected forced an emergency deload). Now it shapes per-exercise progression via an **RPE × 1RM quadrant**:

- **Back-off** — when a lift runs harder than its target intensity (Δ = actual − expected RPE ≥ +1.5) **and** its 1RM is regressing (`rm1Trend === 'down'`), next session's load eases **5–10%** for that exercise, sized by rep-completion: `cut% = 5 + 5×clamp((0.95 − completion)/0.25, 0, 1)` — miss by ~a rep (≥0.95) → 5%, miss badly (≤0.70) → 10%. A hard set on a lift that's *still gaining* is deliberately left alone (the user's rule: high RPE only matters when the lift is also going backwards).
- **Push** — when a lift feels easy (Δ ≤ −1.5) **and** you beat the target (reps met, 1RM not down), the engine raises the **demand**, not a fabricated 1RM: it climbs target reps up the goal's rep band (+1 at Δ≈−1, +2 at Δ≤−2), and at the band ceiling an accessory earns a set while a compound lets the already-earned 1RM carry the load. Classic **double progression**, RPE setting the climb rate. No rep pushes in a low-rep realisation block.
- **Time budget** — an earned set is priority-protected in `fitToBudget` (trimmed *last*, only if nothing else can give), so it steals time from lower-value work rather than overrunning the session; if it can't fit, it falls back to the rep bump.
- **Reps-aware expected RPE** — the crux false-positive fix. Replaced the %-only bucket with a reps-in-reserve model (`expectedRpe(pct, reps) = 10 − (maxRepsAtPct(pct) − reps)`, off the same `repFactor` curve as `lib/1rm.ts`). An AMRAP set grinds out near-max reps → expected RPE ≈ 9–10 → Δ ≈ 0, so the +1/AMRAP last set never false-flags as "too hard".

New files: `lib/ai-periodization/expected-rpe.ts`, `lib/ai-periodization/autoregulation.ts` (pure `computeRpeAdjustment` / `applyAutoregulation`). `signals.ts` gained per-exercise `rpeDelta` + `repCompletionRate`; `time-budget.ts` `fitToBudget` gained a `protectedIds` param (trim-last two-pass); `AiPrescriptionExercise` gained an optional `autoregNote` string (populated by the engine, e.g. "−7.5% load — RPE ran high while your 1RM slipped"; UI not yet rendering it — a separate UI agent is picking that up). `repFactor` exported from `lib/1rm.ts`. Applied in the prescribe route *before* the time budget so the earned set can be funded. Both signals must agree before anything fires; ±1.5 dead-band; ≥3 RPE-tagged sets required; degrades to reps-only when RPE absent; auto-apply vs suggest follows the existing `autoApplyPrescriptions` setting; no DB migration. Full spec: `docs/superpowers/plans/2026-07-01-rpe-autoregulation.md`. Runtime-verified: a throwaway DB smoke seeded high-RPE + poor-completion set logs → `aggregateSignals` returned rpeDelta 2.33 / completion 0.64 → the end-to-end adjustment produced the full 10% cut with the note.

### Interim fixes shipped this run (v1.72.1 – v1.72.8, PRs #59–#68)
- **v1.72.1** — duplicate "Muscle Volume This Week" widget (my volume-target seeding made the dormant `AiWeeklyVolumeCard` render) fixed by dropping `aiVolume` from the default order; readiness/sleep home widgets going blank until app restart fixed with a bounded `fetchWithRetry` (pre-existing once-per-mount, no-retry fragility).
- **v1.72.2** — training goal never stored → every AI program ran strength zones; builder now sends `trainingGoal`, plus powerbuilding & strength+hypertrophy zone tables.
- **v1.72.3** — exercise reorder (up/down) in the builder; exercise-swap no longer offers single-muscle isolations for a main slot + flags an isolation held in a main slot (muscle-count heuristic, library audited 100% clean).
- **v1.72.4** — AMRAP tiered to the **main lift only** (secondary compounds/accessories take a controlled +1) to avoid a session of all-out lifts; builder confirms before discarding a generated program.
- **v1.72.5** — phase-progression chart (Accumulate→Build→Peak→Deload bars) on the training-goal screen.
- **v1.72.6** — the last-set +1/AMRAP push now shows from session **one** of an AI program (was gated behind a prescription existing, so session 1 with no prescription showed flat reps).
- **v1.72.7** — the workout **weight dial steps 1.25 kg** (was hardcoded 2.5 kg, snapping a prescribed 23.75 kg up to 25 on the active set and making it un-selectable); matches the prescription granularity and the user's 1.25 kg plates.
- **v1.72.8** — the **rest-complete notification fires as an exact alarm** (`allowWhileIdle` → `setExactAndAllowWhileIdle`; `USE_EXACT_ALARM`/`SCHEDULE_EXACT_ALARM` in the manifest). Was arriving ~30 s late because an ordinary alarm gets batched into Doze while the screen is off/backgrounded during rest. ⚠️ Needs an Android app rebuild to take effect (manifest change).

### Git note
The squash-merge + auto-branch-delete pattern recurred all session: each PR merged and deleted the remote branch, so the next PR had to restart from fresh `origin/main` (`git checkout -B <branch> origin/main` + cherry-pick/overlay), and `--force-with-lease` hit "stale info" on the pruned ref → resolved with `git remote prune origin` + a normal push. Smooth once the pattern was mechanical.

### Pending / handed off
- On-device: autoregulation only bites after ≥3 RPE-logged sets on a lift + a 1RM comparison — needs a few honest-RPE sessions to observe. The exact-alarm rest-notification fix needs a native rebuild. A UI agent is surfacing `autoregNote`.
- Optional later layer (deferred, in the spec): a **within-session live** RPE nudge (drop the next set this session after a mid-set logs far above expected). This run's scope was cross-session only, per the user's framing.


## Session 172 — AI Dynamic Periodization Made Real (2026-06-30) ✅ Shipped (v1.72.0, PR #58)

### Headline
A deep-dive into the AI dynamic periodization engine surfaced that the per-session AI prescription was **advisory-only**: the bar always loaded each exercise's static progression style, phase-blind, so the accumulation→intensification→realisation intensity wave never reached the barbell (proven live: a session loaded the same 73.75 kg in both accumulation and realisation). Six changes turned the engine into a real, adaptive trainer. Branch `claude/ai-periodization-trainer-overview-ss1ukn`, squash-merged as PR #58. tsc clean, eslint 0 errors, 297 unit tests (+33 new), all 6 CI checks green, runtime-verified against the local dev DB.

### What shipped
1. **Prescriptions drive the loaded weights** — when a prescription is in effect (accepted/auto-applied, or a pending plain "stay"), its per-exercise sets/reps/pct/rest drive the live workout on the *live* estimated-1RM basis; the card and bar now agree. Dismiss reverts to the program's base style. Gated on `phaseMode === 'ai_dynamic'`, so manual/automatic are untouched. New pure helper `lib/ai-periodization/apply-prescription.ts` (`prescriptionDrivesLoad`, `prescriptionStyleForExercise`); override applied in `app/api/workout-data/route.ts`; status changes refetch exercises so accept/dismiss re-load the bar.
2. **Time-budget enforcement** — `lib/ai-periodization/time-budget.ts`: a deterministic, reps-based duration model (per-set time = 10s setup + reps×4s; full rest; 120s/exercise transition) and `fitToBudget` that trims sets to fit `timeBudgetMinutes − 10` (10 min reserved for warmup), accessories first, compounds never below 2 working sets. Applied in the prescribe route (normal + emergency-deload paths); the prompt's duration formula updated to match. Verified: a 300s-rest realisation session fit a 30-min budget at 19 min.
3. **Last-set push to grow 1RM** — the final working set targets a small overload: compounds (primary/secondary) get an AMRAP set, accessories a +1. The 1RM **anchor stays at the base reps** (`progressionStyle[i].reps`), so hitting base holds the estimate, beating it raises, missing it lowers — self-regulating, no runaway rep creep (weight micro-loads instead). No change to the shared `lib/1rm.ts`. `workout-data` tags each driven exercise with `lastSetMode`; every last-set dial pre-fills +1; the active set card shows an "AMRAP · beat it" cue; the pre-workout card annotates each exercise's last set.
4. **Training goal wired into the engine + blend zones** — the AI builder offered powerbuilding / strength+hypertrophy but **never stored `trainingGoal`**, so every AI program prescribed from the default strength zones. `builder-review` now sends `trainingGoal: inputs.goal`; new **powerbuilding** and **strength+hypertrophy** `INTENSITY_ZONES` tables + deload defaults; editor goal dropdown gains both.
5. **"Why these reps/sets?" breakdown** — `lib/ai-periodization/explain.ts` builds a per-exercise rationale (phase intent, compound vs accessory, 1RM trend, last-set push) from signals already sent to the client; rendered as an expander on the prescription card.
6. **Weekly per-muscle volume targets auto-seeded** — `lib/ai-periodization/volume-targets.ts` (`computeDefaultVolumeTargets`): goal-based landmarks (larger muscles get more), seeded for the muscles a program trains, wired into `app/api/workout-templates` POST for new `ai_dynamic` programs (never overwrites existing targets). The engine already budgeted sets toward targets — it just had none. Time budget stays the hard cap.

### Tests
New pure helpers each unit-tested: `apply-prescription` (incl. 1RM-behaviour through `calculate1RM` — flat/beat/miss), `time-budget`, `explain`, `volume-targets`, plus `prompt-zones` (blend zones reach the prompt). 264 → 297.

### Decisions / notes
- Periodization is **on by default**: a pending "stay" drives the bar (Dismiss reverts); non-trivial recommendations (transition/deload/swap/rest) only drive load once explicitly accepted.
- Accessory "+1" is the prescribed default *and* registers as a gain because the anchor stays at base — verified it micro-loads weight session over session rather than creeping reps to infinity.
- ⚠️ **Not exercisable headless, pending on-device/prod check:** set-card AMRAP label + last-set +1 pre-fill (UI), the volume-target seeding round-trip on a real program save (helper unit-tested, wiring tsc-clean; local dev server was flaky for the full POST), and a manual/automatic regression pass (code-gated off these changes, but unverified live).

---

## Session 171 — Activity Score Blend + Timeline & Activity-Tracking Fixes (2026-06-30) ✅ Shipped (v1.71.0, PR #51)

### Headline
Six batched changes from a user request, planned (`docs/superpowers/plans/2026-06-30-activity-score-timeline-activity-fixes.md`) then built on one branch and squash-merged as PR #51. tsc clean, eslint 0 errors, 264 unit tests (+7 new), runtime-verified against the local dev DB. Awaiting production/device confirmation.

### What shipped
1. **Activity score blends gym training load.** Oura's activity score is a pass-through and under-counts lifting (a Legs day read `training_volume` 46). New pure helper `lib/activity/blend-activity.ts` adds a bounded credit (`BASE 6 + VOL 8·volRatio`, capped `MAX 14`) where `volRatio = min(1, todayVolume / medianSessionVolume)` and the credit is multiplied by `missed = 1 − trainingVolumeContrib/100` (so a day Oura already scored high gets ~0). Applied once in `/api/readiness-score` (both the home chip and the Activity detail page read `activityScore` from there); the route already loaded recent sessions for ACWR, so `todayWorkoutVolumeKg` + the median baseline reuse that data. Response gains `activityBlend {base, adjustment, final, trained}`; chip shows a `+N` badge, detail page shows "Oura X · +Y training → Z". The 3 fallback `ReadinessScoreResponse` literals (activity/readiness/sleep content) got the field too. **Runtime-verified: base 62 + 8000 kg leg day → 70 (+8), trained.**
2. **Timeline meal times.** `app/api/day-timeline/route.ts` meal block now positions a meal at the latest in-window `loggedAt`; if nothing was logged inside the window it falls back to the window **end** (not the start). Verified: breakfast logged 7:30 AM (in 6–10) → 7:30 AM; lunch logged 6 PM (outside 12–15) → 3 PM.
3. **Yesterday on the timeline.** The route now also builds yesterday's workouts, walks and the primary-night wake-up, plus a new `'sleep'` "Fell asleep" event from today's sleep `sleepStart` + `onset_latency_sec`. Each event's `day` group is derived from `timeMs` vs today's midnight (handles a post-midnight onset). UI (`home-day-timeline.tsx` + `health/timeline/page.tsx`) renders a "Yesterday" divider + a `SleepCard`. Meals stay today-only (user's call).
4. **AI periodization stale count.** `sessions_in_phase` is a stored counter incremented on complete-workout but never decremented on delete, and the delete invalidated no cache. `app/api/workout-entry` DELETE now runs `UPDATE session_periodization SET sessions_in_phase = GREATEST(sessions_in_phase-1,0) WHERE user_id=$1 AND program_session_id=$2 AND $3 >= phase_started_at` (raw SQL in the same txn; the guard avoids under-counting a delete of an older-phase session), and the client delete paths call `invalidateWorkoutSummaries()`. SQL validated against the live schema.
5a. **Auto-detect false positives.** Thresholds centralised in `lib/activity/detection-thresholds.ts` (Balanced: `MIN_DISTANCE_M 750`, `MIN_AVG_SPEED_KMH 2.5`, `MIN_DURATION_SEC 420`) and applied to the Oura workouts route, the day-timeline walk filter, and the phone GPS store (`auto-detection-store.ts` — which previously had only upper bounds, so a slow short shuffle qualified).
5b. **Steps.** The Oura sync (`app/api/oura/sync/route.ts`) now writes `daily_activity.steps` into `body_metrics.steps` via the existing COALESCE-EXCLUDED upsert (it was synced to `oura_daily` only, never to the table the UI reads).
5c. **"Workout detected" card → Home.** `ExerciseDetectedCard` + its `ExerciseReviewSheet` moved from `app/health/health-sections.tsx` to `app/session-select/session-select-content.tsx` (rendered after Body Battery). The `setReviewingSessionId` ctx field, state, and sheet were removed from the Health side.

### Decisions taken with the user (AskUserQuestion)
- Activity score: **blend into the score** (not a separate indicator).
- Yesterday timeline: **everything except meals**.
- Auto-detect: **Balanced** thresholds.
- Approach: **plan doc first**, then batch-implement on one branch.

### Follow-ups / risks
- Activity-blend constants (`BASE 6 / VOL 8 / MAX 14`) are heuristic and live in one helper — tune against real multi-day data once observed in production.
- **5b (steps) and 5c (card on Home) were not exercisable in-sandbox** (steps needs a real Oura token; the card needs the device/browser) — eyeball these first on the S25.

### Post-deploy follow-ups (user prod testing) — v1.71.1 → v1.71.4

Shipped as four small PRs after the user tested v1.71.0 on the S25; each runtime-verified against the local dev DB (logged in as the seeded test user) and squash-merged on green CI.

- **v1.71.1 (#53) — timeline polish.** "Yesterday" divider made prominent (bold foreground + a flex rule line, was muted/indented and blended into cards). Workout events now carry `endTime` (from `completedAt`) so the card shows a start–end range like walks already did. Workout events include `exerciseNames`; the home + full timeline cards list them under the duration/sets line.
- **v1.71.2 (#54) — saved activities on the timeline.** The day-timeline only sourced walks from `getOuraWorkouts`, so a user's saved `activity_log` (e.g. a recorded walk) never showed. Now fetches `listActivityLogs(userId, yesterday, date)` and renders them (start–end, distance, rounded duration, calories), deduping any Oura walk whose `[start,end]` overlaps a saved log. **Gotcha fixed:** `start_time`/`end_time` come back as `HH:MM:SS`; the route appended `:00` → invalid date → the event silently dropped. Normalised with `.slice(0,5)`. `WalkCard` now shows a non-walk/run activity's own title. Also rounded the day-sheet activity duration (`health-content.tsx`, was `37.0335… min`).
- **v1.71.3 (#55) — Oura sleep latency mapping.** Root cause of "no latency on the timeline": the Oura v2 sleep model field is **`latency`** (seconds), but `lib/oura/types.ts`, the sync route, and the webhook all read a non-existent **`onset_latency`**, so `sleep_sessions.onset_latency_sec` was written NULL on every sync and *every* latency consumer (timeline "Fell asleep", sleep detail) was blank. Renamed the type field + both readers to `latency`; the sleep upsert already `COALESCE`s the column so a re-sync backfills existing rows (no migration). Verified against the bundled Oura OpenAPI (`PublicModifiedSleepModel` has `latency`, no `onset_latency`). Corrected `CLAUDE.md` + `docs/oura-ring-data-reference.md` to prevent recurrence.
- **v1.71.4 (#56) — AI periodization counts self-heal.** `sessions_in_phase` is a stored counter (only `+1` on complete-workout, `−1` via the app delete flow added in #51), so test sessions inserted/deleted directly in the DB left it inflated with no self-correction (card kept showing e.g. "Upper · 3 sessions"). New `reconcileSessionsInPhase(userId, programId)` (`slices/periodization.ts`) recomputes each session's count from the actual non-empty `workout_sessions` with `started_at >= phase_started_at`, writing only rows that drift; the `program-overview` route calls it before reading the states, so the count self-corrects on every Health → Training load. Dev-DB verified: inflated 99→3 and 50→1, phase-window respected. ⚠️ Display is cached 30 min (`ai-periodization-overview`); a pull-to-sync refreshes immediately.

**Branch/CI note:** squash-merge auto-deletes the feature branch, and reusing the same branch name without re-fetching left a stale `origin/main` so CI didn't trigger once (#54 — fixed by `git remote prune` + rebase onto fresh `origin/main` + re-push, plain push since the remote branch was gone). For each follow-up: `git fetch origin main` → `git reset --soft origin/main` (keep edits) → commit → push fresh.

---

## Session 167 — Home-Screen & Health Bug-Fix Sweep (2026-06-30) ✅ Complete

### Headline
Device-driven bug-fix sweep across the home screen and Health tabs, shipped as three PRs (#33, #36, #38) and verified against the local dev DB. v1.68.0 → v1.68.1.

### What was fixed
- **Timeline wake-up time** (`app/api/day-timeline/route.ts`) — was `sleepRows.find(r => r.ouraId)`, which could grab a short Oura nap/rest fragment ("Woke up 9:14 PM / 0h 12m"). Now restricts to rows ≥3h (the primary night sleep), still preferring the Oura row for accurate onset. Verified: a seeded 9.3h main sleep + 12-min nap resolves to the 6:50 AM main sleep.
- **Phantom/deleted workouts** — sessions with 0 logged exercises (abandoned starts / post-delete leftovers) are filtered out of both the home timeline (`day-timeline`) and the **HR-chart workout band** (`/api/workout-sessions/day`, which reads `getDayLog` and now filters `exercises.length > 0`). The HR band was a separate consumer not covered by the first PR.
- **Activity duration rounding** — `Math.round(durationMin)` on display in `activity-history-card.tsx` and `activity-detail-sheet.tsx` (was a raw float, e.g. 37.0335… min).
- **Safe-area** — `.pt-safe-or-4` was referenced by `DetailHero` and the timeline page header but **never defined** in `globals.css` (only `.pt-safe` existed), so the Sleep/Readiness/Activity/HR detail-page back buttons sat under the status bar. Added the utility (= `pt-safe`). Also gave the activity detail sheet top safe-area padding.
- **Daily check-in re-appearing** (`session-select-content.tsx`) — a racing `/api/mood` GET returning `null` (before the local-first write pushed) was caching that null via `cachedFetch`, re-showing the check-in on the next visit. Replaced the two mood `cachedFetch` calls with a `loadTodayMood` helper that never caches/applies a null over an optimistically-saved mood.
- **Rest day not sticking** — `handleRestDay` optimistically set `isRestDay` then refetched `/api/next-session`, which recomputes with no persisted rest state and reverted the choice. Removed the reverting refetch; persist the choice in a date-stamped `ta_rest_day` localStorage marker, applied via `withRestDayOverride` at every recommendation-load site.
- **Cards reloading on every open** — AI Periodization (`ai-periodization-status-card.tsx`), Muscle Volume This Week + muscle-recovery heatmap + injuries (`health-content.tsx` sync seed + injuries moved to `cachedFetch`), and Weekly Volume vs Target (`ai-weekly-volume-card.tsx`) now seed from cache (`readCacheSync`) for instant paint. New cache keys (`ai-periodization-overview`, `weekly-volume-target`) added to `invalidateWorkoutSummaries`.
- **Health > Progress 1RM** (`lib/health/strength-progress.ts`) — the Sets/1RM end-label semantics were iterated twice from user feedback. Final behaviour: **both** views show the best 1RM (`max(PR, latest estimate)`) as the end label; the **bar** differs — Sets shows the last working set, 1RM shows the current estimate. The `max(PR, est)` guard keeps the bar denominator correct after the earlier MAX→AVERAGE 1RM-estimation change. Bodyweight Sets labels the all-time max reps. Tests updated.

### Notes
- All 237 unit tests pass; `tsc`/`eslint` clean. Timeline, weights-summary, weekly-volume and workout-sessions/day routes exercised at runtime against the local dev DB (logged in as the seeded test user).
- Branch churn: PR #33 merged via auto-merge; #36 and #38 squash-merged after green CI. Local `origin/main` went stale mid-session (had to re-fetch + reset before each follow-up branch).

## Session 166 — Local-First Finally Operational On-Device + Workout Fixes (2026-06-30) ✅ Complete

### Headline
The local SQLite DB had **never opened on Android** since WAL was introduced — so despite all the local-first code, the app silently ran network-only. On-device console logs (captured via `chrome://inspect`) revealed the cause: the **v4 migration ran `PRAGMA journal_mode=WAL` inside the Capacitor plugin's upgrade transaction**, which SQLite rejects (`cannot change into wal mode from within a transaction`). `initSQLite` threw on every open. Fixed → **confirmed working on the S25** (no `[initSQLite] failed`). The "v7 didn't apply on-device" theory from session 165 was a downstream symptom of this.

### What shipped (all via PR → CI → squash-merge)
- **#27 — WAL out of the migration transaction.** Removed `PRAGMA journal_mode=WAL` from v4 statements; set it once after `open()` with `execute(sql, /* transaction */ false)`, non-fatal. This is the fix that makes the local DB open.
- **#28 — local schema drift.** With the DB open, workout/sync inserts immediately failed (`table exercise_logs has no column named muscle_groups`). Added `exercise_logs.muscle_groups` / `inter_exercise_rest_sec` and `set_logs.set_start_ms` / `set_end_ms` (v8 migration + `reconcileSchema`). Audited every other domain insert vs schema — no further drift.
- **#19 — local-first reads + diagnostics.** Seeded the last two API-first screens (Oura section → `cachedFetch` + `readCacheSync`; activity card → seed in `useEffect`, hydration-safe). Added `reconcileSchema()` (idempotent post-open column/table self-heal) and `[initSQLite]`/`[reconcileSchema]` logging — **the logging is what surfaced the WAL root cause.**
- **#23 — month-end workout crash.** `aestMidnight(y, m, d+1)` built invalid dates like `2026-06-31` on a month's last day → `RangeError: Invalid time value` → 500 from `/api/workout-data?tab=<session>` and `/api/progress-summary` → pre-workout screen hung on skeletons. Normalized overflow via `Date.UTC`. Regression tests added. Confirmed fixed on device.
- **#26 — deleted workout lingered.** DELETE removed the exercise log but not the parent session → phantom "0 sets / 0 exercises" session in timeline/counts; and the client never invalidated summary caches. Now deletes the session when its last exercise goes (transaction) + `invalidateWorkoutSummaries()` on delete/edit + added `home-day-timeline` and `workout-sessions-day:` to that cache group.
- **#25 — home HR widget** now shares the Oura section's `oura-hr-day` / `workout-sessions-day` cache keys (was raw `fetch`, reloaded every visit).
- **#20 — CI skips root-level markdown.** `paths-ignore: '**/*.md'` → `'**.md'` (the `**/` form doesn't match repo-root files like `CLAUDE.md`).
- **#30 — CI cancels superseded runs** (`concurrency` group on `github.ref`).
- **#29 / docs** — v1.68.0 changelog + projectOverview.

### Backlog reconciliation
Confirmed two items long-marked "open" were already done: **Phase 10 (nav + friends)** and the **AI SDK CVE bump** (now `@ai-sdk/google ^3.0.86`).

### GitHub workflow hardening (repo settings, by user)
Squash-only merges (PR title as message); auto-delete head branches; secret scanning + Dependabot on; all 6 CI checks required on `main` (Lint, Type Check, Tests, Build, Custom Rules, Migration Check), "require up-to-date" deliberately off; block force-pushes + restrict deletions; Wiki/Projects off; stale branches cleaned (only `main` remains).

### Key lessons
- **Never put `PRAGMA journal_mode=WAL` in a migration `statements` array** — the Capacitor SQLite plugin wraps upgrades in a transaction and SQLite forbids the WAL switch there. Set it post-open with `transaction:false`. (Code comment added at the v4 migration.)
- Diagnostic logging on a silent native failure paid for itself — a one-line `console.error` in `initSQLite` cracked a months-old bug that no sandbox test could reach.
- `aestMidnight(y,m,d±1)` and similar must normalize calendar overflow (use `Date.UTC`) — naive day arithmetic breaks on month/year boundaries.
- ⚠️ **paths-ignore + required checks trap:** with all CI checks now required, a *markdown-only* PR skips CI (paths-ignore) so the required checks never report → the PR is blocked from merging. Route docs through a PR that also touches a non-md file, or revisit the CI gating (a single "all-green" gate job) if this becomes a nuisance.

### Files
`lib/sqlite/sqlite-service.ts`, `lib/sqlite/migrations.ts`, `lib/date-utils.ts` (+ test), `app/api/workout-entry/route.ts`, `app/stats/stats-content.tsx`, `lib/cache-groups.ts`, `components/health/oura-section.tsx`, `components/health/activity-history-card.tsx`, `app/session-select/session-select-content.tsx`, `.github/workflows/ci.yml`. PRs #19, #20, #23, #25, #26, #27, #28, #29, #30. Body Battery (v1.67.x) shipped same day via separate parallel work.

---

## Session 165 — Local-First Expansion + Stability Hotfix Marathon (2026-06-29) ✅ Complete

### What shipped
- **Local-first sync expansion (PR #11):** workout logging, Oura data, and personal records onto the unified sync engine (Phases 1–4); `projectOverview.md` (497 KB) split into a lean index + `docs/overview/history-*.md` archives; three scoped backlog plan docs under `docs/superpowers/plans/`.
- Then a chain of production incidents — all resolved (PRs #12–#16).

### Incident chain
1. **PR #12** added `'workout_log'` to the `/api/sync/push` domain enum (the one gate Phase 2 missed). On deploy a device pull-to-sync flushed a large accumulated outbox; each `workout_log` replay is heavy (~8 queries + 2 transactions), spiking the 20-connection pool. A **missing `pool.on('error')` handler** turned the connection errors into `unhandledRejection` → process **crash-loop**. Reverted (**PR #13**) to restore service.
2. **PR #14** re-enabled `workout_log` behind a `pool.on('error')` handler + chunked sync. Crash-loop gone, but the DB hit **connection saturation** (orphaned `idle in transaction` sessions from the crash-loop pinned slots). A Railway Postgres restart cleared it.
3. **PR #15** hardened the pool: `max` 20→10, `statement_timeout` + `idle_in_transaction_session_timeout`, plus `[pushMutations]` diagnostic logging.
4. **Workout-not-saving root cause:** HTTP logs showed `/api/complete-workout` + `/api/log-calendar-event` firing but **zero `/api/sync/push` or `/api/log-exercise`** — the device outbox never queued the `workout_log` mutation (v7 SQLite migration didn't apply on-device, so `logWorkoutLocally` throws). **PR #16** makes workout logging POST **directly to `/api/log-exercise`**, local write best-effort, outbox offline-only. Confirmed on device: workouts save and show on the calendar.

### Key lessons
- A `pg` `Pool` **must** keep its `error` handler + `statement_timeout`/`idle_in_transaction_session_timeout` — without them a transient DB blip becomes a crash-loop / permanent saturation. Now load-bearing in `lib/data/postgres/client.ts`.
- Re-enabling a heavy sync domain needs load-testing against a realistic outbox backlog before deploy.
- On-device Capacitor SQLite migrations can silently fail; never make a critical write path (logging) depend solely on the local store with no server fallback.

### Files
`lib/data/postgres/client.ts`, `lib/data/postgres/adapter.ts`, `lib/local-store/sync-engine.ts`, `app/api/sync/push/route.ts`, `components/workout-screen.tsx`, `lib/workout/log-exercise.ts` (+ Phase 1–4 files from PR #11). PRs #11–#16.

---

## Session 154 — Exercise Detection Frequency Fixes (2026-06-24) ✅ Complete

### Problem
User reported 38+ queued "Walk Detected" sessions including entries with 0m distance. Two separate root causes.

### Root cause 1 — Dedup bug (main cause of 38+)
`ExerciseDetectedCard`'s `useEffect` fetched all unreviewed Oura workouts on every page mount and called `addOuraSession()` without checking if that `ouraWorkoutId` was already in the Zustand persist store. Each app open duplicated the entire unreviewed list. Fixed by reading fresh store state inside the effect and checking `ouraWorkoutId` before adding.

### Root cause 2 — No quality or recency filters
- **0m distance**: Oura sometimes records workouts with null/0 distance (spurious ring detections). Fixed with `distanceM > 0` filter at DB level.
- **Short sessions**: Very brief Oura activities (< 5 min) included. Fixed with duration filter in API route.
- **Historical backlog**: Full Oura history could appear as unreviewed if user had done a `daysBack=90` sync. Fixed by limiting unreviewed query to last 30 days.

### Overlap prevention
Previous check (Oura skipped if a phone session overlaps in store) only worked while the phone session was still pending. If the phone session was saved first, the same walk could re-appear from Oura after the next sync. Fixed: saving a phone session now auto-marks any overlapping Oura sessions as reviewed in the DB and removes them from the store.

### Files changed
`components/activity/exercise-detected-card.tsx`, `components/activity/exercise-review-sheet.tsx`, `app/api/oura/workouts/route.ts`, `lib/data/postgres/adapter.ts`

---

## Session 150 — Pull-to-Sync Gesture + Silent Background Syncs (2026-06-24) ✅ Complete

### What was built

**Pull-to-sync gesture** (`components/pull-to-sync.tsx`)
- iOS-style pull-down indicator on Home, Health, and More screens
- Non-passive `touchmove` listener so `e.preventDefault()` can block native scroll while pulling
- `scrollTop <= 2` guard — gesture only activates at top of page, no conflict with normal scrolling
- 0.5× resistance factor; 72px indicator travel (≈144px physical drag) to trigger
- Phase system: `idle → pulling → ready → syncing` with Framer Motion animated indicator
- Indicator dismisses after 650ms; sync continues silently in background

**Full sync coverage on every pull**
- `pushMutations(userId)` — local SQLite mutations → Railway
- `drainOutbox()` — workout outbox → Railway
- `pullDelta(userId, true)` — Railway → local SQLite (force bypass throttle)
- `POST /api/oura/sync { daysBack: 7 }` — Oura Ring → Railway
- `invalidateCache('')` clears all API cache (preserves `ta_pref_*` preferences), then all screen data re-fetched in background

**Silent operation**
- No success toast — indicator spin+dismiss is sufficient visual feedback
- Error toast only if Oura sync network call rejects
- `HealthConnectProvider` also made fully silent (removed success + error toasts from background HC sync on app open)

### Files changed
`components/pull-to-sync.tsx` (new), `app/session-select/session-select-content.tsx`, `app/health/health-content.tsx`, `app/more/more-content.tsx`, `components/health-connect-provider.tsx`

---

## Session 148 — Health Screen Drag-to-Reorder + Home Card Widgets (2026-06-24) ✅ Complete

### What was built

**Health screen drag-to-reorder**
- All three tabs (Body, Training, Progress) are independently reorderable via drag-and-drop using `@dnd-kit/react`
- Order persisted per-tab in localStorage via `getHealthCardOrder` / `saveHealthCardOrder`
- Edit mode: a `LayoutGrid` button in the health page header toggles edit mode — grip handles appear on each card only when active, matching the home screen pattern exactly
- `SortableHealthCard` simplified: no permanent handle; `editMode` prop controls handle visibility; `touchAction: pan-y` during normal scroll, `none` only while dragging
- Removed the "Health Screen Cards" section from the More tab (no longer needed)

**Home card widgets (3 new)**
- **ACWR widget** (`acwrWidget`): Training load card showing the acute:chronic workload ratio, reusing the existing `renderBodySection("trainingLoad")` logic
- **Muscle Status widget** (`muscleStatusWidget`): Injury heatmap (`MuscleHeatmap`) colour-coded by recovery status, fetching from `/api/muscle-recovery`
- **HR Chart widget** (`hrChartWidget`): Full Oura intraday heart rate chart (identical to health screen — non-compact, same sleep/workout shading, same legend). Fetches `/api/oura/hr-day` and `/api/workout-sessions/day`. Respects colour swatch for the HR line
- Removed Primary/Secondary legend from `MuscleHeatmap` (conflicted with InjuryCard's Recovered/Recovering colours — only Injured label shown now)
- Home Widgets section in More tab simplified from grouped layout to flat `CARD_WIDGET_DEFS` list

**`HrDayChart` enhancements**
- Added `showLegend` prop (decoupled from `compact`) — legend controlled independently of chart sizing
- Legend Heart Rate line swatch now uses `resolvedLineColor` instead of hardcoded white
- Transparent/clear color swatch option added to all card widget color pickers

### Files changed
`components/health/sortable-health-card.tsx`, `app/health/health-content.tsx`, `components/more/home-widgets-section.tsx`, `components/more/profile-tab.tsx`, `components/muscle-heatmap.tsx`, `components/health/hr-day-chart.tsx`, `app/session-select/session-select-content.tsx`, `app/session-select/constants.ts`

---

## Session 147 — 24h HR Chart + Sleep Hypnogram (2026-06-23) ✅ Complete

### What was built

**24-hour Heart Rate chart (Oura section)**
- Full-day (midnight→midnight) HR data synced from Oura `heartrate` endpoint during every sync, stored in `oura_heartrate` table
- New `GET /api/oura/hr-day?date=YYYY-MM-DD` endpoint serves the day's readings
- `components/health/hr-day-chart.tsx` — Chart.js line chart with 5-min bucket averaging for a smooth line (eliminates 1-min noise spikes)
- Sleep window: indigo shaded band derived from Oura `source` field (`sleep`/`rest`)
- Workout window: orange shaded band derived from `GET /api/workout-sessions/day` — uses our own logged `startedAt`/`completedAt` so it shows regardless of whether Oura tagged the session as `workout` (it doesn't for gym sessions)
- Legend shows session name: "Workout: Push" instead of generic "Workout"

**Sleep hypnogram**
- New DB column `sleep_phase_5_min` (TEXT) on `sleep_sessions` — migration `093_sleep_phase.sql`
- Oura sync now includes `sleep_phase_5_min` from the sleep endpoint
- `SleepHypnogram` component in `health-metric-sheet.tsx` renders a flex timeline bar (Deep=indigo, Light=blue, REM=violet, Awake=amber) with 5 evenly-spaced time labels

**Home screen cache fix**
- `readCacheSync('readiness-score')` and `readCacheSync('workout-data:meta')` now read in `useLayoutEffect` (before first paint) on the home screen, eliminating the flash on repeat visits

**HR recovery workout chart fixes**
- Set markers were at wrong x positions: root cause was `CategoryScale` treating float minute values as array indices. Fixed by switching to `LinearScale` with `{x, y}` point format
- Replaced `S1`/`S2` text labels with colour-coded exercise name legend below the chart

### Files changed
`components/health/hr-day-chart.tsx` (new), `components/health/oura-section.tsx`, `components/health-metric-sheet.tsx`, `app/api/oura/hr-day/route.ts` (new), `app/api/oura/sync/route.ts`, `app/api/workout-sessions/day/route.ts` (new), `app/api/sleep-sessions/route.ts`, `lib/data/postgres/migrations/093_sleep_phase.sql` (new), `lib/data/postgres/schema.ts`, `lib/data/postgres/adapter.ts`, `lib/data/repository.ts`, `lib/oura/client.ts`, `lib/oura/types.ts`, `lib/types/body.ts`, `app/health/health-content.tsx`, `components/workout/hr-recovery-chart.tsx`, `app/session-select/session-select-content.tsx`

---

## Session 136 — Bug-fixing pass: Health/Progress crash, supplement safe-area, config back nav (2026-06-18) ✅ Complete

Shipped v1.50.3: three device-reported bugs fixed.

### Bugs fixed

**Bug 1 — Health > Progress application error (crash)**
- Root cause: `SparklineChart` (`components/ui/sparkline-chart.tsx`) calls `ChartJS.register(...)` at module level. When Next.js SSR'd the Progress tab, this side-effect ran on the server where `chart.js` isn't safe, causing the application error.
- Fix: changed `StrengthTrendCard` from a static import to `dynamic(() => import(...), { ssr: false })` in `app/health/health-content.tsx`, preventing the module from loading during SSR.

**Bug 2 — "Add Supplement" button overlapping device navigation bar**
- Root cause: button container `<div className="p-4 pt-0 shrink-0">` had no safe-area padding.
- Fix: added `pb-[max(1rem,env(safe-area-inset-bottom))]` — gives default 1rem on desktop, expands to clear the device nav bar on S25 Ultra.
- File: `components/nutrition/manage-supplements-sheet.tsx`

**Bug 3 — Back button in Workout Config does nothing**
- Root cause: `router.push('/more?tab=profile')` switched the More page to the Profile tab internally — no visible page transition, felt like a no-op.
- Fix: changed to `router.back()` for proper browser history navigation.
- File: `components/config-screen.tsx`

---

## Session 135 — C-SESSION-1 cache migration, TS error fix, plan housekeeping (2026-06-18) ✅ Complete

Shipped v1.50.2: migrated workout-card prefetch from raw sessionStorage to `cachedFetch`, resolved 32 pre-existing TypeScript errors, and marked all plan docs completed.

### 1. C-SESSION-1 — workout-card cache key migration

Replaced raw `sessionStorage.setItem/getItem('ta_wc_${sess.id}', ...)` throughout the codebase with the `cachedFetch` / `readCacheSync` / `invalidateCache` infrastructure from `lib/sqlite/cache.ts`. Benefits: automatic SQLite persistence on APK, localStorage fallback on web, TTL management, and consistent key-space under `workout-card:${sess.id}`.

**Files changed:**
- `app/session-select/session-select-content.tsx` — prefetch now calls `cachedFetch('workout-card:${sess.id}', url, TTL_LONG, () => {})` instead of raw fetch + `sessionStorage.setItem`
- `app/session-select/components/recommendation-card.tsx` — `lastSessionDay()` reads via `readCacheSync('workout-card:${sess.id}')` instead of `sessionStorage.getItem('ta_wc_${sess.id}')` + `JSON.parse`
- `app/workout-select/workout-select-content.tsx` — both the `getLastTrainedLabel()` read path and the prefetch write path updated to the new key
- `components/workout-screen.tsx` — single-session invalidation on workout log uses `invalidateCache('workout-card:${programSessionId}')` instead of `sessionStorage.removeItem('ta_wc_...')`
- `lib/utils.ts` — `invalidateWorkoutCardCache()` updated to clear `ta_sscache:workout-card:*` (sessionStorage mirror) and `ta_cache:workout-card:*` (localStorage) instead of the old `ta_wc_*` keys

### 2. TypeScript "cannot find module" errors resolved

32 pre-existing TS errors (`@capacitor/*`, `dexie`, `@mapbox/polyline`, `react-leaflet`) were all missing from node_modules — the packages were already in `package.json` and `pnpm-lock.yaml` but the container hadn't run `pnpm install`. Running `pnpm install` populated node_modules and reduced TS errors from 32 to 0.

### 3. Plan doc housekeeping

Prepended `✅ COMPLETED` banner to all 8 outstanding plan docs in `docs/superpowers/plans/`:
- `2026-06-17-per-session-phase-tracking.md`
- `2026-06-08-nav-restructure-friends-system.md`
- `2026-06-12-uplift-batched-execution-plan.md`
- `2026-06-17-consolidated-remaining-sprints.md`
- `2026-06-11-activity-gps-tracking-and-live-ui.md`
- `2026-06-11-dynamic-wallpaper-backgrounds-data-settings.md`
- `2026-06-11-dynamic-wallpaper-backgrounds-visuals.md`
- `2026-05-31-nutrition-scanning.md`

---

## Session 134 — Bug fixes, Dexie fast-path, Radix Sheet migration (2026-06-18) ✅ Complete

Shipped v1.50.1: two logic bug fixes, one performance improvement, and an accessibility/UX refactor migrating three bottom sheets to Radix.

### 1. 1RM estimation bug fix (`lib/1rm.ts`)
- **Bug:** sets with reps > 30 were capped to 30 before being passed to the estimation formula, meaning they still contributed an inflated 1RM estimate (`repFactor(30) ≈ 3.57` × weight).
- **Fix:** `if (!(w && r) || r > 30) return 0` — high-rep sets are now excluded entirely from the estimate. Only sets with 1–30 reps contribute.

### 2. Working-mode strength bar label fix (`lib/health/strength-progress.ts`)
- **Bug:** `computeBarMetric` in working mode returned `estimated1rm` (e.g. 96 kg) in the right-hand label instead of the actual working weight (e.g. 92.5 kg).
- **Fix:** `const label = \`${ex.weight} kg\`` — label now correctly shows the working set weight.

### 3. Body metrics Dexie fast-path (`app/health/health-content.tsx`)
- Health page now seeds `metaRecent` from `store.getBodyMetrics(cutoffStr)` (last 30 days from IndexedDB) before the `cachedFetch` network response arrives — same fast-path pattern already in use for sleep sessions. Eliminates blank state while fetching on the Body tab.

### 4. Radix Sheet migration (`components/nutrition/food-library-sheet.tsx`, `food-logger-sheet.tsx`, `components/chat-overlay.tsx`)
- Replaced all three hand-rolled `fixed inset-x-0 bottom-0` bottom-sheet overlays with Radix `<Sheet side="bottom">`. Benefits: focus-trap, ARIA dialog semantics, animated slide-in/out transitions, overlay backdrop, and Android back-button dismiss — all provided by Radix automatically.

---

## Session 133 — Batch A+B Features (2026-06-18) ✅ Complete

Shipped five features from the batch A+B spec (v1.50.0).

### 1. Calendar legend truncation fix
- `components/calendar-widget.tsx` — added `truncate max-w-[96px]` to legend session name span; long names no longer overflow the legend row.

### 2. Feedback submission system
- **DB**: migration `074_feedback_submissions.sql` — `feedback_submissions` table (`type` CHECK bug/feature/other, `title`, `description`, `screenshot_data TEXT`)
- **API**: `POST /api/feedback` (any auth'd user), `GET /api/admin/feedback`, `DELETE /api/admin/feedback/[id]`; `GET /api/admin/pending-count` now returns `{ count, feedbackCount }`
- **User UI**: `components/more/feedback-sheet.tsx` — type chips, title, description, optional screenshot with client-side JPEG compression (canvas, max 800px wide); `components/more/feedback-section.tsx` — section wrapper with "Report an Issue" button; both wired into `components/more/profile-tab.tsx` above Admin Console with blue badge showing unread count
- **Admin UI**: `app/admin/admin-content.tsx` — new "Feedback" tab with expandable rows, type-chip colours (red=bug, blue=feature, grey=other), 2-step delete confirm, badge on tab button

### 3. Injury log
- **DB**: migration `075_injuries.sql` — `injuries` table (`muscle_name`, `severity` CHECK mild/moderate/severe, `started_date`, `resolved_date`)
- **API**: `GET /POST /api/injuries`, `PATCH /DELETE /api/injuries/[id]`
- **Heatmap**: `components/muscle-heatmap.tsx` — added `'injured'` role with `INJURED_COLOR = "#ef4444"`; injured activations take precedence over primary/secondary; legend shows Injured chip when injuries present
- **Health card**: `components/health/injury-card.tsx` — MuscleHeatmap with injuries in red, active injury list with severity chips and "Day N" counter, resolved injuries toggle; `components/health/injury-sheet.tsx` — add/edit form with 17-muscle picker, severity chips, date input, notes, mark-as-resolved and delete; wired into `app/health/health-content.tsx` Body tab
- **Workout warning**: `components/workout-screen.tsx` fetches active injuries on load; `components/workout/active-workout-screen.tsx` renders amber banner when current exercise's muscles overlap active injuries

### 4. Supplement log
- **DB**: migrations `076_supplements.sql` — `supplements` + `supplement_logs` tables (unique on `supplement_id, log_date`)
- **API**: `GET /POST /api/supplements`, `PATCH /DELETE /api/supplements/[id]`, `POST /DELETE /api/supplements/[id]/log`
- **UI**: `components/nutrition/supplements-section.tsx` — daily checklist with green checkbox + strikethrough on log; `components/nutrition/manage-supplements-sheet.tsx` — list with active toggle, add/edit sub-form with name, dose, reminder enable/time; wired into `app/nutrition/nutrition-content.tsx` below weekly chart
- **Reminder lib**: `lib/supplement-reminders.ts` — `computeSupplementReminderActions()` fires AT reminder time (not end-of-window), notification IDs 8500–8699; `reconcileSupplementReminders()` + `cancelSupplementReminder()`; 11 Vitest unit tests all passing (`lib/__tests__/supplement-reminders.test.ts`)

### 5. Supplement reminders wired into SyncProvider
- `components/sync-provider.tsx` — added `reconcileSupplementReminders` `useEffect` on app open and resume, matching the meal/workout reminder pattern

**New types/interfaces**: `lib/types/injury.ts`, `lib/types/supplement.ts`

⚠️ On-device APK verification pending for supplement + injury notifications.

---

## Session 132 (cont.) — Strength Trend Card (2026-06-17) ✅ Complete

Shipped Health > Progress tab: **Strength Trend card** showing 90-day 1RM history sparklines for each exercise in the active program (v1.49.0).

**Files changed:**
- `app/api/strength-trend/route.ts` (**new**) — GET endpoint; pulls up to 12 exercises from active program (program order, deduped); single bulk SQL groups daily `MAX(estimated_1rm)` by exercise name + session date (AT TIME ZONE) for last 90 days; returns `StrengthTrendEntry[]` with `history`, `currentRm`, `peakRm`, `startRm`, `gainPct`; only exercises with ≥2 data points are included
- `components/health/strength-trend-card.tsx` (**new**) — swipeable exercise navigator (ChevronLeft/Right); current 1RM in brand color, % gain in green/amber/red; SparklineChart below; 90d-low + peak footer; dot pagination
- `app/health/health-content.tsx` — imports card, adds `strengthTrend` state, fetches via `cachedFetch('strength-trend')`, renders at top of Progress tab above StrengthProgressCard
- `lib/changelog.ts` + `package.json` — bumped to v1.49.0

---

## Session 132 (cont.) — Done Screen + Stats Improvements (2026-06-17) ✅ Complete

Shipped three accuracy/UX improvements (v1.48.0).

**Files changed:**
- `components/workout-screen.tsx` — computes `totalVolumeKg` (weights×reps from `sessionLog`) and `totalSets` (actual logged sets from `sessionLog`); passes both to `DoneScreen`
- `components/workout/done-screen.tsx` — replaces "Est. kcal" with real Volume stat; uses actual sets count; share text now includes sets + volume + PR names; PR trophy card has a top-right share icon and per-row hover share button for individual PR sharing (F-5 ✅)
- `app/api/weekly-stats/route.ts` — adds `totalVolumeKg` field (sum of per-day volumes, no extra DB query)
- `components/stats/weekly-stats-hub.tsx` — replaces "Avg Intensity" stat card (often `—`) with "Volume" showing total kg lifted this week

---

## Session 132 — Weekly Muscle Volume Card (2026-06-17) ✅ Complete

Shipped Health > Training tab: **Weekly Volume card** showing sets per muscle group vs. the 10–20 sets/week hypertrophy target (v1.47.0).

**Files changed:**
- `app/api/weekly-muscle-sets/route.ts` (**new**) — GET endpoint; unnests `exercise_logs.muscle_groups` joined to `set_logs`, scoped to current Mon–Sun week in user's timezone; returns `{ muscles: MuscleSetsEntry[], weekStart: string }`
- `components/health/weekly-muscle-sets-card.tsx` (**new**) — horizontal progress bars per muscle; green ≥10 sets, amber 6–9, red <6; target-minimum marker at 10-set line; loading skeleton + empty state
- `app/health/health-content.tsx` — imports card, adds `muscleSets` state, fetches via `cachedFetch('weekly-muscle-sets')`, renders between `WeeklyStatsHub` and `WeeklySummaryCard` in Training tab
- `lib/cache-groups.ts` — `invalidateWorkoutSummaries` now also invalidates `weekly-muscle-sets`

---

## Session 131 — Workout Reminder Notifications (2026-06-17) ✅ Complete

Implemented F-3: daily workout reminder notifications (v1.45.0).

**Files changed:**
- `lib/data/postgres/migrations/072_schedules_reminders.sql` — adds `reminder_enabled BOOLEAN NOT NULL DEFAULT false` and `reminder_time TEXT` to `schedules`
- `lib/data/postgres/schema.ts` — Drizzle schema updated
- `lib/types/program.ts` — `Schedule` and `NextSessionRecommendation` extended with `reminderEnabled?` / `reminderTime?`
- `lib/data/postgres/adapter.ts` — `getNextSession` returns reminder fields on all return paths; `saveProgram` persists reminder fields through the schedule upsert
- `lib/workout-reminders.ts` (**new**) — `computeWorkoutReminderAction` (pure, 8 unit tests), `reconcileWorkoutReminder`, `cancelWorkoutReminder`
- `lib/__tests__/workout-reminders.test.ts` (**new**) — 8 Vitest tests covering cancel/skip/schedule/immediate cases, all passing
- `components/sync-provider.tsx` — reconciles on app open and on network-restore/resume events
- `components/workout-screen.tsx` — `cancelWorkoutReminder()` called on workout start
- `components/config/program-editor-sheet.tsx` — reminder toggle + time picker in the schedule section (hidden for auto mode)
- `components/config-screen.tsx` — state + load/save wired up; props passed to ProgramEditorSheet

⚠️ On-device APK verification pending (notification channel `workout-reminders`, ID 8000).

---

## Session 130 — Consolidated Sprint Execution (Sprints 2–10) (2026-06-17) ✅ Complete

Executed Sprints 2–10 from `docs/superpowers/plans/2026-06-17-consolidated-remaining-sprints.md`. Bumped to **v1.43.0**.

### Sprint 2 — Cache Correctness (C-DD-8, C-SESSION-2)
- `app/stats/stats-content.tsx`: replaced 3 bare `fetch()` + manual `sessionStorage` blocks with `cachedFetch` (stale-while-revalidate, dedupes in-flight). ~30 lines of manual TTL logic removed.
- `components/workout/active-workout-screen.tsx`: exercise history fetch now uses `cachedFetch` with per-exercise cache key.

### Sprint 3 — UI Polish
All 13 items were already done. No code changes.

### Sprint 4 — Performance (P-DD-3, P-DD-4)
- `lib/data/postgres/adapter.ts`: login style-seeding replaced N individual SELECTs with one query + Set lookup (O(1) per style).
- `app/health/health-content.tsx`: BMI/BF% classification, weight trend regression, and Mifflin-St Jeor energy balance wrapped in `useMemo`.

### Sprint 5 — Security
All 4 items were already done. No code changes.

### Sprint 6 — UI Debt (U-DD-1, U-DD-3)
- `components/nutrition/quick-edit-log-sheet.tsx`: migrated from hand-rolled fixed-position overlay to Radix `<Sheet side="bottom">` — focus trap, slide animation, back-dismiss.
- `app/nutrition/nutrition-content.tsx`: `handleConfirmDelete` now awaits the DELETE fetch and shows `toast.error()` on failure.

### Sprint 7 — Sync Code (N-DD-6, N-DD-7, LS-4)
- `lib/notifications.ts`: extracted `computeRestNotificationAction` pure function + `RestNotificationAction` type.
- `components/workout-screen.tsx`: rest-timer `useEffect` now delegates to `computeRestNotificationAction`.
- `lib/__tests__/notifications.test.ts`: 5 new Vitest unit tests for the pure function.
- `lib/health-connect-sync.ts`: exported `LAST_SYNC_KEY`, `HC_SYNC_READ_TYPES`, `HC_ENRICH_READ_TYPES`; replaced inline arrays in both `requestPermissions` calls.
- `lib/__tests__/health-connect-sync.test.ts`: added 3 HC_READ_TYPES parity tests to catch future drift.
- `components/more/profile-tab.tsx`: "Sync now" button in About section — clears `LAST_SYNC_KEY` (forces cold 30-day HC re-sync) then calls `pullDelta`.

### Sprint 8 — Component Breakup (CB-2, CB-3, CB-4, CB-5, CB-6, CB-7)
All pure refactors, no behavior change. CB-1 (adapter.ts) deferred.

| Item | File | Extracted to |
|------|------|-------------|
| CB-4 | `app/health/health-content.tsx` | `app/health/components/` (WeightSparkline, LeanMassSparkline) + `app/health/hooks/` (useBmiClassification, useWeightTrend, useEnergyBalance) |
| CB-5 | `components/workout-builder/builder-wizard.tsx` | `components/workout-builder/goal-spectrum.tsx` (GoalSpectrum + GOAL_SPECTRUM) |
| CB-6 | `components/more/profile-tab.tsx` | `components/more/stats-grid.tsx`, `components/more/achievements-section.tsx` |
| CB-7 | `components/chat.tsx` | `components/chat/session-suggestions.ts`, `components/chat/weights-panel.tsx` |
| CB-3 | `app/session-select/session-select-content.tsx` | `app/session-select/components/` (4 widget cards: recommendation, streak, week-strip, metric-tiles); −251 lines |
| CB-2 | `components/config-screen.tsx` | `components/config/` (StyleEditorSheet, PhaseSetEditorSheet, ProgramEditorSheet); −767 lines (45% reduction) |

### Sprint 9 — Nav Restructure + Friends
All 44/45 items were already done from a previous session. No code changes this session. The one remaining item (Task 14: `home-dashboard.tsx` extraction) is a cosmetic refactor — the functionality already exists via separate `session-select-content.tsx` (home) and `workout-select-content.tsx` (workout tab).

### Sprint 10 — Health Connect Bug Fixes (N-DD-3, N-DD-4, N-DD-5)
- **N-DD-3**: Added `TotalCaloriesBurned` to `HC_SYNC_READ_TYPES`; gated both `aggregateRecords(TotalCaloriesBurned)` calls behind `canRead.has('TotalCaloriesBurned')`.
- **N-DD-4**: Changed `HeartRateVariabilitySdnn` → `HeartRateVariabilityRmssd` (correct HC type) in both `canRead.has()` and `readRecords` calls.
- **N-DD-5**: Added `App.addListener('appStateChange')` in `workout-screen.tsx` — re-derives rest-timer remaining time when app resumes from background and reconciles the scheduled notification.
- Parity tests updated to cover `TotalCaloriesBurned` and `HeartRateVariabilityRmssd`.

### Sprint 11 — Device-Only Validation
No code changes. Requires on-device testing on Samsung Galaxy S25 Ultra:
- Verify `trainingai-local-db` IndexedDB populates correctly
- Confirm body weight log → Dexie write → outbox push → Railway sync
- Confirm calories-burned, RMSSD HRV, and app-resume notification reconciliation

### Known Issues (updated)
- **CB-1 (adapter.ts split)**: Deferred — at 3139 lines, extracting methods from a monolithic Drizzle class is high-risk without dedicated testing. Nutrition + Social slices should be extracted in a future dedicated session.
- **Sprint 11**: On-device validation pending (device-only, no sandbox).

---

## Session 130 (cont.) — Lean-Mass Nutrition + Calendar Legend Fix (2026-06-17) ✅ Complete

### Lean-mass-aware nutrition goal recommendations

When the user has a recent body fat % logged, the AI nutrition goal recommendation now uses more accurate formulas:
- **BMR**: Katch-McArdle (`370 + 21.6 × leanMassKg`) instead of Mifflin-St Jeor when BF% is available
- **Protein**: dosed per kg lean mass (not total bodyweight) — significantly more accurate at higher body fat

**Files changed:**
- `lib/nutrition/goal-recommendation.ts` — `BaselineInput` gains optional `bodyFatPct?`, `BaselineResult` gains optional `leanMassKg?`; `calculateBaseline` uses Katch-McArdle + lean-mass protein when BF% provided
- `app/api/nutrition-goals/recommend/route.ts` — extracts `latestBodyFatPct` from body_metrics, passes to both `calculateBaseline` calls; updates AI context string to include "Katch-McArdle, lean mass Xkg"
- `lib/nutrition/__tests__/goal-recommendation.test.ts` — 3 new tests (Katch-McArdle path, high-BF comparison, `leanMassKg` undefined when no BF%)

**Branch:** `feat/lean-mass-nutrition` → merged to main (commit `ea3997b`).

### Calendar legend wrap fix

`CalendarWidget`'s session legend at the bottom now uses `flex-wrap` so 4+ sessions don't overflow on narrow screens. `WeeklyStatsHub`'s legend already had `flex-wrap`; now consistent.

**File changed:** `components/calendar-widget.tsx` — added `flex-wrap gap-y-1` to legend container.

Bumped to **v1.44.0**.

---

## Session 129 — Per-Session Phase Tracking + Plan Review (2026-06-17) ✅ Complete

### Plan review and archiving

Reviewed all 67 MD files in `docs/superpowers/plans/`. Marked 46 completed plan files with `✅ COMPLETED` banners. Created `docs/superpowers/plans/2026-06-17-consolidated-remaining-sprints.md` — a merged sprint plan combining the uplift batched execution plan (21 tasks) and master review Sprints 4–7, organised into three testability tiers:
- **TIER 1 🟢 (Sprints 1–9):** Fully testable with `pnpm dev` + local Postgres — per-session phase tracking, cache/logic fixes, UI polish, performance, security, accessibility, sync code, component breakup, nav+friends
- **TIER 2 🟡 (Sprint 10):** Code verifiable locally, device needed for final verification (Health Connect permissions, HRV key, App.resume)
- **TIER 3 🔴 (Sprint 11):** Device-only (on-device Dexie, outbox unification, nutrition local-first)

### Per-session phase tracking (Sprint 1)

Fixed the core correctness bug where the phase engine used a global session count across all session types, causing all sessions to advance phases in lockstep. If a user repeats Push before doing Pull or Legs, the global count would tick over and Legs would enter Accumulation having never been baselined.

**Fix:** Each program session now independently tracks its own cycle count. Push progresses by counting Push sessions only; Legs by counting Legs sessions only.

**Files changed:**

| File | Change |
|------|--------|
| `lib/data/repository.ts` | Added `countAllSessionsSinceStart` to interface |
| `lib/data/postgres/adapter.ts` | Implemented `countAllSessionsSinceStart` (single GROUP BY query); relaxed `sessionsPerCycle` guard in `getActiveProgramWithPhases` |
| `app/api/workout-data/route.ts` | Added `PerSessionPhaseStatus` interface; session path uses per-session count + `sessionsPerCycle=1`; meta path returns `perSessionPhaseStatus[]` array + leader `phaseStatus` |
| `app/api/log-exercise/route.ts` | Uses per-session count for the session being logged |
| `app/api/sync-workout/route.ts` | Per-session count map instead of single total counter; increments per session name on new inserts |
| `components/workout-screen.tsx` | Cache fix: `invalidateCache('workout-data:meta')` → `invalidateCache('workout-data')` (clears all session-specific caches too); captures phase at workout start; detects phase change post-completion; fires phase-completion banner |
| `app/workout-select/workout-select-content.tsx` | Phase badge on home card shows the currently displayed session's own phase |
| `app/session-select/session-select-content.tsx` | Recommended session card shows per-session phase; progress bar simplified to `cycleInPhase-1 / totalPhaseCycles` |
| `components/workout/done-screen.tsx` | Phase completion banner prop — shown when session advances to a new phase after workout |

**No DB migration needed** — `workout_sessions.session_name` was already stored; `countAllSessionsSinceStart` uses a GROUP BY on that column to recover per-session counts from existing history.

**Branch:** `claude/review-implementation-plans-motpab` → merged to main.

---

## Session 128 — Fix Food Logging "Failed to save food item" (2026-06-17) ✅ Complete

Every attempt to log a food item via scan or manual entry was silently failing with "Failed to save food item".

**Root cause:** The `POST /api/nutrition/food-items` route uses `z.string().optional()` for `brand` and `barcode`, which accepts `string | undefined` but not `null`. The client was sending `brand: null` (whenever the brand field was left empty) and `barcode: null` (always hardcoded). Zod returned a 400, `foodItemId` stayed null, and the error toast appeared. The `handleAddFood` path (Add Food tab) had the same `barcode: null` bug.

**Fix:** In `components/nutrition/food-logger-sheet.tsx`, changed `brand: form.brand.trim() || null` → `|| undefined` and removed both `barcode: null` fields. `JSON.stringify` omits `undefined` values, so zod receives those fields as absent, which `.optional()` correctly accepts.

**Files changed:** `components/nutrition/food-logger-sheet.tsx` (1 insertion, 3 deletions)

**Branch:** `claude/food-logging-save-failure-hl81da` → merged to main as v1.42.4.

---

## Session 127 — Fix 1RM UI Inconsistency (prescriptionFactor not reflected in calculator/rep targets) ✅ Complete

Three places in the workout UI were using raw Epley/Brzycki formula without the `prescriptionFactor` that is applied at log time. This caused all three to show a **lower** 1RM estimate than what the app actually stores, making it look like the prescribed work would weaken the lifter over time.

**Root cause recap:** The `prescriptionFactor` fix (session ~120, commit `9ddf214`) ensures that logging exactly the prescribed reps at the prescribed weight reproduces a stable 1RM (no decay). Without it, doing e.g. 100 kg × 6 reps at an 80%/6-rep prescription would store `calc1RM(100, 6) = 118 kg` — a 7 kg drop each session. With it, the same set correctly stores 125 kg (maintaining).

The three UI fixes:

**1. Built-in 1RM calculator (`one-rm-calculator-dialog.tsx`)**

The calculator icon (top right in the active workout screen) was calling `calc1RM(weight, reps)` with no knowledge of the current progression style. Entering 100 kg × 6 reps showed **118 kg** — less than the stored 1RM of 125 — which is exactly what prompted the question "why does the prescription make me weaker?".

Fix: calculator now accepts the exercise's `progressionStyle` prop from `ActiveWorkoutScreen`. When a style is present, it calls `calculate1RM([w], [r], [highestPctSet])` (prescriptionFactor-aware) and labels the result **"Logged Estimate"** with the raw formula shown underneath as secondary. Exercises without a style show raw `calc1RM` as before.

**2. Exercise stats sheet rep targets (`exercise-stats-sheet.tsx`)**

The pre-workout stats sheet (tap any exercise on the pre-workout list) shows "Rep targets at X kg" with Below / Match / Beat 1RM rows. It was using Epley-only inversion (`repsForTarget = round((1RM/weight - 1) × 30)`) giving **8 reps to match** at 100 kg for a 125 kg 1RM. With prescriptionFactor, only 6 reps is needed to maintain and 7 to beat.

Fix: when a progression style is present, `matchReps` is set to the highest-% set's prescribed reps (prescriptionFactor guarantees this is the maintain threshold), and `estFn` calls `calculate1RM` for each row. Result: 5/6/7 reps shown instead of 7/8/9.

**3. Active workout ready screen (`active-workout-screen.tsx`)**

The per-exercise "ready" screen (before you tap Start for each exercise) showed SET TARGETS (e.g. 100 kg × 6 reps) with no context about what achieving that meant for 1RM.

Fix: added a hint line beneath the SET TARGETS list: **"6 reps = maintain 1RM · 7+ reps = beat it ⚡"**, computed from the highest-% set's prescribed reps.

**Branch:** `claude/hip-thrust-1rm-logic-mj10lc` → merged to main.

⚠️ **Potential issues to watch:**

- **Calculator with off-prescription weights:** The prescription-adjusted estimate in the calculator assumes the entered weight IS the prescribed % of the user's 1RM. This is accurate when the pre-filled weight is used, but if the user scrolls the dial far from the prescribed weight (e.g. testing a hypothetical 50 kg set when 100 kg is prescribed), the adjusted estimate will still apply prescriptionFactor as if that weight were 80% of their max — which is technically consistent but may feel counterintuitive. The raw formula result shown underneath is the honest fallback for arbitrary weights.

- **Rounding edge case in "Match 1RM" reps:** The stats sheet sets `matchReps = prescribedReps` on the assumption that doing exactly prescribed reps at the prescribed weight reproduces the 1RM. This is exactly true only when `mround125(estimated1rm × pct/100) = estimated1rm × pct/100` with no rounding. When mround125 rounds DOWN (e.g. 1RM=127 → 80% = 101.6 → mround125 = 101.25), doing prescribed reps will give a 1RM fractionally below 127. Sub-1 kg difference in practice; not worth addressing unless it causes confusion.

- **Styles with mixed prescribed reps across sets:** The hint line and stats sheet "Match 1RM" both use the highest-% set's `reps` as the maintain threshold. For styles where different sets have different rep targets (e.g. 6/6/8/8), the hint reflects the highest-% set only. If the higher-% sets happen to have fewer reps than lower-% sets, the threshold shown may not apply equally to all sets.

- **No style assigned:** Exercises without a progression style still use raw `calc1RM` in both the calculator and stats sheet — same as before, no regression.

---

## Session 128 — Fix Stale Confetti on Reopen + Config Save Spinner (2026-06-17) ✅ Complete

Two UI bugs reported after the production crash fixes.

**Bug 1 — Confetti fires on workout reopen**

Root cause: `DoneScreen` fires confetti in a `useEffect` on every mount. Zustand's `persist` middleware was saving `mode = "done"` to localStorage. On next app open, the store rehydrated to `mode = "done"`, `DoneScreen` mounted and fired confetti before `WorkoutScreen`'s cleanup `useEffect` could reset the mode. Appeared as: opening the Push workout tab showed a celebration screen from a previous (different) session.

Fix: `lib/stores/workout-store.ts` — `onRehydrateStorage` now resets `mode = "done"` to `"pre"` alongside `"exercise-summary"`. Both are transient UI states that should never survive an app restart.

**Bug 2 — Config save spinner holds for ~1s after success**

Root cause: `saveProgram` and `deleteProgramById` in `components/config-screen.tsx` both `await load()` before the `finally { setProgramSaving(false) }` block ran. `load()` makes 4 parallel `cachedFetch` calls to cold-cache endpoints (cache was just invalidated by `invalidateProgramStructure()`). The save/delete button stayed in loading state through the full network round-trip for all 4 calls.

Fix: `load()` is now fire-and-forget in both functions. The spinner clears immediately after the API call succeeds; the program list refreshes in the background.

**Commit:** `1d0225a`

---

## Session 126b — Fix Production Workout Summary Crashes (2026-06-17) ✅ Complete

Diagnosed and fixed three production crash scenarios all triggered during or after the exercise-summary screen in the workout flow.

**Crash #1 — haptics webpackIgnore causing "Application error" mid-workout (fixed in commit 2f8b7de)**

Root cause: `lib/haptics.ts` had `/* webpackIgnore: true */` on both `@capacitor/core` and `@capacitor/haptics` dynamic imports. webpack emitted a native `import()` for these in the web bundle; browsers cannot resolve bare module specifiers without an import map, so they threw a `TypeError`. This rejection was not caught, so React's unhandled-rejection handler surfaced it as the global "Application error" page. Applied to all three haptic functions (`hapticTick`, `hapticLight`, `hapticSuccess`).

Fix: removed `webpackIgnore` from both imports in all three functions; wrapped the full body of each in a top-level `try/catch {}` so any future import failure is silently swallowed.

**Crash #2 — exercise-summary screen crash on app reopen with stale persisted state (fixed in commit 01a0800)**

Root cause: Zustand's `persist` middleware saves `mode` and `summaryData` to localStorage. When the user opened the app the day after a workout, it rehydrated to `mode = "exercise-summary"` from the previous session. `ExerciseSummaryScreen` then rendered with a stale `summaryData` that was missing fields added in newer schema versions (e.g. `lapTimes: undefined` instead of `[]`), causing a `TypeError` during render.

Fix: `onRehydrateStorage` in `workout-store.ts` now resets `mode → 'pre'` and `summaryData → null` when the rehydrated mode is `'exercise-summary'`. Also added defensive optional chaining (`sw?.[i]`, `sr?.[i]`, `slt?.[i]`) in `ExerciseSummaryScreen` as belt-and-suspenders.

**Crash #3 — exercise-summary crash even with fresh workout data**

Root cause: same as Crash #1. `hapticLight()` is called fire-and-forget before `store.setMode("exercise-summary")`. With the old `webpackIgnore` code, `hapticLight()` threw an unhandled rejection asynchronously. The mode transition happened first (showing the summary screen briefly), then the unhandled rejection propagated to Next.js's error boundary — making it appear to crash at the summary screen rather than during logging.

Fix: same haptics fix (2f8b7de) resolves this.

**Defensive fix (this session):** Added try-catch around the first `writeLocalWorkout(offlinePayload, false)` call in `handleCompleteSet`. On the native Android platform, if SQLite throws during the offline snapshot write (schema mismatch, DB full, etc.), the error previously propagated as an unhandled rejection from the async callback. Now it's caught and logged as a warning, and the rest of the flow (API call, summary screen) continues.

**Commits on main:** 2f8b7de (haptics), 01a0800 (store + optional chaining)

---

## Session 126 — Sprint 1: Security + Correctness (2026-06-16) ✅ Complete

Full security and correctness sweep per the master implementation plan created in session 125. All items landed in a single branch (`fix/sprint-1-security-correctness`), merged to main as v1.42.1.

**Security fixes:**

1. **Phase-set IDOR (S-DD-1)** — `app/api/phase-sets/[id]/route.ts` PUT now validates that `primaryStyleId`/`secondaryStyleId` belong to the caller's own progression styles before writing. Previously, a crafted request could pin another tenant's style config into your phase set.

2. **Food-log IDOR (S-DD-2)** — `app/api/nutrition/food-logs/route.ts` POST now runs a single batched SQL query verifying that both `mealTypeId` and `foodItemId` belong to the session user before inserting the log. Previously a crafted POST could reference another user's food data and surface it in joined reads.

3. **Sign-out cache wipe (C-DD-1)** — `lib/sqlite/cache.ts` now exports `clearAllCache()` (wipes SQLite `api_cache` table + all `ta_cache:`/`ta_sscache:` localStorage/sessionStorage keys + any other `ta_*` keys). `lib/local-store/dexie-backend.ts` exports `destroyLocalStore(userId)` (deletes the per-user Dexie IndexedDB). Both are called in `components/more/profile-tab.tsx` before the server-side sign-out redirect. Prevents cross-user data leaks on shared devices.

4. **Rate-limiting gaps (S-DD-5)** — barcode GET (`/api/nutrition/barcode`) now rate-limits to 30 req/min per user (was unthrottled against Open Food Facts). Mood POST (`/api/mood`) now rate-limits to 60 req/min per user.

5. **Image size byte basis (S-DD-6)** — `nutrition/scan` image-size guard now uses `Buffer.byteLength(image, 'base64')` (was `'utf8'`, under-reporting payload by ~33%).

**Correctness fixes:**

6. **1RM high-rep guard (L-DD-1)** — `app/api/workout-entry/route.ts` PATCH replaced its local duplicate `calc1RM` (which used `reps >= 37` as the Brzycki guard — producing absurd estimates for reps 31–36, e.g. reps=36 would multiply weight by 36) with the shared `calculate1RM()` from `lib/1rm.ts`, which correctly skips sets with `reps > 30`.

**DoS hardening (S-DD-3):**

7. **Array caps** — personal-records seed ≤400 entries, progression-style sets ≤40, saved-meal items ≤100 (both POST and PUT), GPS splits ≤200, pace series ≤2000. All return HTTP 413 on violation.

**Input validation (S-DD-4):**

8. **Zod schemas** added to six routes that previously accepted arbitrary numeric input:
   - `food-items` POST: calories 0–10000, macros 0–1000g, serving 0.1–5000g, name ≤200, source must be `manual|ai|barcode|text`
   - `meal-types` POST: name ≤100, hours 0–23/0–24, orderedIds ≤50
   - `food-logs` POST: `quantityMultiplier` must be 0.01–100
   - `nutrition/targets` PUT: calories 0–20000, macros 0–2000g
   - `user/profile` PATCH: height 50–300cm, weight goal 20–500kg, name ≤100, activityLevel/fitnessGoal validated against allowed enum
   - `user/goals` PATCH: steps 0–200000, sleep 0–24h, calories 0–30000, water 0–20000ml, weight 20–500kg, body-fat 0–70%

⚠️ **Potential issues to watch:**
- The new `quantityMultiplier` bounds (0.01–100) could reject valid submissions if any client sends `0` (e.g. when logging zero quantity). The bound should be correct in practice but monitor Nutrition food-log errors.
- The `user/profile` PATCH now rejects `heightCm < 50` — if any existing client sends `0` as a "not set" signal, it will get a 400. The DB allows null so the client should omit the field rather than send 0.
- The `destroyLocalStore` on sign-out uses `new TrainingAILocalDB(userId).delete()` — on web this deletes the IndexedDB for that user. Any pending offline mutations in the outbox will be lost on sign-out. This is intentional (sign-out implies committing to a clean state), but note it for future multi-device scenarios.
- Old branches (70+) were not deleted — the git proxy returned 403 on `push --delete`. Clean these up via the GitHub web UI or locally with `git push origin --delete <name>`.

**Next:** Sprint 2 — Caching correctness (C-DD-2 through C-DD-7).

---

## Session 125 — Cache Gap Audit & Load-Time Fixes (2026-06-16) ✅ Complete

Full audit of the `cachedFetch` / `readCacheSync` system. Identified and fixed five areas where data was still being fetched uncached or seeded only from session-scoped `sessionStorage` (which clears on every app restart).

**Root causes fixed:**

1. **Readiness card pop-in (`overview-screen.tsx`)** — `readiness-score` used a plain `fetch()` that ignored the warm cache even when session-select had already fetched it. Switched to `readCacheSync` (synchronous first paint) + `cachedFetch` (background revalidation). Also added `readiness-score` to SyncProvider's `CACHE_TASKS` so it's pre-warmed on every launch.

2. **Calendar session dots slow to appear (`calendar-widget.tsx`)** — `workout-data:meta` used a plain `fetch()` despite always being in the warm cache. Also, calendar-data used a custom `ta_calendar_v2_...` sessionStorage key with no TTL or cross-session persistence. Replaced both with `readCacheSync` + `cachedFetch`.

3. **Streak / "This Week" / Recommendation card empty on cold launch (`session-select-content.tsx`)** — these three sections all depended on custom sessionStorage keys (`ta_streak_v1`, `ta_calendar_v2_...`, `ta_recommendation_v1`) that only survive within the same browser session. On every app restart / tab close, users saw empty widgets until the plain `fetch()` calls completed. Fixed by:
   - Converting `fetch('/api/streak-data')` → `cachedFetch('streak-data', TTL_MEDIUM)` — cross-session persistence
   - Converting `fetch('/api/calendar-data')` → `cachedFetch('calendar-data:YYYY-MM', TTL_MEDIUM)` — cross-session persistence
   - Adding `readCacheSync` reads for both in `useLayoutEffect` for instant first paint
   - Adding `readCacheSync('next-session')` fallback for recommendation (SyncProvider pre-warms this)

4. **Nutrition tab blank flash (`nutrition-content.tsx`)** — had `cachedFetch` for all data but no `readCacheSync`. On every tab switch, the page rendered empty for several frames while the async `getCached` calls completed. Added `useLayoutEffect` that seeds all 5 endpoints (meal types, food logs, targets, weekly summary, cals burned) synchronously from cache before first paint.

**Tested on local DB:** All API routes (`/api/streak-data`, `/api/calendar-data`, `/api/next-session`, `/api/readiness-score`, `/api/nutrition/*`) verified against local PostgreSQL. Dev server clean (no new JS/TS errors).

**Also fixed (post-review):** `invalidateWorkoutSummaries()` in `lib/cache-groups.ts` was missing `streak-data` and `calendar-data:` — after completing a workout the streak count and calendar dots would briefly show stale values before the background revalidation. Both added to the invalidation group.

⚠️ **Remaining lower-priority gaps (not addressed this session):**
- **Session tab workout data** (`ta_wc_${sess.id}` sessionStorage): The per-session workout detail prefetch in `fetchWorkoutData` still uses a custom session-scoped `sessionStorage` key rather than `cachedFetch`. The "last session day" shown on each tab header (`lastSessionDay()`) is sourced from this. It works fine within a session but re-fetches from network on every cold launch. Low impact — it's a background prefetch and doesn't block any visible UI.
- **`exercise-history` N+1 pattern**: Each exercise in the active workout fetches its own history via a separate uncached `fetch()`. With 5-8 exercises per session, this is 5-8 serial/parallel uncached requests when opening the workout screen. Could be converted to `cachedFetch` with a compound key `exercise-history:${exerciseName}` and TTL_MEDIUM.
- **`/api/training-load` and `/api/sleep-performance-correlation`** already use `cachedFetch` in `health-content.tsx` but are not in SyncProvider's `CACHE_TASKS`. First visit to the Health tab always hits the network for these. They're only needed on that tab so deliberately kept out of the pre-warm list to avoid unnecessary startup fetches.

---

## Session 124 — Local-First Sync Architecture (2026-06-16) ✅ Complete

Full local-first read/write architecture using Dexie.js (IndexedDB). The app now writes locally first and syncs in the background — loads are instant from cache on the first render.

**Root cause fixed:** `SyncProvider` was running 12 `warmCache()` calls sequentially, each doing a localStorage read + potential network fetch. On cold cache = ~12 serial network requests ≈ 1s delay. Now all run in parallel.

**Changes:**

*DB (migrations 069 + 070):*
- `069_updated_at_all_tables.sql` — adds `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` to 10 tables that lacked it (`body_metrics`, `sleep_sessions`, `mood_logs`, `activity_logs`, `progression_styles`, `style_sets`, `program_sessions`, `session_exercises`, `schedules`, `schedule_days`). Installs `trg_set_updated_at` trigger on all 13 mutable tables.
- `070_soft_deletes.sql` — adds nullable `deleted_at` to `body_metrics` and `mood_logs` for tombstone propagation to the local store.
- `lib/data/postgres/schema.ts` — Drizzle schema updated to reflect all new columns.

*Repository:*
- `lib/data/repository.ts` — added `SyncDelta`, `IncomingMutation`, `PushResult` types + `getSyncDelta` and `pushMutations` interface methods.
- `lib/data/postgres/adapter.ts` — implemented both: `getSyncDelta` runs 7 parallel queries capped to a 90-day window; `pushMutations` strips system fields and delegates to existing `upsertBodyMetrics`/`saveMoodLog`.

*API routes:*
- `app/api/sync/pull/route.ts` — `GET /api/sync/pull?since=<ISO>` returns delta for current user. 90-day cap enforced server-side.
- `app/api/sync/push/route.ts` — `POST /api/sync/push` accepts up to 100 mutations (Zod-validated). Returns `{ processed, errors }`.

*Local store (new `lib/local-store/` module):*
- `types.ts` — `LocalBodyMetric`, `LocalMoodLog`, `LocalSleepSession`, `LocalWorkoutSession`, `LocalActivityLog`, `LocalProgram`, `LocalProgressionStyle`, `PendingMutation` (includes `userId` for per-user outbox isolation), `SyncMeta`.
- `index.ts` — `LocalStore` interface + `getLocalStore(userId)` per-user factory (singleton per userId).
- `dexie-backend.ts` — `DexieLocalStore` implements `LocalStore` on top of Dexie IndexedDB. DB named `trainingai-${userId}` for complete cross-user isolation. Conflict resolution: incoming delta skips records with `syncStatus === 'pending'`.
- `sync-engine.ts` — `pushMutations(userId)` and `pullDelta(userId)`. 5-minute polling throttle via module-level `lastSyncMs`. `pushMutations` only deletes confirmed outbox entries (errors stay for retry).

*SyncProvider + component wiring:*
- `components/sync-provider.tsx` — now takes `userId` from layout prop. Sequence: push mutations → drain SQLite outbox → pull delta → warm caches (all 11 in parallel). `sleep-sessions` removed from `CACHE_TASKS` (served by Dexie). Network listener also triggers push+pull on connectivity restore.
- `app/layout.tsx` — calls `auth()` server-side, passes `userId` to `SyncProvider`.
- `app/health/health-content.tsx` + `app/health/page.tsx` — sleep data fast-path reads from Dexie before network; body metric writes are local-first (Dexie + outbox queue) with API fallback.
- `app/session-select/session-select-content.tsx` + `app/page.tsx` — body metric widget writes are local-first.
- `components/mood-checkin-sheet.tsx` + `components/workout/warmup-screen.tsx` + `components/workout-screen.tsx` — mood log writes are local-first.

**Tested on local DB:**
- `/api/sync/pull` returns all 7 domains with correct record counts, delta filter by `since` works.
- `/api/sync/push` wrote body_metrics and mood_logs to DB, verified via psql.
- Zod validation rejects invalid domain names with 400.
- Home `/` and `/health` pages return 200.
- TypeScript: `pnpm tsc --noEmit` clean (zero new errors).

**Bug fix also shipped (migration 071):**
- `activity_logs` duplicate entries from concurrent Samsung Health syncs — added `UNIQUE` partial index on `(user_id, date, start_time) WHERE start_time IS NOT NULL` and `ON CONFLICT DO NOTHING` in `saveActivityLog`. Migration deduplicates existing rows on first boot, keeping earliest `created_at`.

**Deliberate scope cuts (follow-on):**
- Nutrition food logs (complex FK)
- APK SQLite parity (`SQLiteLocalStore` implementing same `LocalStore` interface)
- Manual full-resync button in settings
- Unify two outbox systems (workout SQLite + Dexie health data)

⚠️ **Potential issues / known gaps:**
- **Dexie not tested on device yet** — the IndexedDB local store, delta pull/push, and local-first writes have only been tested via curl against the local dev DB. First real device test may surface Dexie compatibility issues, field mapping mismatches, or edge cases in the conflict resolution logic.
- **`sleep-sessions` cache removed but `cachedFetch` call still in `health-content.tsx`** — the Dexie fast-path fires before the `cachedFetch('sleep-sessions', ...)` call, but the `cachedFetch` is still present and will hit `/api/sleep-sessions` if the Dexie store is empty (first install). On subsequent loads with Dexie populated, sleep data comes from local store instantly. This is intentional fallback behaviour but means the sleep-sessions API is still called on first load.
- **Body metrics fast-path not wired for raw weight chart** — Task 9 added a Dexie fast-path for sleep sessions but the body weight chart (`metaRecent` / `metaToday`) still reads exclusively from `cachedFetch('body-metadata', ...)`. The local-first write for body metrics (Task 10) correctly updates Dexie and re-reads, but the chart won't be instant on cold load until a Dexie fast-path is added for `metaRecent`.
- **`pullDelta` 5-minute throttle persists across page navigations** — the module-level `lastSyncMs` variable means that if the user navigates away and back within 5 minutes, `pullDelta` won't fire again. This is intentional, but means a very recent write on another device won't appear for up to 5 minutes.
- **Mood log `onSaved` callback returns synthetic local record** — `MoodCheckInSheet` now constructs a `MoodLog`-shaped object from the local Dexie write rather than the server response. The `id` field is set to `'local-pending'`. Any caller that uses the returned `id` for server-side operations (e.g. editing/deleting a specific log) may fail until the record is synced and the real ID is known. Check if `onSaved` callers rely on `id`.
- **Two outbox systems** — workout data uses `lib/sqlite/outbox.ts` (Capacitor SQLite), health data uses Dexie `mutationsOutbox`. Both are drained in `SyncProvider` but they're separate systems. Unify when APK SQLite parity is implemented.

v1.42.0 (no version bump — infrastructure, not user-visible feature change).

---

---

## Session 123 — Strength Progress Card Layout Improvements (2026-06-16) ✅ Complete

Small visual polish pass on the Estimated 1RM card in Health > Progress.

**Changes:**
- `app/api/weights-summary/route.ts` — extended response to include `phaseName` and
  `cycleLabel` (e.g. `"Accumulation"`, `"C2/4"`) computed from the phase engine for
  automatic-phase programs. No-op (returns `null`) for manual-phase programs.
- `components/health/strength-progress-card.tsx`:
  - Phase chip + "Last: \<session\>" annotation rendered below the title row, between the
    header and the exercise list. Both hide cleanly when data is absent.
  - Progress bars widened from `w-16` (4 rem) to `7 rem` to give the reference lines room.
  - Dashed vertical lines at 60%, 70%, 80% of bar width overlay each exercise bar — subtle
    `rgba(255,255,255,0.22)` dashes that extend slightly above/below the bar track as
    intensity zone markers.
  - Latest/Working Set toggle moved behind a settings cog (Popover) to declutter the header.

v1.42.0.

---

## Session 122 — Fix Goals Card "Workouts" Target Mismatch vs Home Screen (2026-06-15) ✅ Complete

Follow-up to session 121: the new Goals card showed "Workouts — This week: 1/4" while
the home screen's "This Week" tile showed "1/5" for the same rotation-style program.

**Root cause:** `lib/schedule-utils.ts`'s `getScheduledSessionsPerWeek` (added in session
121) computed a rotation program's weekly cadence as
`sessions.length / (sessions.length + restAfterN) × 7`. The home screen's pre-existing
`weeklyTarget` calc (and a third, separate copy in `/api/workout-data`'s phase-status
calc) instead treats `restAfterN` as "consecutive training days before 1 rest day" and
computes `restAfterN / (restAfterN + 1) × 7`. For this user's program (`restAfterN=3`),
that's 4 vs 5.

- `lib/schedule-utils.ts` — rewrote `getScheduledSessionsPerWeek` to match the
  established `restAfterN / (restAfterN + 1) × 7` formula for rotation schedules, and
  `schedule.days?.length ?? 3` for weekly schedules (both now identical to the home
  screen's `weeklyTarget` calc).
- `app/api/workout-data/route.ts` — removed its own local `avgSessionsPerWeek` copy
  (third duplicate of the same formula) and now calls the shared
  `getScheduledSessionsPerWeek` for its phase-status `approxWeeksRemaining` calc.
- `lib/__tests__/schedule-utils.test.ts` — rewritten for the corrected semantics (6
  tests).

**Verification:** `pnpm test` 157/157 passing (one fewer test than before — the old
"floors at 1" edge case no longer applies under the corrected semantics). Verified
end-to-end against the local dev DB (`restAfterN=3` seeded program): `/api/progress-summary`
now returns `scheduledThisWeek: 5`, matching the home screen's "1/5". User confirmed fixed
on production.

⚠️ **Possible follow-up bugs / known gaps:**
- `app/session-select/session-select-content.tsx` still has its **own** inline copy of
  this same formula (`weeklyTarget`, lines ~570-574) rather than importing
  `getScheduledSessionsPerWeek`. It happens to already match the corrected formula (which
  is why the home screen showed the "right" 1/5 while the new Goals card showed 1/4), but
  it's a fourth/un-deduped copy — if anyone changes the cadence formula again, this is the
  one place that won't update automatically. Low priority, but worth folding into
  `lib/schedule-utils.ts` next time this area is touched.
- The "weekly" schedule branch (`schedule.days?.length ?? 3`) was **not** independently
  verified end-to-end in this session (the test user's program is `rotation`-type) —
  please check the Goals card's Workouts target against the home screen for any
  `weekly`-schedule program too.
- `getScheduledSessionsPerWeek` is an *average* cadence (`restAfterN/(restAfterN+1) × 7`,
  rounded), not the literal count of sessions actually due in the current calendar week —
  for rotation programs this is an approximation by design (matches existing home-screen
  behaviour), but it means "X/Y this week" can show Y sessions even in a week where the
  rotation would actually land on fewer (or more) due to where the cycle started. This is
  pre-existing behaviour, not introduced by this fix.

v1.41.1.

---

## Session 121 — Health > Progress Tab Redesign: 1RM Mode Toggle + Goals Cards (2026-06-15) ✅ Complete

Implemented `docs/superpowers/specs/2026-06-15-health-progress-tab-design.md` via two
plans (`docs/superpowers/plans/2026-06-15-health-progress-1rm-mode.md` and
`docs/superpowers/plans/2026-06-15-health-progress-goals-cards.md`).

**Card 1 — Estimated 1RM Latest/Working Set toggle:**
- `lib/data/repository.ts` / `lib/data/postgres/adapter.ts` — added `listMaxReps(userId)`,
  a batched query returning each exercise's all-time max logged reps (for bodyweight
  exercises).
- `app/api/weights-summary/route.ts` — `ExerciseSummary` gains `exerciseType`,
  `lastReps`, `maxReps`.
- `lib/health/strength-progress.ts` (new) — `computeBarMetric(exercise, mode)` is a pure
  function returning `{ pct, label, color }` for either mode: "Latest" (existing
  estimated-1RM-vs-PR behaviour) or "Working Set" (today's top set weight vs PR for
  weighted lifts, or today's reps vs all-time max reps for bodyweight lifts). 14 vitest
  cases in `lib/health/__tests__/strength-progress.test.ts`.
- `components/health/strength-progress-card.tsx` — rewritten with a segmented
  Latest/Working Set pill toggle; sessions with no exercises logged in the selected mode
  are hidden.

**Cards 2 & 3 — Goals card + direction-aware Long-Term Goals:**
- `lib/schedule-utils.ts` (new) — `getScheduledSessionsPerWeek(program)`, handling both
  weekly and rotation-style schedules. 7 vitest cases.
- `lib/data/repository.ts` / `lib/data/postgres/adapter.ts` — added
  `getBodyMetricsBaseline(userId)`, returning the earliest-ever logged weight/body-fat as
  the "starting point" for long-term goal progress.
- `app/api/progress-summary/route.ts` (new) — aggregates sleep (last night + week-to-date
  hours), workout completion (today + this-week vs scheduled), and `bodyBaseline` into one
  cached response.
- `components/health/goal-progress-bar.tsx` (new) — extracted the shared progress-bar
  component out of `goal-targets-section.tsx` so it can be reused.
- `lib/health/long-term-goal-progress.ts` (new) — `goalProgressPct(starting, current,
  target)`, direction-aware (works whether the target is above or below the starting
  value). 6 vitest cases.
- `components/health/goals-progress-card.tsx` (new) — new "Goals" card on Health >
  Progress with a Today/This Week toggle, showing Steps, Calories, Water, Sleep and
  Workouts rows (each only shown if the corresponding goal is set).
- `app/health/health-content.tsx` — Progress tab now renders `<GoalsProgressCard>` below
  the strength cards, and the Weight Trend card's old symmetric weight-goal bar was
  replaced with direction-aware Weight + Body Fat % rows driven by `goalProgressPct`.
- `lib/cache-groups.ts` / `components/sync-provider.tsx` — `progress-summary` and
  `user-goals` added to the relevant invalidation groups and the cache prewarm list.

**Verification:** `pnpm tsc --noEmit` and `pnpm test` clean (158/158 passing, 1
pre-existing unrelated `@mapbox/polyline` suite failure). End-to-end verified against the
local dev DB via curl (logged in as `test@local.dev`): `/api/weights-summary` returns
correct `exerciseType`/`lastReps`/`maxReps`; `/api/progress-summary` returns correct
`bodyBaseline`, `scheduledThisWeek`, and `sleep.lastNightHours`; `/api/user/goals` PATCH
round-trips all goal fields correctly.

⚠️ **Known gap:** full browser rendering of `/health` returns a pre-existing HTTP 500 in
this sandbox (`Module not found: Can't resolve '@capacitor/network'` etc. — several
Capacitor packages are declared in `package.json` but missing from `node_modules` here).
Confirmed pre-existing and unrelated to this change (same error on a clean `main`
checkout, and the same modules appear in `tsc --noEmit` output from before this session's
edits). The new cards could not be visually verified in-sandbox — please check on-device
that: (1) the Estimated 1RM cards show a working Latest/Working Set toggle and the bars
make sense in both modes, (2) the new Goals card appears on Health > Progress and reflects
your actual Steps/Calories/Water/Sleep/Workout goals with a working Today/This Week
toggle, (3) the Weight Trend card shows Weight and Body Fat % progress toward your
Profile > Goals targets, correctly oriented whether you're trying to gain or lose.

v1.41.0.

---

## Session 120 — Admin Exercise Rename Now Cascades to History & Programs (2026-06-15) ✅ Complete

User wanted to rename exercises in Admin > Exercises (e.g. "Abs" → "Cable Crunch Abs")
without losing their workout history or breaking program references. The existing edit
form called `upsertExercise`, whose `ON CONFLICT (name)` arbiter doesn't match when only
`name` changes (the `id` stays the same) — Postgres raised a primary-key violation
instead of updating the row. Even if that worked, a plain rename wouldn't follow the
exercise into `session_exercises`, `exercise_logs`, or `personal_records`, all of which
reference exercises by `exerciseName` (text), not `exercise_library.id`.

- `lib/data/repository.ts` / `lib/data/postgres/adapter.ts` — added `adminUpdateExercise`,
  an admin-only edit (any library entry, regardless of `createdBy`) that, inside a single
  transaction: rejects a rename that collides with another library entry's name (409);
  cascades `oldName → newName` across `session_exercises.exercise_name`,
  `exercise_logs.exercise_name`, and `personal_records.exercise_name`; deletes the old
  name's orphaned `exercise_gif_cache` row; then updates the `exercise_library` row's
  `name`/`muscles`/`equipment`/`instructions`/`exerciseType` by `id` (never inserts), so
  the row's `id` is preserved.
- `app/api/admin/exercises/route.ts` — `PATCH` now calls `adminUpdateExercise` instead of
  `upsertExercise`, returning 409 with the conflict message on a name collision. The
  GIF-cache re-sync (set/clear under the new name) is unchanged.
- `components/admin/exercise-manager.tsx` — `handleSave` now surfaces the server's error
  message on failure (was a generic "Save failed"); the edit form shows a hint under the
  name field once it's been changed: "Renaming updates this exercise everywhere it's
  used — programs, workout history, and personal records."

**Verification:** `pnpm tsc --noEmit` and `pnpm eslint` clean on all 4 changed files.
End-to-end tested against the local dev DB: renamed a seeded "Abs" exercise (with rows in
`session_exercises`, `exercise_logs`, and `personal_records`) — all three tables and the
`exercise_library` row updated to the new name with the same `id`, the old name's
`exercise_gif_cache` row removed, and a non-rename edit (muscles/equipment only) still
saved correctly. Renaming to a name that collides with another existing exercise
correctly returned 409 with a friendly message. Test rows were removed from the local dev
DB after verification.

**Architectural note:** this fix works by cascading the rename across every name-keyed
table at edit time. The underlying issue — exercises are referenced by `exerciseName`
(text) rather than `exercise_library.id` (uuid), the same anti-pattern the "Session
identity = DB id, not name" rule exists to prevent — remains. See "Other Planned / Future
Work" for a proposed dedicated refactor.

v1.40.1.

---

## Session 119 — Admin Tool: Fix Dumbbell Weights Logged in lbs as kg (2026-06-15) ✅ Complete

User reported some dumbbell exercises (Dumbbell Lateral Raise, Dumbbell Preacher Curl,
Dumbbell Shoulder Press) were originally logged in lbs but recorded into the kg field,
inflating estimated 1RM, target80, volume and personal records for sessions before
2026-06-10.

Rather than a one-off SQL migration (risky — `ensureSchema()` re-runs every `.sql` file
in `lib/data/postgres/migrations/` on every cold start with no tracking table, so a
multiplicative fix could corrupt data if it ever ran twice), built an admin-only
preview/apply tool:

- `lib/data/repository.ts` — added `UnitFixResult`/`UnitFixLogChange`/
  `UnitFixExerciseSummary`/`UnitFixSetChange` types and `listLoggedExerciseNames`,
  `previewLbsToKgFix`, `applyLbsToKgFix` to `WorkoutRepository`.
- `lib/data/postgres/adapter.ts` — `computeLbsToKgFix` converts each affected set's
  weight by the exact lbs→kg factor (0.45359237), rounds to the nearest 0.5kg, and
  rescales `estimated1rm`/`target80` (scale + re-round to 0.25) while recomputing
  `volume` exactly from the corrected per-set weights × reps. Recomputes each exercise's
  all-time personal record as the max `estimated1rm` across corrected in-range logs and
  untouched out-of-range logs, with `achievedAt` backdated to whichever session now holds
  the new max. `previewLbsToKgFix` computes the diff with no writes; `applyLbsToKgFix`
  persists it inside a single transaction.
- `app/api/admin/fix-exercise-units/route.ts` (new) — `GET` lists the user's logged
  exercise names (admin-gated via `requireAdmin`); `POST` runs preview or apply.
- `components/admin/exercise-unit-fix.tsx` (new) — toggle-chip exercise selector, date
  picker for the cutoff, Preview button showing per-exercise PR and per-log
  weight/1RM/volume before→after, and a destructive Apply button (with a confirm dialog)
  that becomes a green "Applied" message.
- `app/admin/admin-content.tsx` — added a new "Tools" tab hosting `ExerciseUnitFix`.

**Verification:** `pnpm tsc --noEmit` and `pnpm eslint` clean on all changed/new files
(only pre-existing, unrelated Capacitor module errors elsewhere). End-to-end tested
against the local dev DB: a 20kg-logged "Dumbbell Lateral Raise" set converted to 9kg
(20 × 0.45359237 ≈ 9.07 → 9), estimated 1RM 28.5 → 13, volume 240 → 306 (3 sets at the
real rep counts), and the personal record updated 28.5kg → 13kg with `achievedAt`
pointing at the correct session. A session logged after the cutoff date was left
untouched. Test rows were removed from the local dev DB after verification.

⚠️ **Known gap:** the `/admin` page itself returns HTTP 500 in this sandbox due to a
pre-existing, unrelated issue (missing `@capacitor/status-bar` etc. break SSR for the
whole app here — confirmed via `git stash` on a clean tree too), so the new "Tools" tab
UI could not be screenshotted in-sandbox. The underlying logic is fully verified via
direct API calls; please confirm the Tools tab renders correctly once deployed.

v1.40.0.

---

## Session 118 — Estimated 1RM Progress Bars Now Compare Against Per-Exercise PR (2026-06-15) ✅ Complete

The Estimated 1RM progress bars on Health > Progress previously scaled each
exercise's bar relative to the *heaviest lift in the list* — meaningless across
different lifts (e.g. a Bicep Curl bar always looked tiny next to a Deadlift bar).

- `lib/data/repository.ts` / `lib/data/postgres/adapter.ts` — added
  `listPersonalRecords(userId)`, a single batched query returning every exercise's
  all-time-best `estimated1rm` from `personal_records` as a `Map<exerciseName, number>`.
- `app/api/weights-summary/route.ts` — `ExerciseSummary` gains `personalRecord1rm`.
- `components/health/strength-progress-card.tsx` — each bar now shows
  `latest estimated1rm / personalRecord1rm` (capped at 100%), turning gold at ≥99.5%
  (i.e. currently at or above your all-time PR for that lift) and purple otherwise.

**Verification:** `pnpm tsc --noEmit` and `pnpm eslint` clean on changed files. Verified
against the local dev DB (`test@local.dev`) via curl — Barbell Bench Press at its PR
(98kg) returns `personalRecord1rm: 98` (renders gold/100%); a simulated 90kg session
against the same 98kg PR returns ~92% (renders purple, proportionally shorter).

v1.39.1.

---

## Session 117 — Weekly Goal Aggregation for Steps/Calories/Water (2026-06-15) ✅ Complete

Addresses session 116's "Next up": the daily/weekly toggle for steps, calorie and water
goals previously always compared *today's* value (or a rolling 7-day sum on the home
screen) to the raw goal, regardless of which mode was selected.

- `lib/date-utils.ts` — added `startOfWeekInTz(tz)`, returning the Monday of the current
  week as `YYYY-MM-DD` in the user's timezone.
- `app/api/body-metadata/route.ts` — now computes and returns `weekToDate: { steps,
  calories, waterMl }`, the calendar week-to-date sums (Monday 00:00 in the user's
  timezone through today), filtering `recent` (last 7 days of `body_metrics`) by
  `date >= weekStart` and preferring `todayRow.calories` (food-log totals) for today's
  contribution. Documented as the extension point for future weekly-tracked metrics (e.g.
  sleep) — add a field here plus the corresponding `body_metrics` column.
- `components/profile/goal-targets-section.tsx` — `GoalProgressBar` now accepts a `weekly`
  flag (prefixes "This week: " to the value label); the Steps, Water and Calorie goal
  cards compare `weekToDate.*` against `goal * 7` when the Weekly toggle is selected,
  `todayMeta.*` against `goal` otherwise.
- `components/profile/goals-section.tsx` — fetches `weekToDate` from `/api/body-metadata`
  and threads it down to `GoalTargetsSection`.
- `app/session-select/session-select-content.tsx` — the Steps and Nutrition cards now use
  `weekToDate.steps` / `weekToDate.calories` (instead of summing the last 7 `recent` rows)
  for their weekly progress and goal comparison (`goal * 7`). Added
  `loadWaterGoal`/`loadWaterGoalType` (reading the same `ta_water_goal_ml` /
  `ta_water_goal_type` keys written by the Profile Goals page) and a new thin weekly
  progress bar on the home-screen Water tile, shown only when the water goal type is
  "Weekly".

**Verification:** `pnpm tsc --noEmit` clean; `pnpm lint` no new issues (only pre-existing
warnings in unrelated code); `pnpm test` 135/135 passing. API-level verification via curl
against the local dev DB confirmed `weekToDate` returns `{steps:0, calories:0, waterMl:0}`
on a fresh Monday with no data logged yet, and correctly accumulates to
`{steps:5000, calories:1200, waterMl:600}` after posting to `/api/body-metadata` and
`/api/water-log`.

v1.39.0.

⚠️ **Known gap:** UI was not visually verified in a browser (no browser automation
available in this sandbox) — please check that the Profile Goals progress bars show "This
week: X / Y" correctly for Steps/Water/Calories when set to Weekly, the home-screen Steps
and Nutrition cards show correct weekly totals/percentages, and the new water tile
progress bar renders without clipping the "Log" button on a Galaxy S25 Ultra viewport.

**Next up:** extend the same `weekToDate` pattern to a weekly sleep goal (add `sleepHours`
to `WeekToDate` plus the corresponding aggregation) if/when a daily/weekly toggle is added
for the Sleep Goal card.

---

## Session 116 — AI Program/Phase Context & Goal Card Reorder (2026-06-15) ✅ Complete

- `app/api/nutrition-goals/recommend/route.ts` — `buildContext` now includes the active
  program name and, when `phaseMode === 'automatic'` with phases configured, the current
  phase (name, `phaseType`, cycle position, primary progression style) via the same
  `getActiveProgram` → `listProgramPhases` → `countSessionsSinceStart` → `getCurrentPhase`
  pattern used by `/api/program-week`. Added prompt instructions so the AI treats
  deload/testing phases as expected lower-volume periods (not a declining trend) and may
  factor peak/high-volume phases into numeric suggestions — still bounded by the existing
  `clampRecommendation` and per-metric "Apply" approval flow.
- `goal-targets-section.tsx` — swapped the Water Goal and Calorie Goal cards so Macro
  Targets now sits directly below Calorie Goal.

**Verification:** `pnpm tsc --noEmit` clean; `pnpm lint` no new issues; `pnpm test` 135/135
passing. End-to-end tested against the local dev DB in both manual phase mode and a
simulated automatic phase mode (program temporarily set to "Accumulation" phase of the
Powerbuilding Progression set) — the AI's reasoning correctly referenced "the final week
of your Accumulation phase".

v1.38.0.

**Next up:** daily/weekly goal aggregation for steps/calories/water — currently the
Profile Goals progress bars and home-screen cards always compare *today's* value to the
raw goal regardless of the daily/weekly toggle, rather than summing the calendar week to
date when "Weekly" is selected.

---

## Session 115 — Goals Section Polish & AI Body Fat Context (2026-06-15) ✅ Complete

Follow-up to session 114, based on a device screenshot review:

- `goals-section.tsx` — header redesigned to match the Appearance/Home Widgets card pattern
  (icon, title, subtitle, chevron in a `rounded-2xl bg-muted/40 border` card) instead of a
  plain uppercase label.
- `required-info-section.tsx` — the "Log a new weigh-in" link and the new "Log body fat %"
  link both now route to `/health?tab=body` (previously `/health`, which landed on the
  default Training tab where there's no logging UI).
- `app/api/nutrition-goals/recommend/route.ts` — `buildContext` now includes the latest body
  fat % reading and its 14-day trend, and the prompt asks the AI to factor body composition
  changes (e.g. weight stable but body fat dropping = recomposition) into "insights".

**Verification:** `pnpm tsc --noEmit` clean; `pnpm lint` no new issues; `pnpm test` 135/135
passing; local dev server compiled `/more` and `/health?tab=body`.

v1.37.2.

**Next up (in progress):** investigating how the daily/weekly goal-type toggle (steps,
calories, water) actually aggregates — currently the Profile Goals progress bars always
compare *today's* value to the raw goal regardless of daily/weekly, and the home-screen
cards use a rolling 7-day window rather than a calendar week. Also considering whether to
feed the active program's progression style / recent volume into the AI recommendation
context as extra signal (not a hard rule).

---

## Session 114 — Goals Section Tidy-Up (2026-06-15) ✅ Complete

Quick refinement pass on session 113's unified Goals section, based on a screenshot review:

- `goals-section.tsx` is now collapsible — collapsed by default, toggled via a chevron in the
  section header (same lightweight pattern, no extra bordered card wrapper since the content
  already contains nested cards).
- `required-info-section.tsx` — the old read-only "Current Weight" row and the separate "Target
  Weight (kg)" field (in `goal-targets-section.tsx`) are merged into one "Weight" row: latest
  weigh-in (with date label, or "No weigh-ins yet") → `ArrowRight` → compact target input. Added
  an analogous new "Body Fat %" row (latest logged body fat → target body fat %, or "Not logged"
  if none exists yet) — body fat wasn't shown anywhere in Goals before this.
- `goal-targets-section.tsx` — removed the now-redundant standalone Target Weight and Target Body
  Fat % fields.
- Birth Year stays in Goals (it's required for the BMR/age calc used by the AI recommendation, so
  it belongs with the other "required info" fields rather than back in Edit Profile).

**Verification:** `pnpm tsc --noEmit` clean; `pnpm lint` no new issues; `pnpm test` 135/135
passing; local dev server compiled `/more` successfully.

v1.37.1.

---

## Session 113 — Profile Goals Section Reorganisation (2026-06-15) ✅ Complete

Follow-up to session 112's AI goal recommender: merged the old "Goals" collapsible and the
"Activity & Goals" section in `components/more/profile-tab.tsx` into a single unified "Goals"
section that follows a required-info → targets → AI-recommendation workflow.

**New components** (`components/profile/`):
- `required-info-section.tsx` — Current Weight (read-only, latest weigh-in from
  `/api/body-metadata`, with date label and a link to `/health` to log a new one), Height,
  Biological Sex, Birth Year, Activity Level.
- `goal-targets-section.tsx` — Fitness Goal, Target Weight, Target Body Fat %, Steps/Sleep/Calorie/
  Water goals with `GoalProgressBar`s, and the new `MacroTargetsPane`.
- `macro-targets-pane.tsx` — collapsible macro targets editor (calories/protein/carbs/fat/fiber),
  moved from the deleted `components/nutrition/nutrition-targets-form.tsx`. Accepts a
  `refreshKey` prop so it re-fetches `/api/nutrition/targets` after an AI recommendation is
  applied (`GoalRecommendationSheet` now takes an `onApplied` callback for this).
- `goals-section.tsx` — container owning all state/handlers (absorbed from the deleted
  `activity-goals-section.tsx`), renders the three pieces above plus the "Get AI Recommendation"
  button and `GoalRecommendationSheet`.

**Other changes:**
- `edit-profile-sheet.tsx` — removed Height/Sex/Birth Year fields (now live in Goals). Its `save()`
  now resends `heightCm`/`dateOfBirth`/`sex`/`activityLevel`/`fitnessGoal` from the current `user`
  object, since `PATCH /api/user/profile` isn't a true partial update (the same landmine noted in
  session 112) — without this, saving Edit Profile would silently null those fields.
- `app/nutrition/nutrition-content.tsx` — removed the "Macro Targets" block from the Nutrition
  settings sheet (Meal Reminders and Meal Types unchanged); macro targets are now Profile-only.
- Deleted `components/profile/activity-goals-section.tsx` and
  `components/nutrition/nutrition-targets-form.tsx` (fully absorbed into the new components above).

**Verification:** `pnpm tsc --noEmit` clean; `pnpm lint` — same 103 pre-existing issues as on
`main`, all in untouched files (confirmed via grep); `pnpm test` — 135/135 passing. Local dev
server: `/more` and `/nutrition` both compiled and returned 200. API smoke-tested against the local
DB — `PATCH /api/user/profile` (both the Edit Profile and Goals-section patch shapes) preserves
`activityLevel`/`fitnessGoal`/`heightCm`/`dateOfBirth`/`sex`, and `PUT /api/nutrition/targets` works
for the new Macro Targets pane.

v1.37.0.

---

## Session 112 — AI Nutrition & Activity Goal Recommender (2026-06-15) ✅ Complete

Built per the approved spec (`docs/superpowers/specs/2026-06-14-ai-goal-recommender-design.md`) and two
implementation plans (`docs/superpowers/plans/2026-06-14-ai-goal-recommender-backend.md` /
`-ui.md`), both reviewed for issues before implementation.

**Backend (10/10 plan tasks):**
- Migration `068_goal_recommendations.sql` — new `goal_recommendations` table (source, status,
  recommended values, reasoning/insights/dataQualityNote, timestamps) + `activity_level`,
  `fitness_goal`, `last_goal_review_at` columns on `users`.
- `ActivityLevel`/`FitnessGoal` enums and `GoalRecommendation` type (`lib/types/user.ts`,
  `lib/types/goal-recommendation.ts`).
- `lib/nutrition/goal-recommendation.ts` — `calculateBaseline` (Mifflin-St Jeor BMR × activity
  multiplier → TDEE, calorie/macro/water/step targets adjusted for fitness goal) and
  `clampRecommendation` (safety bounds on the AI's output).
- Repo additions (`lib/data/repository.ts` / `postgres/adapter.ts`): `goal_recommendations` CRUD,
  `listMoodLogs`, `listRecentPersonalRecords`.
- `invalidateGoalRecommendations` cache group (`lib/cache-groups.ts`).
- New routes: `POST /api/nutrition-goals/recommend` (rate-limited 5/min, builds a 14-day context of
  weigh-ins/steps/sleep/mood/workouts/PRs, calls Gemini `gemini-3.1-flash-lite` via `generateObject`
  + Zod schema, clamps, persists), `PATCH /api/nutrition-goals/[id]` (apply/dismiss),
  `POST /api/nutrition-goals/touch-review` ("remind me later").
- Extended `/api/user/profile` to read/write `activityLevel`/`fitnessGoal`.

**UI (5/5 plan tasks):**
- `components/profile/goal-recommendation-sheet.tsx` — bottom sheet showing current → suggested
  values per metric with toggles, "Apply Selected" / "Dismiss".
- `components/profile/activity-goals-section.tsx` — new "Activity & Goals" Profile section: Activity
  Level (5 options) and Fitness Goal (4 options) pickers + "Get AI Recommendation" button, rendered in
  `components/more/profile-tab.tsx`.
- `app/session-select/session-select-content.tsx` — bi-weekly `GoalsCheckinCard` on the home screen
  (shown when `lastGoalReviewAt` is null or >14 days old and both Activity Level + Fitness Goal are
  set), with "Review now" (calls `/recommend` with `source:'scheduled'`, opens the sheet) and "Remind
  me later" (calls `/touch-review`).
- `app/health/health-content.tsx` — TDEE now uses `ACTIVITY_MULTIPLIERS[activityLevel]` (from the
  shared `lib/nutrition/goal-recommendation.ts`) instead of a hardcoded 1.4×, falling back to 1.4 if
  the user hasn't set an Activity Level yet.

**Critical bug found & fixed during implementation:** `PATCH /api/user/profile` was not a true
partial update — `updateUserProfile` in `lib/data/postgres/adapter.ts` defaults several fields to
`null` when omitted, and the route always sends all profile keys (`undefined` for anything not in the
request body), so any partial PATCH silently wiped `displayName`/`heightCm`/`dateOfBirth`/`sex`/etc.
`ActivityGoalsSection`'s `patchProfile` now always sends the full current profile merged with the
changed field(s) — verified via curl that toggling just the Activity Level no longer touches the other
fields. This pre-existing landmine affects any future code that calls this route with a partial body —
worth keeping in mind.

**Verification:**
- `pnpm tsc --noEmit` — 0 errors. `pnpm test` — 135/135 passing (full repo, after merge with the 1RM
  fix from session 111).
- Full end-to-end test against the local dev DB **with a real `GOOGLE_GENERATIVE_AI_API_KEY`**:
  `/api/nutrition-goals/recommend` (`on_demand` and `scheduled` sources) both returned valid,
  schema-conforming, sensibly-reasoned recommendations from Gemini; `clampRecommendation` left
  in-bounds values untouched; rows persisted to `goal_recommendations` correctly. Replicated the
  sheet's "Apply Selected" flow (`PATCH /api/user/goals`, `PUT /api/nutrition/targets`,
  `PATCH /api/nutrition-goals/[id]` `{status:'applied'}`) and "Dismiss"/`touch-review` — all DB writes
  confirmed correct.
- SSR-verified `/health`, `/session-select`, `/more` all render the new UI correctly (Activity & Goals
  section, goals check-in card, activity-level-aware TDEE).

v1.36.0.

---

## Session 111 — Fix 1RM Estimate Decaying When Hitting Prescribed Reps (2026-06-15) ✅ Complete

**Bug report:** Doing 20kg×12×3 on Landmine Press (more reps than the program recommended) dropped
"Estimated 1RM" from 33.75kg → 28.5kg and "Next Session" targets to 17.5kg×12. A second report
(Barbell Shrug, 47.5kg×12×3, exact prescription) showed the same pattern: 78.5kg → 67.5kg, with a
sparkline showing a steady downward trend over many sessions.

**Root cause:** `calc1RM` (Epley/Brzycki average) applied directly to a progression style's
prescribed `(pct, reps)` *understates* the true 1RM for every standard style — e.g. hitting exactly
60%/12reps (General style) yields ≈93% of the real 1RM. So estimates decayed every session even when
the lifter matched or exceeded the prescription.

**Fix:** New `lib/1rm.ts` (shared client+server, no `"use client"`) consolidates `calc1RM`,
`calcAmrap1RM`, and a corrected `calculate1RM`. For each set, `calculate1RM` derives a
**prescription-relative correction factor** — `1 / ((pct/100) * repFactor(targetReps))` — from that
set's *prescribed* pct/reps (independent of what was actually lifted), and multiplies
`calc1RM(actualWeight, actualReps)` by it. Hitting the prescription exactly now reproduces a stable
1RM; exceeding it raises the estimate, falling short lowers it — recalculated fresh every session, no
all-time-PR pinning (per the user's explicit requirement: "calculate your new 1rm every session and
recommend how to get above it").

Updated `app/api/log-exercise/route.ts` (removed local duplicate `mround`/`calc1RM`/
`amrapScaleFactor`/`calculate1RM`), `components/workout-screen.tsx` (client-side optimistic
estimate now uses `calculate1RM(snapWeights, snapReps, ex.progressionStyle)`, fixing the offline-sync
path too since `/api/sync-workout` trusts the client-supplied `estimated1rm`), and
`components/workout/one-rm-calculator-dialog.tsx` (manual calculator now imports `calc1RM` from
`lib/1rm.ts`). `components/workout/utils.ts` keeps `mround125`/`formatSetLoad*`/`SET_COLORS`.

**Verification:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` — no new issues vs. baseline
(108/108 tests incl. 7 new `calculate1RM` cases, same pre-existing `@mapbox/polyline` failure).
End-to-end against the local dev DB via `/api/log-exercise`:
- "Barbell Bench Press" (Standard style, 75%/8reps, prior est1rm 98): logged 73.75kg×8×3 (= exactly
  75% of 98) → new est1rm **98.25** (stable, vs. ~92.5 under the old formula — a ~5.5kg drop the old
  code would have produced).
- "Barbell Overhead Press" (same style, no prior log): 60kg×10 (exceeding prescribed 8 reps) → est1rm
  **85**, target80 68.
- "Tricep Pushdown" (same style, no prior log): 60kg×8 (exact prescription) → est1rm **80**, lower
  than the exceeded case above — confirms exceeding > exact > falling short ordering.
- Confirmed `exercise_logs`, `personal_records`, and `/api/workout-data`'s "Next Session" targets all
  reflect the corrected values. Cleaned up the synthetic session/exercise-logs/PRs afterward.

v1.35.12.

## Session 110 — Phase System Review Follow-up: Cycle Re-anchor on Phase Set Switch + Sync PR Recording (2026-06-14) ✅ Complete

Follow-up to session 109's review of the automatic phase system — two smaller, lower-severity findings,
both fixed:

**Fix 1 — switching phase sets on an already-automatic program didn't re-anchor the cycle:**
`updateProgramPhaseSettings` only auto-calibrates `cycle_anchor_at` the *first* time a program enters
automatic mode (`cycle_anchor_at IS NULL`). Workout Config → Periodization (edit mode) lets the user change
the Phase Set on an already-automatic program without ever clearing `cycle_anchor_at`, so the old anchor
(computed for the old phase set's block length = `sessionsPerCycle * totalDurationCycles`) stayed in place
and could place the user at the wrong point in the new set's cycle. The existing "Recalibrate cycle
position" button is a manual escape hatch but nothing triggered it automatically.

Fix: `app/api/workout-templates/route.ts` POST now looks up the program's *previous* `phaseSetId` (via
`repo.listPrograms`) before `saveProgram` overwrites it. If the program is automatic and the new
`phaseSetId` differs from the previous one, it calls the existing `repo.autoRecalibrateCycleAnchor()` —
re-deriving `cycle_anchor_at`/`started_at` from training history using the *new* phase set's block length.
First-time activation (`previousPhaseSetId` undefined) is unaffected — that path still goes through
`updateProgramPhaseSettings`'s `cycle_anchor_at IS NULL` branch as before.

**Fix 2 — `/api/sync-workout` never recorded PRs:** Only `/api/log-exercise` called
`upsertPersonalRecordIfBetter`; sets logged offline and replayed via the sync outbox never updated
`personal_records`, regardless of phase mode (pre-existing, not phase-specific).

Fix: `app/api/sync-workout/route.ts` now calls `repo.upsertPersonalRecordIfBetter(userId, item.exercise,
item.estimated1rm)` per item after `logSets`, gated the same way as `/api/log-exercise`
(`estimated1rm > 0 && (!isAnyDeload || isBaseline)`). For a session that already existed
(`!ensured.wasInserted`), `isBaseline`/`isAnyDeload` are derived from the session's *stamped*
`phaseType`/`isEarlyDeload` (per session 109's Fix 2 pattern) rather than the freshly recomputed ones, so a
re-synced session scores against the same phase it was created under.

**Verification:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` — no new issues vs. baseline (101/101
tests, same pre-existing `@mapbox/polyline` failure). Both fixes tested end-to-end against the local dev DB:
- Fix 1: activated automatic mode on the test program with the default Hypertrophy phase set
  (`sessionsPerCycle=3`, 10 logged non-deload sessions) → `cycle_anchor_at` auto-calibrated to
  `2026-05-24 17:59:59` (13 total cycles → block length 39, `10 % 39 = 10`, anchors to oldest session).
  Created a temporary 1-cycle custom phase set (block length 3, `10 % 3 = 1`) and switched to it — confirmed
  `cycle_anchor_at` was *re-derived* to `2026-06-09 18:00:00` (and `started_at` to `2026-06-10`), proving the
  re-anchor fires on phase-set change. Without the fix, `cycle_anchor_at` would have stayed at
  `2026-05-24 17:59:59`, ~3 cycles stale for the new block length. Cleaned up the temp phase set and reset
  the program back to manual/no-anchor afterward.
- Fix 2: POSTed a `/api/sync-workout` payload for "Barbell Bench Press" with `estimated1rm: 105` (prior PR
  98) — confirmed `personal_records.estimated_1rm` updated to 105. Cleaned up the synthetic
  session/exercise-log/set-log rows and restored the PR to 98 afterward.

v1.35.11.

## Session 109 — Phase System Review: Session Relink-on-Reorder + Per-Session Phase Pinning (2026-06-14) ✅ Complete

Follow-up review of the automatic phase/block periodization system (sessions 107-108) looking for
remaining edge cases. Two fixes:

**Fix 1 — session relink broke on reorder/delete:** Session 108's `saveProgram` relink restored
`workout_sessions.session_id` by matching the *position* a session occupied before vs. after a save. This
works for "edit in place" but breaks if the user reorders sessions or deletes one mid-list in Workout
Config — a workout logged against "Pull" (position 1) could get relinked to whatever session now sits at
position 1 (e.g. "Legs" after "Push" is removed), silently mis-attributing logged history to the wrong
session.

Fix: `config-screen.tsx` now round-trips each session's `id` through `EditableSession`/`sessionsList`
(`openEditProgram` and the `saveProgram` payload builder both carry `id: sess.id`). `saveProgram`
(`lib/data/postgres/adapter.ts`) inserts the recreated `program_sessions` row with that same `id` when
present, and the relink loop gained an identity-based pass — a session whose id survived the save maps to
itself regardless of any reordering — which runs after (and overrides) the old position-based fallback
that's kept only for pre-existing rows saved before ids were round-tripped.

**Fix 2 — per-exercise phase mismatch within one session:** `/api/log-exercise` recomputes
`currentPhaseId`/`currentPhaseType`/`sessionIsEarlyDeload` from `countSessionsSinceStart()` on *every*
call. `countSessionsSinceStart` counts all non-deload `workout_sessions` rows since the cycle anchor —
including the row just inserted for this session. So if a session lands exactly on a block-cycle boundary,
the 1st exercise logged into it computes phase N, but the 2nd+ exercise (same session, count now +1) can
compute phase N+1 — different `isBaseline`/`isAnyDeload`, so 1RM scaling and PR-recording could differ
between exercises in the same workout.

Fix: `ensureWorkoutSession` (`lib/data/postgres/adapter.ts`) now returns
`{ id, wasInserted, phaseId?, phaseType?, isEarlyDeload }` (new `EnsuredWorkoutSession` type in
`lib/data/repository.ts`) instead of a bare `boolean` — on conflict (row already existed) it reads back the
already-stamped phase columns. `/api/log-exercise` overrides its freshly-computed phase variables with the
session's stamped values whenever the session already existed (`wasInserted: false`, or found via
`getDayLog` in the no-`workoutSessionId` branch), before computing `isBaseline`/`isAnyDeload`/1RM — so every
exercise in a session is scored against the phase the session was *created* under.
`app/api/sync-workout/route.ts` updated for the new return shape (`.wasInserted`).

**Verification:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` — no new issues vs. baseline (101/101
tests, same pre-existing `@mapbox/polyline` failure). Both fixes tested end-to-end against the local dev DB:
- Fix 1: seeded a real `workout_sessions` row linked to "Push" (position 0), swapped "Push"/"Pull" positions
  via `saveProgram` with ids round-tripped, confirmed the row's `session_id` still pointed at "Push" (now at
  position 1) afterward.
- Fix 2: set the test program to automatic mode (Hypertrophy phase set, `sessionsPerCycle=3`), seeded 35
  prior sessions since the cycle anchor so the next session lands at the Testing→Deload boundary. Logged
  exercise 1 into a new session (computed phase = Testing, `isAnyDeload=false`, `isPR=true`, no prior PR for
  "Tricep Pushdown"). Logged exercise 2 (existing PR=98 for "Barbell Bench Press", new estimate 114.5) into
  the *same* session — confirmed `countSessionsSinceStart` had advanced to 36 (would compute Deload,
  `isAnyDeload=true`, blocking the PR without the fix), but the route correctly inherited the session's
  stamped "Testing" phase and recorded the new PR (`isPR=true`, `personal_records.estimated_1rm` updated to
  114.5). v1.35.10.

## Session 108 — Two Workout-Select Bugs: Stale "Never Trained" After Config Save + False "Leave Workout?" After Completion (2026-06-14) ✅ Complete

User reported two bugs via screenshots after completing a "Push" workout (card correctly showed
"✓ Trained today"):

1. Editing "DB Lateral Raises" exercise role (secondary → accessory) in Workout Config and saving made
   the just-completed "Push" session card revert to "Never trained".
2. Leaving the workout-select screen (already showing "✓ Trained today" / "Start Again") still triggered
   the "Leave workout? Your workout is in progress…" confirmation dialog.

**Bug #1 root cause:** Same architectural issue as session 107's `countSessionsSinceStart` bug, but in a
different code path. `saveProgram` (`lib/data/postgres/adapter.ts`) unconditionally deletes and
re-inserts every `program_sessions` row on *every* config save — even a single exercise-role tweak. The
save UI (`config-screen.tsx`) never round-trips session/exercise ids, so every session is recreated with
a brand-new id. `workout_sessions.session_id → program_sessions.id` is `ON DELETE SET NULL`, so the
delete nulls `session_id` for *every* logged workout under that program, including ones logged seconds
earlier — and the new rows (different ids) never get linked back. `/api/workout-data`'s
`loggedTodayInThisSession` then finds no match for today's session id, `loggedTodayInSession` comes back
`false` for all exercises, and `getLastTrainedLabel()` (which excludes today's date from its
"last trained" fallback on the assumption `loggedTodayInSession` would catch it) falls through to
"Never trained".

**Fix:** `saveProgram` now captures, before the delete, every `workout_sessions` row whose `session_id`
points at one of the program's existing `program_sessions` (keyed by old session `position`). After
recreating sessions (new ids, same positions), it re-points each captured `workout_sessions.session_id`
at the new session occupying the same position — restoring the link for the common "edit in place, no
reorder" case.

**Bug #2 root cause:** The Done screen's "Done" button does `router.push("/session-select")`, which
redirects to `/workout` (no `session` param) — rendering `WorkoutSelectContent` + `BottomNav`. The
Zustand workout store's `mode` stays `"done"` and `workoutStartMs` stays set (only reset by
`WorkoutScreen`'s mount effect, which doesn't run on this route). `BottomNav`'s
`workoutActive = !!workoutStartMs && mode !== "pre"` was therefore still `true`, so clicking any other
bottom-nav tab incorrectly triggered the "Leave workout?" dialog.

**Fix:** `components/shell/bottom-nav.tsx` — `workoutActive` now also excludes `mode === "done"`, since a
completed workout has already been saved and leaving is safe.

**Verification:** `pnpm exec tsc --noEmit` and `pnpm lint` (105/28, same baseline) and `pnpm test`
(101/101, same pre-existing `@mapbox/polyline` failure) show no new issues. Bug #1 verified end-to-end
against local dev DB + running dev server: created a "Push" session with "Dumbbell Lateral Raise"
(secondary), linked a `workout_sessions` row to it with today's date, then performed two consecutive
`saveProgram` calls (toggling the exercise role each time, exactly as the UI does with no ids). After
each save, `workout_sessions.session_id` was correctly re-pointed at the newly-recreated "Push" session
(new id each time), and `/api/workout-data` continued returning `loggedTodayInSession: true` /
`lastDate: "2026/06/14"` for the logged exercise — confirming the "Trained today" label would no longer
regress. v1.35.5.

**Follow-up — retroactive backfill (same day):** After 1.35.5 shipped, the user's "Push" session
(logged earlier that day, before the fix went live) still showed "Never trained" on the workout-select
screen even though the home screen correctly showed "✓ Completed Today". The 1.35.5 fix only prevents
`session_id` from being orphaned on *future* saves — it does nothing for rows that were *already*
`session_id = NULL` from a config save made before the fix was deployed. Added migration
`066_backfill_orphaned_workout_session_links.sql`, a one-time repair that relinks any
`workout_sessions` row with `session_id IS NULL` to the current `program_sessions` row with a matching
`session_name`, gated so it only relinks when that name is unique among the user's programs (avoids
guessing when multiple sessions share a name). Verified end-to-end against the local dev DB: recreated
Push/Pull/Legs `program_sessions`, ran the migration, and confirmed all 9 previously-orphaned
`workout_sessions` rows relinked to the matching-named session, with `/api/workout-data` then returning
`loggedTodayInSession: true` for the "Push" session. Auto-applies on Railway's next cold start via
`ensureSchema()` — no manual action needed. v1.35.6.

**Follow-up #2 — 066 too conservative for users with old programs (same day):** After 1.35.6 deployed,
the user's "Push" session still showed "Never trained". 066's uniqueness check requires the session name
to be unique across *all* of the user's programs, including old/inactive ones from earlier development —
the user has more than one program with a "Push"/"Pull"/"Legs" session, so 066 found a name collision and
correctly refused to guess, leaving the row orphaned. Added migration
`067_backfill_orphaned_workout_session_links_active_program.sql`, which retries the same relink but scopes
both the name match and the uniqueness check to the user's *currently active* program — a collision there
is far less likely and the match is unambiguous. Reproduced the exact scenario in the local dev DB (active
"Push Pull Legs" program plus an inactive "Old PPL Test" program, both with a "Push" session): confirmed
066 makes `UPDATE 0` (correctly skips, ambiguous), then 067 makes `UPDATE 9` and relinks the "Push" row to
the active program's "Push" session. Auto-applies on Railway's next cold start. v1.35.7.

**Follow-up #3 — "On program" stat inflated by relinked pre-phase history (same day):** After 067, Profile
showed "On program: 6w" when the user expected "1-2w" (their current Accumulation block). Root cause:
`getFirstWorkoutDateForProgram` (`app/api/program-week/route.ts`) finds the earliest `workout_sessions`
row whose `session_id` matches one of the active program's current session ids — and 067 just relinked the
user's very first-ever "Push"-named workout (6 weeks ago, logged before phases existed) to the current
"Push" session. That date predates the program's `cycle_anchor_at` (when automatic phase mode was set up,
~2 weeks ago), so "On program" reported total PPL history instead of time-on-current-block. First attempt
clamped the result to `max(firstWorkout, cycleAnchorAt ?? startedAt)`, v1.35.8 — but that just produced
"0w" for any block-cycle anchor under 7 days old, which read as broken on an active program.

**Follow-up #4 — replaced with overall block-cycle progress (same day):** "On program" was conflating two
different concepts: (1) lifetime tenure on this program (drives the original "≥12w → ⚠️ Review?" nudge),
and (2) progress through the current automatic-phase block — which the app already computes correctly
elsewhere via `getCurrentPhase()` + `countSessionsSinceStart()` (session-count based, no calendar anchors,
shown as "Phase · Cycle X/Y" on session-select/workout screens). v1.35.8's clamp tried to make the
tenure-based date diff serve both purposes and kept producing confusing numbers. Fix: `/api/program-week`
now branches on `program.phaseMode`:
- **Automatic phases configured** (`phaseMode === 'automatic'` with a phase set + `sessionsPerCycle`):
  returns `{ mode: 'cycle', cycleCurrent, cycleTotal, phaseName, blockComplete }` — overall position in the
  whole block (e.g. "4/5") and the phase that cycle belongs to (e.g. "Accumulation"), reusing
  `getCurrentPhase()`. `blockComplete` swaps the label to "⚠️ New block?" instead of the old 12-week nudge.
- **Manual/no phases**: unchanged — `getFirstWorkoutDateForProgram` (reverted to its pre-1.35.8 form, no
  clamp) drives `{ mode: 'tenure', weeksRunning }` with the original "≥12w → ⚠️ Review?" nudge.

`components/more/profile-tab.tsx` renders both shapes. Verified in local dev DB: active program has
`cycle_anchor_at = 2026-05-27`, `sessions_per_cycle = 3`, phase set = Baseline(1 cycle) + Accumulation(4
cycles) = 5 total, and 9 non-deload sessions logged since the anchor → `completedCycles = 3`,
`/api/program-week` returns `{"mode":"cycle","cycleCurrent":4,"cycleTotal":5,"phaseName":"Accumulation",
"blockComplete":false}`, matching the "Cycle 4/5 · Accumulation" shown on the workout screens. v1.35.9.

## Session 107 — Fix Automatic Phase Progression Stuck on Baseline/Testing Cycle 1 (2026-06-14) ✅ Complete

User-reported bug: with a "3 on 1 off" routine, the second Push session of the week (which should
have rolled into the Accumulation phase) still showed `Push - Baseline · C1/1` with the AMRAP TEST
instructions.

**Root cause:** `programs.started_at` — the fixed anchor date for block-cycle counting — was never
written by the app. `saveProgram` only persists `phase_mode`/`sessions_per_cycle`/`phase_set_id`, so
every automatic-mode program had `started_at = NULL`. Both `/api/workout-data` and `/api/log-exercise`
fall back to "today" when `started_at` is null, which resets the counting anchor every day —
`countSessionsSinceStart` only ever counted same-day sessions, `completedCycles` never advanced past 0,
and the phase calculation stayed permanently pinned to the first phase (Baseline/Testing). It also made
`getActiveProgramWithPhases` always return null (it requires `started_at` to be truthy), so
`log-exercise` never received phase context at all — the AMRAP-scaled 1RM formula was never applied and
`workout_sessions.phase_id`/`phase_type` were never stamped, even on sessions the UI showed as Baseline.

**Fix:** `lib/data/postgres/adapter.ts` — `updateProgramPhaseSettings` now sets
`started_at = COALESCE(started_at, today_AEST)` the first time `phase_mode` becomes `'automatic'`;
COALESCE makes it permanently a no-op once set. New migration `064_backfill_phase_started_at.sql`
backfills any existing automatic-mode programs whose `started_at` is still NULL to today (AEST).

**Verification:** Confirmed via local dev DB + running dev server (`test@local.dev`) — saving a program
with `phaseMode: 'automatic'` while `started_at` was NULL correctly set it to today, and re-saving left
it unchanged. `/api/workout-data?tab=meta`'s `phaseStatus` now computes `completedCycles`/`cycleInPhase`
from the persisted anchor instead of resetting daily. `pnpm test` (101/101, excluding the pre-existing
`@mapbox/polyline` failure) and `pnpm lint` show no new issues — confirmed both failures exist on `main`
prior to this change too.

⚠️ **Behavioural note:** for any program that had `started_at = NULL` (i.e. every automatic-mode
program before this fix), the anchor is now set to *today*, not retroactively to when the block
actually began — cycle counting restarts from now.

**Follow-up (same session):** the "anchor to today" backfill meant sessions already logged earlier in
the current week (e.g. this week's Push/Pull/Legs/Upper/Lower) no longer counted toward the cycle, so
the phase was *still* stuck on Baseline for the user's next session. Added a "Block Start" date field to
the automatic-phase section of Workout Config (`components/config-screen.tsx`, edit mode) — lets the
user set `programs.started_at` to the actual date their current block began, so
`countSessionsSinceStart` counts this week's already-completed sessions. `app/api/workout-templates/route.ts`
now forwards `startedAt` to `updateProgramPhaseSettings` when provided (existing repo method already
supported it). v1.35.3.

**v1.35.2 and v1.35.3 did not fix the bug** — user confirmed via screenshot the home/active-workout
screens still showed `Baseline · Cycle 1/1` after both deploys, despite "5/5 sessions done this week".

**Actual root cause (found this session):** `countSessionsSinceStart` (both the original and the
v1.35.2/3 versions) computed the session count via
`workout_sessions INNER JOIN program_sessions ON workout_sessions.session_id = program_sessions.id`.
But `saveProgram` **deletes and re-inserts** every row in `program_sessions` on *every* config save
(even just toggling phase mode), and `workout_sessions.session_id → program_sessions.id` is
`ON DELETE SET NULL`. So after the very first program save following a workout, every existing
`workout_sessions.session_id` becomes `NULL`, the inner join matches zero rows, and
`countSessionsSinceStart` permanently returns `0` — regardless of `started_at`/anchor logic. Verified
in local dev DB: seeded `workout_sessions` already had `session_id = NULL`, and the join-based count was
`0` even with 9 logged sessions and `cycle_anchor_at` set correctly.

**Fix (v1.35.4):**
- `countSessionsSinceStart(userId, programId)` no longer joins `program_sessions` at all — it reads the
  program's `cycle_anchor_at`/`started_at` directly, then counts
  `workout_sessions WHERE user_id = $userId AND is_early_deload = false AND started_at > anchor`.
- Replaced the date-based `started_at` anchor with a new `programs.cycle_anchor_at` (TIMESTAMPTZ,
  migration `065_cycle_anchor_at.sql`, backfilled from `started_at` for existing automatic programs).
  Set once via `COALESCE` on first entering automatic mode — never silently reset by later saves or
  migrations.
- Removed the "Block Start" date field (v1.35.3) entirely. Replaced it with **fully automatic
  calibration** — no manual session counting, per user feedback that asking users to enter how many
  sessions they've completed is "a very bad design".
- Because the count is always computed live from `workout_sessions` at query time, deleting a logged
  session correctly drops the count immediately (DB truth) — no stored counter to go stale.

**Auto-calibration redesign (same session, v1.35.4 finalised):** user feedback after the initial
"Recalibrate" number-field fix above was that requiring users to manually count and enter sessions
completed is bad design long-term, even though it was an acceptable one-time fix. Redesigned so the
anchor is always computed from training history with zero manual input:
- New private adapter helper `cycleAnchorFromHistory(userId, phaseSetId, sessionsPerCycle)` computes
  `n = (total non-deload workout_sessions ever logged) % blockLength`, where
  `blockLength = sessionsPerCycle × Σ phase.durationCycles` — i.e. how far into the current block the
  user already is, derived purely from DB truth.
- New private helper `anchorForMostRecentSessions(userId, n)` (refactored from the old
  `recalibrateCycleAnchor` body) returns the `started_at` of the (n+1)th most recent non-deload session
  (or `now()` if `n <= 0`, or `oldest_of_n - 1s` if fewer than `n+1` sessions exist) — the timestamp that
  makes exactly the `n` most recent sessions count toward the current cycle.
- `updateProgramPhaseSettings` now auto-calibrates `cycle_anchor_at` via `cycleAnchorFromHistory`
  automatically the *first* time a program enters automatic mode (`cycle_anchor_at` still `NULL`) — no
  user action required.
- Replaced `recalibrateCycleAnchor(userId, programId, sessionsInCurrentBlock)` with
  **`autoRecalibrateCycleAnchor(userId, programId)`** (no count argument) — recomputes and *overwrites*
  `cycle_anchor_at` from history. Exposed in Workout Config → Periodization as a one-tap
  **"Recalibrate cycle position"** button (replacing the numeric "Recalibrate" field) — this is what
  fixes the user's currently-stuck program today, with zero manual counting.

**Verified in local dev DB (auto-calibration):** built a test phase set (Baseline × 1 cycle,
Accumulation × 4 cycles, `sessionsPerCycle = 3` → `blockLength = 15`) against the seeded user's 9
historical non-deload sessions (`n = 9 % 15 = 9`). Activating automatic mode for the first time
(`cycle_anchor_at = NULL`) auto-calibrated the anchor to `oldest_session.started_at - 1s`, giving
`countSessionsSinceStart = 9` → `completedCycles = 3` → phase = **`Accumulation · Cycle 3/4`**, matching
the hand-computed expectation exactly. Then simulated the "stuck" state (`cycle_anchor_at = now()` →
count `0` → `Baseline · 1/1`) and called the new recalibrate-only API
(`{ recalibrateCycleAnchor: true, programId }`, no count) — it overwrote the anchor back to
`Accumulation · Cycle 3/4`, confirming the one-tap fix works with zero manual input. `pnpm tsc --noEmit`,
`pnpm lint` (105/28, same as baseline) and `pnpm test` (101/101, same pre-existing `@mapbox/polyline`
failure) show no new issues.

⚠️ **Deferred idea (not implemented):** user also asked about "3 Legs sessions in a row" / per-phase
exercise countdown counters that decrement as exercises are completed. This is a larger product
redesign (phases would need their own exercise-completion tracking independent of session count) and is
out of scope for this fix — noted here as a future enhancement idea.

ℹ️ Separately observed (likely cosmetic, not yet investigated): the user's "Baseline" phase in their
phase set has `primary_style_id = NULL`, showing "Main lifts: — select — Required" in the phase editor.
Since `isBaselinePhase` bypasses `primaryStyleId` resolution entirely (`progressionStyle = null` by
design for AMRAP-test phases), this is likely just a validation-UI nit and not related to the cycle bug.

⚠️ **Known limitation — multi-program cycle counting:** `workout_sessions` has no `program_id` column,
so `countSessionsSinceStart` and `cycleAnchorFromHistory` count *all* of a user's non-deload sessions
regardless of which program they were logged under. With a single active program (today's case) this is
correct. If a user ever activates automatic phase mode on a *second* program later, its first-activation
auto-calibration would be based on the combined history of both programs and could drop it straight into
a later cycle instead of starting at Baseline cycle 1. Not a regression from this fix, but worth scoping
session-counting to the active program if multi-program automatic-phase use becomes common.

## Session 106 — Fix Repeating Meal Reminder Notifications + Tap-to-Open (2026-06-14) ✅ Complete

User-reported bug: tapping a meal reminder notification re-triggered it again and again. Root cause —
`reconcileMealReminders` (session 102) runs on every app open/resume; once a meal's window passes
unlogged it schedules an "immediate" catch-up notification, but tapping that notification resumes the
app, reconcile runs again, the meal is still unlogged/past its window, and another "immediate"
notification gets scheduled — an infinite loop.

**Fix:** `lib/meal-reminders.ts` — new `'skip'` action type plus a `ta_meal_reminder_notified_today`
localStorage map (mealTypeId → date, via `todayInTz()`). Once the catch-up notification fires for a meal
type today, `computeMealReminderActions` returns `'skip'` instead of `'immediate'` on subsequent
reconciles, so it won't be rescheduled again until the meal is logged (which clears the flag via
`cancelMealReminder`/`cancelAllMealReminders`) or the date rolls over. 2 new unit tests cover the skip
behaviour (13/13 pass).

**Tap-to-open:** meal reminder notifications now carry `extra: { route: '/nutrition' }`
(`MEAL_REMINDER_ROUTE`). `components/capacitor-native-init.tsx` registers a
`localNotificationActionPerformed` listener that `router.push()`s to `extra.route` on tap, so tapping a
meal reminder opens the Nutrition page instead of just the home screen.

**Verification:** `pnpm test` (101/101, excluding the pre-existing unrelated `@mapbox/polyline`
module-resolution failure), `pnpm exec tsc --noEmit` and `pnpm lint` show no new errors in changed files.
Playwright smoke test against local Postgres + dev server (`test@local.dev`) confirmed the Nutrition
Settings sheet still renders the Meal Reminders section, the global toggle and per-meal-type "Remind me
if not logged" switch both still work, with no console errors (web correctly no-ops via
`Capacitor.isNativePlatform()`).

⚠️ **Pending on-device verification (cannot be tested in this sandbox):** let a meal window pass
unlogged, confirm the catch-up notification fires once and tapping it opens `/nutrition`; background/
foreground the app repeatedly afterward and confirm no further notifications fire for that meal type
until logged or the day rolls over.

## Session 105 — Deep-Dive Audit #2 (review only, no code shipped)

A second full-codebase deep dive, run against the ten domain skills in `.agents/skills/`
(caching-conventions, timezone-handling, capacitor-native-plugins, db-migrations-repository,
workout-progression-domain, session-wrapup, chartjs-dashboards, motion-animations,
pwa-offline-patterns, svg-icon-design). Six parallel domain audits over `app/`, `components/`, `lib/`,
cross-referenced against this file and the session-104 audit plans so only **new** or still-deferred
findings were recorded. **This was a review/planning session — no application code was changed and no
version was shipped.** All findings are documented as bite-sized, file:line-referenced, testable tasks.

**Deliverables — 7 plan documents** under `docs/superpowers/plans/` (start at the index):

- `2026-06-13-deepdive-00-index.md` — index, execution order, cross-plan overlaps, and "already healthy" list.
- `2026-06-13-deepdive-security.md` — **2 new cross-tenant IDORs** (phase-set can pin another user's
  progression-style UUID `phase-sets/[id]/route.ts:20-32` → `adapter.ts:811-842`; food-log can reference
  another user's meal-type/food-item `food-logs/route.ts:23-32` → `adapter.ts:2135-2140`), unbounded-array
  DoS writes (personal-records/seed, activity-logs, progression-styles, saved-meals, body-metadata),
  validation gaps, missing rate limits (`nutrition/scan`, `barcode`, `mood`), wrong-byte-basis image guard
  (`nutrition/scan:43-46`), 6 repository-bypass routes. Migrations all idempotent; **next free number 064**.
- `2026-06-13-deepdive-caching.md` — **High: sign-out clears no client cache layer** (cross-user data leak;
  no `clearAllCache` exists, `app/actions.ts:5-7` → `profile-tab.tsx:757`); admin exercise edits
  (`exercise-manager.tsx:265-317`), AI builder save (`builder-review.tsx:264`), meal-type edits
  (`meal-type-manager.tsx`), activity-type edits (`activity-type-manager.tsx`), and `overview-screen.tsx:188`
  body logs all leave caches stale up to 6h; `invalidateProgramStructure()` omits `workout-templates`;
  `stats-content` uses bare `fetch()` with no error/retry.
- `2026-06-13-deepdive-native-health.md` — **High: `lib/haptics.ts:1` and `barcode-scanner.tsx:8`
  static-import native plugins into the web bundle**; confirmed **H7** (HRV `Sdnn`→`Rmssd` key) still dead;
  **new H-class: `TotalCaloriesBurned` permission never requested** (`health-connect-sync.ts:120,258`) so
  calories-burned never syncs; rest-timer notification not reconciled on resume. (Most need on-device APK verification.)
- `2026-06-13-deepdive-logic.md` — **`workout-entry` PATCH has a duplicate `calc1RM` missing the reps>30
  guard** (`workout-entry/route.ts:9-15,51`) → editing a high-rep set inflates 1RM/PR; offline 1RM snapshot
  (`workout-screen.tsx:438`) same gap; client `localDate` keys use device-local TZ (tracking note).
- `2026-06-13-deepdive-ui-charts-animations.md` — **High: chart.js eager-bundled** into home/health/stats/
  nutrition initial chunks via chat overlay, weekly-summary, and the nutrition chart; hardcoded chart theming
  (`chart-message.tsx:95`, `weekly-nutrition-chart.tsx:82-86`); `Meteors` + `ta-marquee` ignore
  `prefers-reduced-motion` (no global reduced-motion block in `globals.css`); nutrition metric-toggle tap
  targets sub-44dp; U26/U27 confirmed still-pending with fresh examples.
- `2026-06-13-deepdive-performance-breakup.md` — **High: activity-tracking screens subscribe to the whole
  Zustand store** (`active/pre/done-activity-screen`) → re-render every GPS tick (the session-104 workout-store
  selector fix was never applied to the activity flow); plus a concrete **7-part component-breakup plan**
  (CB-1 split `adapter.ts` 2407 lines by domain; CB-2…CB-6 extract cards/sheets/steps/hooks from
  `config-screen` 1639, `session-select-content` 1602, `health-content` 1342, `builder-wizard` 777,
  `profile-tab` 775) and PER-3/4/5 DB/memoization items.

**Confirmed already healthy (no action):** timezone rule (zero `toISOString().slice/.split`), no-hardcoded-
session-names, emoji-as-iconography (clean), SQL/prompt injection, Samsung compositor fix, migration
idempotency, sparkline/stats charts, notification channel/id ranges.

**Recommended first picks when implementation begins:** the two security IDORs + array bounds, the sign-out
cache wipe, and the activity-store selector — all high-impact, low-risk.

**Verification:** none run — no code changed this session. Each plan carries its own verification + commit steps.
**Note on branch:** plans were committed to the session feature branch `claude/app-deep-dive-audit-fmtfwm`
(per the session's explicit branch directive) rather than straight to `main`.

---

## Session 104 — Comprehensive Audit + Fixes (v1.35.0)

A full-codebase deep dive (security, caching, performance, UI, logic) produced five scoped plans under `docs/superpowers/plans/2026-06-13-audit-*.md`. High/medium findings implemented this session:

- **Security:** Fixed a cross-tenant IDOR in `renameExercise` (now scoped to the owning user, N1); restricted shared-library exercise creation to admins (N7); rate-limited the TTS (N2) and exercise-generation (N4) AI routes and bounded their payloads (N3); capped `sync-health` array sizes (N5); validated the calendar-event body (N6).
- **Caching:** Added `lib/cache-groups.ts` helpers and wired invalidation so completing a workout, logging a set, switching programs, editing styles, and logging mood/body/activity all refresh their derived caches (was stale up to 6h).
- **Logic:** PR is now recorded only after the set-log transaction commits (L1); bodyweight 1RM uses the latest weigh-in (L2); offline `useFor1rm` matches the server (L4); calorie-goal streak respects cut/bulk/maintain direction (L3, new `lib/achievements-calc.ts` + tests).
- **Performance:** `workout-screen` now subscribes to the store via a shallow selector; `SetCard` is memoized with stable index-based callbacks; stale exercise-history fetch is aborted; dead `weekly-digest` self-fetch removed.
- **UI/a11y:** aria-labels + larger touch targets on nutrition icon buttons, sheet safe-area padding, nutrition loading skeleton.

**Deferred (documented in the plans, not done this session):** Radix `<Sheet>` migration for the 4 hand-rolled nutrition sheets and the shared-`<Button>` restyle (need on-device verification); removing the mid-workout `/api/achievements` fetch (needs denormalized lifetime counters to preserve the XP delta); batching the per-login progression-style seeding.

New tests: `lib/__tests__/cache-groups.test.ts`, `lib/__tests__/calorie-streak.test.ts` (11 tests). Pre-existing failing test `lib/activity/__tests__/route-encoding.test.ts` is unrelated (missing `@mapbox/polyline` in this env) and untouched.

---

## Security Risks — Outstanding

| # | Risk | Severity | Notes |
|---|------|----------|-------|
| S1 | **Google OAuth consent screen unverified** | Medium | Shows "This app isn't verified" warning to new users. Requires privacy policy + Google review. Low priority for invite-only use. |
| S6 | **`trustHost: true` set broadly** | Low | Safe behind Railway's proxy; mitigated by `AUTH_URL`. No action needed unless infrastructure changes. |
| S7 | **Old TrainingAI Google OAuth client still active** | Low | Delete the unused `TrainingAI` client in Google Cloud Console (keep `RailwayOauth`). User action — not a code change. |

## Security Risks — Fixed

| # | Risk | Fix | Session |
|---|------|-----|---------|
| S2 | `isActive` not re-checked on every request | `isActive` stamped into JWT; middleware redirects `isActive===false` to `/pending` | 13 |
| S3 | Admin identity hard-coded by email | Migration `006_admin_flag.sql` adds `is_admin` DB column; `requireAdmin()` checks it | 13 |
| S4 | No rate limiting on auth endpoints | `lib/rate-limit.ts` in-memory limiter: 5 register/IP/15min, 20 login/email/15min | 13 |
| S5 | Avatar stored as base64 in DB | Avatar moved to `localStorage` (`ta_avatar` key) | 13 |
| S8 | TTS route had no auth check | `auth()` + `userId` guard added to `app/api/ai-chat/tts/route.ts` | 45 |
| S9 | AI routes had no rate limiting | `rateLimit()` added to all Gemini routes (ai-chat, nutrition/scan, morning-briefing, readiness-score, weekly-digest) | 45 |
| S10 | `sync-workout` accepted unvalidated JSON | Zod schema with numeric bounds and string length limits added | 45 |
| S11 | Nutrition scan accepted unlimited image payloads | 5 MB base64 size gate added before decode | 45 |
| S12 | `rate-limit.ts` map never pruned expired entries | Expired entry deletion added; pruning runs every 5 min | 46 |
| S13 | Mobile token exchange had fragile HTTPS detection | Fixed to use `x-forwarded-proto` header (Railway proxy aware) | 45 |
| S14 | Prompt injection in AI chat | User content moved into a delimited user turn, not system prompt | 45 |
| S15 | Barcode and exercise-gif params had no length/format guard | Zod validation added to both routes (barcode 8-15 digits, name ≤100 chars) | 46 |
| S16 | Health Connect ingest secret compared with `===` (timing attack) | `safeCompare()` using `timingSafeEqual` from `crypto` | 100 |
| S17 | `/api/friends` POST had no rate limit, allowing email enumeration | `rateLimit('friend-request:<userId>', 10, 15min)` returns 429 when exceeded | 100 |
| S18 | `/api/sync-workout` accepted writes against session/exercise-log ids owned by other users | Batched ownership pre-check (`getWorkoutSessionOwners`/`getExerciseLogOwners`); mismatched ids are skipped, response reports `{ synced, skipped }` | 100 |
| S19 (N1) | **Cross-tenant IDOR**: any user could `renameExercise` by id with no ownership check, rewriting every user's `session_exercises`/`exercise_logs`/`personal_records` by name | `renameExercise(userId, id, newName)` now rejects unless `existing.createdBy === userId` (403) | 104 |
| S20 (N7) | Shared-library exercise creation open to any authenticated user | `POST /api/exercises` create branch gated behind `isAdminUser()` (403) | 104 |
| S21 (N2/N3) | TTS route had no rate limit and unbounded `text` | `rateLimit('tts:<userId>', 10/min)` + `ttsSchema.text.max(2000)` | 104 |
| S22 (N4) | Exercise-generation AI route had no rate limit | `rateLimit('exercise-gen:<userId>', 20/min)` | 104 |
| S23 (N5) | `sync-health` cast body with no array bounds (bulk-write DoS) | `MAX_ITEMS = 400` cap on `dailyMetrics`/`exerciseSessions`/`sleepRecords` → 413 | 104 |
| S24 (N6) | `log-calendar-event` body unvalidated; `exercises.map` 500s | `exercises` defaulted to `[]` and capped at 50; inner `setWeights`/`reps` null-guarded | 104 |

---

## Known Issues

| # | Issue | Area | Notes |
|---|-------|------|-------|
| PH2 | **Re-syncing a large stale offline outbox can retroactively update PRs** | Phase system / sync | Session 110 made `/api/sync-workout` call `upsertPersonalRecordIfBetter` per item (matching live logging). If a user accumulates a large un-synced outbox (e.g. weeks offline) and then syncs, any historical set that beats the current PR will update `personal_records` at sync time, not at the time it was originally logged — correct in that it mirrors what would've happened if logged live, but could surprise a user if a "new PR!" surfaces for a workout done days ago. No UI currently distinguishes "PR set live" vs "PR set via sync". |
| PH1 | **Phase-set switch reuses `autoRecalibrateCycleAnchor`, which also resets `started_at`** | Phase system | Session 110's re-anchor-on-phase-set-change fix calls the existing `autoRecalibrateCycleAnchor`, which overwrites both `cycle_anchor_at` *and* `started_at` to the recalculated date. This matches the existing manual "Recalibrate cycle position" button (not a new behaviour), but means switching the Phase Set on an automatic program also shifts the program's displayed "started" date — worth knowing if a future "time on program" stat starts looking off right after a phase-set change. |
| H7 | **HRV sync has been dead code since it was introduced** | Health Connect | `getSessionMetrics()` in `lib/health-connect-sync.ts` (~line 312) reads HRV via `canRead.has('HeartRateVariabilitySdnn')` / `type: 'HeartRateVariabilitySdnn'`, but `'HeartRateVariabilitySdnn'` is **not** in either `requestPermissions({read:[...]})` array — so `canRead` never contains it and this block never runs. Per the pinned `connect-client:1.1.0-alpha11` `RECORDS_TYPE_NAME_MAP`, the correct key is `'HeartRateVariabilityRmssd'` (Rmssd, not Sdnn). `hrvMs` has likely never been populated from Health Connect. Fix: add `'HeartRateVariabilityRmssd'` to the main permissions array and update the `canRead.has(...)`/`readRecords({type:...})` calls to match — same pattern as the H6/1.30.2 fix. Not done this session (out of scope for the sync-failure fix), but low-risk to pick up next time Health Connect is touched. |
| H6 | **Per-session avg/max HR, SpO₂, and HRV won't populate from Health Connect sync** | Health Connect | `@devmaxime/capacitor-health-connect`'s `RecordConverter.kt` has no conversion case for `HeartRateRecord`, `OxygenSaturationRecord`, or `HeartRateVariabilityRmssdRecord` — they fall through to `else -> record.toString()`, returning strings instead of structured JSON that `lib/health-connect-sync.ts` can parse. Sync itself now succeeds (1.30.2 fixed the permission-key bug), but these three fields will silently stay empty. Fixing this requires a native Kotlin patch to the plugin (via the existing `patches/@devmaxime__capacitor-health-connect.patch` pnpm patch) plus a full APK rebuild — not attempted yet. |
| H5 | **Background GPS tracking — partially verified on device** | Activity tracking | Session 97: started a Walk on the real device — no "Allow all the time" prompt appeared, but locking the phone showed the "tracking your activity" foreground-service notification (expected: `@capacitor-community/background-geolocation`'s plugin only requests `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION`, never `ACCESS_BACKGROUND_LOCATION`, and relies on the foreground-service "while in use" exemption to keep tracking with the screen locked). ⚠️ Still need to confirm distance/pace actually kept updating after unlocking (i.e. GPS points were captured while locked, not just that the notification was shown). |
| ~~H4~~ | ~~**`app/history/history-content.tsx` is dead code**~~ | ✅ Fixed (session 100) | Deleted — `/history` redirects to `/stats` → `/health?tab=training`, which is rendered entirely by `app/health/health-content.tsx`. |
| ~~H1~~ | ~~**Card widget drag broken for most widgets**~~ | ✅ Fixed (session 87) | Only the Recommended Today card (a plain `<div>`) could be long-press dragged on the real device — Streak, This Week, and the Weight/Nutrition/Sleep/Steps/Mood card widgets were wrapped in native `<button>` elements, which intercept Android's long-press before the dnd-kit pointer sensor registers a drag. Replaced all those `<button>` wrappers with `<div role="button" tabIndex={0}>`, matching the working Recommended Today pattern. Click-to-navigate still works (verified via Playwright), and drag-reorder persistence verified too. |
| ~~H2~~ | ~~**No colour picker for Recommended Today**~~ | ✅ Fixed (session 77) | Colour dot added in edit mode; card background, border, label, progress bar and Start button all follow the chosen colour. |
| ~~B6~~ | ~~**`upsertUser` ON CONFLICT never fires for null oauthSub**~~ | ✅ Fixed (prior session) | Migration `054_users_email_unique.sql` adds a unique constraint on `users.email`; `upsertUser` now conflicts on `email` with `oauthSub: COALESCE(EXCLUDED.oauth_sub, users.oauth_sub)` — confirmed at `lib/data/postgres/adapter.ts` line 63. |
| ~~B7~~ | ~~**`logExercise` + `logSets` not in a transaction**~~ | ✅ Fixed (prior session) | `pgRepo.logExerciseAndSets()` wraps the `exercise_logs` insert and all `set_logs` inserts in a single `db.transaction()` — confirmed at `lib/data/postgres/adapter.ts` line 1021, called from `app/api/log-exercise/route.ts` line 213. Minor remaining caveat: `upsertPersonalRecordIfBetter` runs before this transaction, so a PR could be recorded even if the subsequent log transaction fails — low impact, not pursued further. |
| ~~B8~~ | ~~**`accentCardStyle` in health-content.tsx missing `willChange:'transform'`**~~ | ✅ Fixed (prior session) | `willChange: 'transform'` confirmed present in current `health-content.tsx` `accentCardStyle`. |
| ~~B9~~ | ~~**Next Session grid breaks for 4+ sets**~~ | ✅ Fixed (session 72) | `ps.slice(0, 5)` now caps the render to match the 5-column grid. |
| ~~B10~~ | ~~**Hand-rolled sheets have no back-gesture dismiss**~~ | ✅ Fixed (session 87) | The original `health-content.tsx` overlays cited here were already migrated to Radix `<Sheet>`. The remaining hand-rolled `fixed inset-0` overlays — `food-logger-sheet.tsx`, `food-library-sheet.tsx`, `quick-edit-log-sheet.tsx` — now call a new `useSheetBackDismiss(open, onClose)` hook (`lib/hooks/use-sheet-back-dismiss.ts`) that pushes a history entry while open and closes the sheet on `popstate`, so Android back-swipe dismisses the sheet instead of navigating away. |
| ~~B11~~ | ~~**"Log" micro-buttons too small for touch**~~ | ✅ Improved (sessions 87, 100) | The Steps "Log" button in `health-content.tsx` now matches the Weight/Body Fat buttons (`px-3 py-1.5 text-xs`). The floating per-tile "Log" button in `session-select-content.tsx` (~line 1336) increased from `text-[9px] px-2 py-1.5` to `text-[10px] px-2.5 py-2` — a modest improvement; full 44 dp isn't feasible on the 76px-wide tiles without a layout redesign. InfoIcon buttons on BMI/Trend/Balance/Lean Mass tiles increased from `p-2` to `p-2.5` and gained `aria-label`s (session 100). |
| ~~B12~~ | ~~**`calc1RM` produces absurd estimates for very high reps**~~ | ✅ Fixed (session 77) | AMRAP baseline path caps reps at 36 before passing to `calc1RM`; normal sets already had `r <= 30` guard in `calculate1RM`. |
| ~~B13~~ | ~~**Done screen has no safe-area-inset-bottom padding**~~ | ✅ Fixed (prior session) | `pb-[env(safe-area-inset-bottom)]` confirmed present on the done screen container. |
| ~~B14~~ | ~~**`sessionDisplayName` stale closure in `handleCompleteSet`**~~ | ✅ Fixed (prior session) | `sessionDisplayName` confirmed in `handleCompleteSet` dep array at `workout-screen.tsx` line 472. |
| ~~B15~~ | ~~**Food logger and saved-meals quick-log use sequential await loops with no rollback**~~ | ✅ Fixed (session 87) | Both call sites now share `lib/nutrition/log-meal.ts`'s `logMealItems()`, which logs each item sequentially but tracks the created `food_log` ids; if any item fails, it deletes the already-created entries before re-throwing, so a mid-loop failure no longer leaves a partial meal logged. |
| ~~B16~~ | ~~**`saved-meals-section.tsx` quick-log doesn't invalidate nutrition cache**~~ | ✅ Fixed (session 73) | `SavedMealsSheet` now calls `invalidateCache` for both keys after every quick-log. |
| ~~B17~~ | ~~**`handleSaveLog` in health-content.tsx missing `invalidateCache` before `fetchMeta`**~~ | ✅ Fixed (prior session) | `invalidateCache('body-metadata')` confirmed called before `fetchMeta()` at `health-content.tsx` line 323. |
| ~~B18~~ | ~~**`next-session/route.ts` unguarded null on `session.user.timezone`**~~ | ✅ Fixed (prior session) | `?? 'Australia/Brisbane'` fallback confirmed present at `next-session/route.ts` line 10. |
| ~~B19~~ | ~~**`computeStreak` in achievements uses UTC midnight, not AEST**~~ | ✅ Fixed (prior session) | `computeStreak` uses `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` for today/yesterday comparison — confirmed at `achievements/route.ts` line 48. |
| ~~B20~~ | ~~**`food_logs.logged_at::date` in achievements SQL uses UTC date**~~ | ✅ Fixed (prior session) | Food-log streak query confirmed using `(fl.logged_at AT TIME ZONE ${tz})::date` at `achievements/route.ts` line 137. |
| ~~B21~~ | ~~**`sync-workout` over-increments phase session count on re-sync**~~ | ✅ Fixed (session 87) | `ensureWorkoutSession` now returns whether a row was newly inserted; `sync-workout/route.ts` only increments the running session count for newly-inserted sessions, so re-syncing an already-existing session no longer skews the phase assigned to subsequent items in the batch. |
| ~~B22~~ | ~~**`localDate` with ISO `-` separator produces NaN in log-exercise**~~ | ✅ Fixed (prior session) | `log-exercise/route.ts` line 133 confirmed using `.replace(/-/g, '/')` before splitting. |
| ~~B23~~ | ~~**`SyncProvider.warmCache()` skips the sessionStorage mirror on a cache hit**~~ | ✅ Fixed (session 86) | `warmCache()` now calls a new `mirrorToSessionCache()` (exported from `lib/sqlite/cache.ts`, just the `ssWrite` mirror write) on a cache hit, without rewriting the persistent entry/TTL. Verified via Playwright: a fresh tab now has `ta_sscache:exercise-library` populated immediately after `SyncProvider` runs, even when `ta_cache:exercise-library` was already a hit. |

---

## Samsung WebView Compositor Bug — Documented Pattern

**Symptom:** Gradient/semi-transparent card backgrounds disappear in the Capacitor APK (Samsung Galaxy S25 Ultra, Android system WebView) after the page finishes loading. The same page renders correctly in Chrome PWA.

**Root cause:** Any inline SVG element inside a home screen card widget can trigger GPU compositor layer creation in Samsung's Android WebView. That compositor layer bleeds into sibling elements in the DOM, causing their CSS `linear-gradient` backgrounds with `rgba()` transparency to fail to render. Observed with: SVG `<circle strokeDasharray strokeDashoffset>` (donut charts), and plain static Lucide icon SVGs (`<Footprints>`, `<Moon>`, `<MessageCircle>`).

---

### Fix A — Replace inline SVG with pure CSS (donut charts / complex shapes)

When the SVG is a chart or shape you control, remove it entirely and use CSS:

```jsx
<div className="relative w-[58px] h-[58px]">
  <div className="absolute inset-0 rounded-full" style={{
    background: `conic-gradient(from -90deg, #color1 0deg Xdeg, #color2 Xdeg Ydeg, ...)`,
    WebkitMask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
    mask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
  }} />
</div>
```

Used for: nutrition donut chart (session 55). Guaranteed fix — zero SVG in the DOM.

---

### Fix B — Force each card onto its own GPU compositor layer (icon SVGs)

When the SVG is a Lucide icon that you want to keep, add `willChange: 'transform'` to **every** card button that uses `accentCardStyle`. This promotes each card to its own compositor layer so no card's SVG can affect another's background:

```typescript
function accentCardStyle(color: string): React.CSSProperties {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return {
    background: `linear-gradient(135deg, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},0.12))`,
    border: `1px solid rgba(${r},${g},${b},0.4)`,
    willChange: 'transform',   // ← promotes each card to its own GPU layer
  }
}
```

Used for: Sleep/Steps/Mood widget Lucide icons (session 57). Confirmed fixed on S25 Ultra.

---

**Rule for future widgets:** Never add inline SVG to home screen card widgets without also applying one of the above fixes. Fix A (no SVG) is guaranteed; Fix B (`will-change: transform` on every sibling card) works for static icon SVGs. If Fix B stops working (e.g. after a WebView update), fall back to Fix A — replace the icon with a CSS mask-image data URI or emoji.

---

---

## Planned Work — Batch Roadmap

### Batch B — Water Tracking + Goals ✅ Complete

| # | Item |
|---|------|
| 1 | ✅ Water intake tile — toggleable on home screen and body tab (`health-content.tsx`, `profile-content.tsx` WIDGET_DEFS) |
| 2 | ✅ Water logging — quick-add chips (150/250/330/500/750/1000 ml) + custom ml input (`components/profile/water-log-sheet.tsx`, `app/api/water-log/route.ts`) |
| 3 | ✅ Water goal — in Profile → Goals section; persisted to `users.water_goal_ml` |
| 4 | ✅ Weekly/daily toggle for steps, water, and calories goals (`users.steps_goal_type`, `water_goal_type`, `calorie_goal_type`) |
| 5 | ✅ Calorie budget auto-adjust — `calsBurnedToday` from cardio sessions added to effective calorie goal in `health-content.tsx` |
| 6 | ✅ Weight goal — `users.target_weight_kg`; "↓ X kg to go" progress on weight tile |
| 7 | ✅ Body fat % goal — `users.target_bf_pct`; "↓ X% to go" progress on BF tile |
| 8 | ✅ Goals section — live `GoalProgressBar` components (current vs target) for steps, calories, water |
| 9 | ✅ Goals link from body tab — "→ Goals" row navigates to `/profile#goals` |

**DB:** migration `051_goals_water.sql` — `body_metrics.water_ml` column + all 8 goal columns on `users`.

---

### Batch C — Nutrition Enhancements ✅ Complete

- ✅ Custom meal builder: name a meal, add ingredient foods from library, save as a template (`components/nutrition/meal-builder-sheet.tsx`, `app/api/nutrition/saved-meals/`)
- ✅ Quick-log saved meals from Health tab (`components/nutrition/saved-meals-section.tsx`)
- ✅ Inline food creation when search returns no results
- ✅ Edit existing saved meal — pencil icon on each meal opens builder pre-populated; PUT `/api/nutrition/saved-meals/[id]` replaces items in-place

---

### Batch D — Home Screen Pill Customisation ✅ Complete

- ✅ Per-pill colour picker in edit mode — colour dot opens a curated MMO-rarity swatch grid (with native picker as a custom fallback); persisted to `ta_pill_colors` localStorage; rendered in Profile → Home Widgets section and consumed in `session-select-content.tsx`

---

### Batch E — Achievements Expansion ✅ Complete (step milestones)

- ✅ Step achievements: Walker (5k), Day Tripper (10k), Pacer (20k), Road Runner (30k), Iron Legs (40k), Ultramarathon (50k) — `app/api/achievements/route.ts`, keyed on best single-day step count
- ❌ Achievement-unlocked profile cosmetics — not implemented; achievements grant XP/level only. Deferred — low priority until social/friend system is scoped.

---

### Batch F — Workout Builder + 1RM Baseline ✅ Complete (session 66)

---

### Batch G — Workout Logging Architecture (high risk, deferred)
- Log all sets on "Complete" rather than per-exercise during the workout
- Needs careful crash/data-loss recovery design before implementation — do not start without a written plan

---

### Batch H — Weekly Summary Cooldown ✅ Complete

- ✅ Weekly AI digest cache key is week-based (`ta_weekly_summary_v2_` + Monday ISO date); validity check compares `cached.weekStart === weekStart` — only re-fetches when the week rolls over (`components/weekly-ai-summary.tsx`)
- ✅ `water-log-sheet.tsx` calls `invalidateCache('body-metadata')` before `onLogged()` — home water tile updates immediately after logging

---

### Batch I — Dynamic Wallpaper Backgrounds ✅ Complete (session 92)

Optional dynamic background — an abstract/atmospheric sky scene (gradient, sun/moon, weather effects) that continuously reflects the time of day and local weather, in the spirit of the Samsung Weather app but built entirely from pure CSS (zero SVG, zero canvas) per the documented Samsung WebView compositor fix above.

- Design spec: `docs/superpowers/specs/2026-06-11-dynamic-wallpaper-backgrounds-design.md`
- ✅ **Plan 1 — data & settings layer**: `docs/superpowers/plans/2026-06-11-dynamic-wallpaper-backgrounds-data-settings.md`
  - Open-Meteo current weather + sunrise/sunset (no API key, client-side fetch), WMO code → 6 conditions (clear/cloudy/rain/fog/snow/thunderstorm)
  - Device location via new `@capacitor/geolocation` dependency (web Geolocation API fallback) with geocoded manual fallback, 30-min localStorage cache
  - Persisted Zustand store (`lib/stores/background-settings-store.ts`): master toggle + per-section toggles (Home/Health/Workout/Nutrition/More)
  - Profile → Theme & Appearance settings UI (`components/profile/dynamic-background-settings.tsx`) + home-screen weather chip (`components/weather-chip.tsx`)
- ✅ **Plan 2 — visual rendering layer**: `docs/superpowers/plans/2026-06-11-dynamic-wallpaper-backgrounds-visuals.md`
  - Continuous sunrise/sunset-aware day-phase interpolation (deep night/dawn/day/dusk palette anchors), sky/celestial/weather-overlay/scrim layers, new CSS keyframes, `<DynamicBackground>` mounted in `app/layout.tsx` behind all content (`z-index: -1`)
- ✅ Feature is off by default (`enabled: false`). Visual rendering, card contrast, and the home greeting/weather chip layout have all been confirmed working on-device (sessions 93–94).
- ✅ Night sky darkness fixed (session 99): the dusk→deepNight transition previously took until solar midnight (5-6h), leaving a pink/magenta wash visible for hours after sunset. Added keyframes at sunset+2h and sunrise-2h so the sky reaches the near-black `deepNight` palette within 2 hours of sunset and holds it through the night (`lib/background/day-phase.ts`). Confirmed working on-device.

---

### v1.19.0 — Bug Fix Batch ✅ Complete (session 67)

Full-codebase review found 17 bugs across data integrity, timezone handling, calculation correctness, cache consistency, and mobile UX. Three additional bugs found during post-baseline testing. All 21 fixed and deployed.

**Post-baseline session bugs also fixed:**
- Google Calendar event never saved — `sessionLog` was cleared by `resetSession()` before the calendar call fired; fixed by calling `handleAddToCalendar` with a snapshot inside `advance()` when last exercise completes
- "Complete Workout" button appeared slowly after last exercise — `resetSession()` cleared `todayLogged`, forcing an API refetch; fixed by preserving `todayLogged` through resets
- Cycle progress bar didn't move until a full cycle completed — switched from `completedCycles/totalProgramCycles` to a session-level fraction using new `sessionsPerCycle`/`sessionsInCurrentCycle` fields on `PhaseStatus`

## Other Planned / Future Work

- ~~**Activity logging**~~ — ✅ Done (session 82) — `activity_logs` + `activity_types` tables, Log Activity sheet, Health > Training history card, admin activity type manager, Health Connect HR/distance/calories enrichment
- ~~**Live-timer activity logging**~~ — ✅ Done (session 88) — "Log Activity" now mirrors the workout pre/active/done flow with a running timer and live GPS distance/pace/route for distance-based types; see version history for details. ⚠️ Background GPS tracking (screen-off) — see H5, partially verified session 97 (foreground-service notification confirmed, distance/pace continuation while locked still pending confirmation).
- **Push notifications** — no service worker infrastructure yet; deferred. ⚠️ Note: `@capacitor/local-notifications` (session 96) covers in-app scheduled alerts (rest timer, and future meal/workout reminders) without needing this.
- ~~**Meal reminder notifications**~~ — ✅ Done (session 102) — reconcile-on-open/resume schedules a "Don't forget to log..." notification per meal type once its time window ends with nothing logged; cancelled immediately on log. Global toggle in Nutrition Settings, per-meal-type toggle in Meal Types. Session 106 fixed a repeat-notification loop (catch-up notification now fires once/day per meal type) and added tap-to-open → `/nutrition`. ⚠️ On-device APK verification (notification firing/cancelling/tap-routing on the Galaxy S25 Ultra) still pending.
- ~~**Workout reminder notifications**~~ — ✅ Done (session 131) — daily local notification at a user-configured time on training days. Toggle + time picker in the program editor's Schedule section (weekly/rotation only; hidden for auto mode). `computeWorkoutReminderAction` pure function (8 unit tests) decides cancel/skip/schedule/immediate; reconciled on app open and on network-restore/resume via SyncProvider; cancelled automatically when workout starts. `reminder_enabled`/`reminder_time` stored on the `schedules` table. ⚠️ On-device APK verification pending.
- **Cadence tracking** — requires accelerometer/pedometer/watch sensor data, not derivable from GPS; out of scope until a sensor data source exists (e.g. via Health Connect).
- ~~**ShareMilestoneCard**~~ ✅ Done session 132 — per-PR share buttons on done screen trophy card; full workout share text includes sets, volume, and PR names
- ~~**Edit existing saved meal**~~ — ✅ Done (session 72)
- **Voice logging for workouts** — capture reps/weight via dictation (deferred from earlier sessions)
- **Mobile token pruning** (U21) — implement token cleanup on expired token detection
- ~~**Exercise library admin UI**~~ — ✅ Done
- ~~**AI-gated exercise addition**~~ — ✅ Done (session 79) — any user can add exercises via stats search, builder swap panel, or admin manager; Gemini fills in name/instructions/muscles/equipment with fuzzy duplicate detection
- **Calendar / training load legend** — consider abbreviations or collapsible legend for programs with 4+ sessions
- ~~**Per-exercise equipment selection in program editor**~~ — ✅ Done (session 131) — book icon next to each exercise input opens a bottom-sheet picker with search + equipment filter chips (Barbell/Dumbbell/Cable/Machine/Kettlebell/Bodyweight); free-text datalist preserved for unlisted exercises.
- **Custom GIFs for dataset-absent exercises** — Ab Wheel, Face Pull, Pec Deck, Hip Flexor Raise
- ~~**Body-fat-aware goal recommendations**~~ — ✅ Done (session 130 cont.) — `calculateBaseline` now uses Katch-McArdle BMR and lean-mass protein dosing when body fat % is available in body_metrics; falls back to Mifflin-St Jeor / total-weight protein otherwise. 24 unit tests.
- **Exercises should be ID-referenced, not name-referenced** (noted session 120) — `session_exercises.exercise_name`, `exercise_logs.exercise_name`, `personal_records.exercise_name`, and `exercise_gif_cache.exercise_name` all key off the exercise's display name rather than `exercise_library.id`, mirroring the anti-pattern the "Session identity = DB id, not name" rule exists to prevent. Session 120's `adminUpdateExercise` works around this by cascading renames across all four tables, but a dedicated refactor — adding an `exercise_id` (uuid) foreign key to each of these tables, backfilling it from `exercise_library`, and reading/writing by id everywhere — would remove the need for cascades entirely and let exercises be renamed (or merged) freely without risk of orphaning historical data.

---

## Version History

Versions are tracked in `lib/changelog.ts` and displayed in the app under Profile → About.
Bump `package.json` version and add an entry to `CHANGELOG` at the start of each session that ships user-visible changes.

| Version | Date | Session | Summary |
|---------|------|---------|---------|
| 1.49.0 | 2026-06-17 | 132 | Health > Progress: Strength Trend card — 90-day 1RM sparklines for each program exercise, % gain, peak, swipeable navigator. |
| 1.48.0 | 2026-06-17 | 132 | Done screen: real volume (kg) + actual sets logged; per-PR share buttons (F-5); weekly stats card shows total volume instead of avg intensity. |
| 1.47.0 | 2026-06-17 | 132 | Health > Training: Weekly Volume card — sets per muscle group this week vs. 10–20 sets/week hypertrophy target, color-coded bars with target marker. |
| 1.46.0 | 2026-06-17 | 131 | Exercise library picker in program editor — book icon opens a bottom sheet with search and equipment filter chips. |
| 1.45.1 | 2026-06-17 | 131 | Achievements API now reads from denormalized user_stats table — eliminates 3 aggregate queries on every load (F-12). |
| 1.45.0 | 2026-06-17 | 131 | Workout reminder notifications — toggle + time picker in program editor; reconciled on app open/resume; cancelled on workout start. |
| 1.44.0 | 2026-06-17 | 130 | Lean-mass-aware nutrition recommendations: Katch-McArdle BMR and protein dosed per lean mass kg when body fat % is logged. Calendar legend now wraps for 4+ sessions. |
| 1.43.0 | 2026-06-17 | 130 | Sprints 2–10: cachedFetch for stats/exercise-history, Health Connect calories+HRV permissions, app-resume rest-timer reconciliation, "Sync now" button, QuickEdit/nutrition migration to Radix Sheet, component breakups (health-content, session-select, config-screen, builder-wizard, chat, profile), per-session phase tracking fixes — see session 130 notes. |
| 1.42.4 | 2026-06-17 | 128 | Fixed food logging always failing with "Failed to save food item" — client was sending `brand: null` / `barcode: null` which zod's `.optional()` rejects (accepts `undefined`, not `null`). |
| 1.41.1 | 2026-06-15 | 122 | Fixed the Goals card's "Workouts" target on Health > Progress disagreeing with the home screen's "This Week" target for rotation-style programs — see session 122 notes. |
| 1.41.0 | 2026-06-15 | 121 | Health > Progress redesign: Estimated 1RM cards gain a Latest/Working Set toggle, a new Goals card (Steps/Calories/Water/Sleep/Workouts with Today/This Week toggle), and direction-aware Weight/Body Fat long-term goal progress in the Weight Trend card — see session 121 notes. |
| 1.35.11 | 2026-06-14 | 110 | Re-anchors the block-cycle position from training history whenever the Phase Set is changed on an already-automatic program (not just on first activation). Sync-workout now records PRs the same way live logging does — see session 110 notes. |
| 1.35.10 | 2026-06-14 | 109 | Fixed workout sessions getting relinked to the wrong program session after reordering/removing a session in Workout Config (identity-based relink). Fixed multi-exercise sessions straddling a phase-cycle boundary scoring later exercises against a different phase than the first — see session 109 notes. |
| 1.35.9 | 2026-06-14 | 108 | Replaced "On program" (Profile, automatic-phase programs) with overall block-cycle progress — "Cycle X/Y" + current phase name, reusing the existing phase engine — see session 108 follow-up #4 notes. |
| 1.35.8 | 2026-06-14 | 108 | Fixed "On program" (Profile) reporting total time since a user's first-ever workout instead of time on the current automatic-phase block — now clamped to `cycle_anchor_at`/`started_at` — see session 108 follow-up #3 notes. |
| 1.35.7 | 2026-06-14 | 108 | Follow-up data repair: 066's relink was skipped for users with name collisions across multiple programs (old + active); 067 scopes the same relink to the active program only — see session 108 follow-up #2 notes. |
| 1.35.6 | 2026-06-14 | 108 | One-time data repair: backfills `workout_sessions.session_id` for rows orphaned by config saves before 1.35.5, fixing "Never trained" on already-completed sessions — see session 108 follow-up notes. |
| 1.35.5 | 2026-06-14 | 108 | Fixed "Never trained" regression after editing an exercise's role in Workout Config right after completing that session (`saveProgram` now re-links `workout_sessions.session_id` across the delete+recreate of `program_sessions`). Fixed the "Leave workout?" dialog incorrectly appearing on the session-select screen after a workout was already completed — see session 108 notes. |
| 1.35.4 | 2026-06-14 | 107 | Fixed the *actual* root cause of phase progression being stuck on Baseline/Testing cycle 1 — `countSessionsSinceStart` joined on a `session_id` column that gets nulled out by every program save, so the count was always 0. Dropped the join, added `cycle_anchor_at` (live, DB-truth session counting), and replaced "Block Start"/"Recalibrate" with fully automatic calibration from training history plus a one-tap "Recalibrate cycle position" button — see session 107 notes. |
| 1.35.3 | 2026-06-14 | 107 | Added a "Block Start" date field to automatic-phase programs in Workout Config so the block-cycle anchor date can be corrected manually — see session 107 notes. (Superseded by 1.35.4 — did not fix the underlying bug.) |
| 1.35.2 | 2026-06-14 | 107 | Fixed automatic phase progression getting permanently stuck on Baseline/Testing cycle 1 — `programs.started_at` is now anchored on first entering automatic mode, so block cycles advance correctly — see session 107 notes. |
| 1.35.1 | 2026-06-14 | 106 | Fixed repeating meal reminder notifications and added tap-to-open → Nutrition page — see session 106 notes. |
| 1.34.0 | 2026-06-13 | 103 | Ten UI/bug fixes from user feedback: UV index on weather chip, Nutrition card link fix, Health defaults to Training tab, 12-hour activity times, Estimated 1RM progress card, "Trained today" fix, profile screen rework (centred title, copy friend code, icon stats grid with distance/sets), weekly step goal option, smaller toggle switches, Workout Config back button fix — see session 103 notes. |
| 1.33.0 | 2026-06-13 | 102 | Meal reminder notifications — see session 102 notes. |
| 1.32.1 | 2026-06-13 | 101 | Fixed program editor drag-and-drop reorder not persisting — see session 101 notes. |
| 1.32.0 | 2026-06-13 | 101 | Friend profile views (tap a friend in the feed/leaderboard to see their avatar, title, level/XP, lifetime stats, and trophy case via shared `computeAchievements`); runner profiles gain a total-distance stat; program editor gains drag-and-drop session/exercise reordering via `@dnd-kit/react`; plus readability fixes for session-name text and Health vital cards, and a fix for the accent colour reverting to green — see session 101 notes. |
| 1.31.0 | 2026-06-13 | 100 | Batched uplift: home Streak card and 10-day bar strip now reflect training history across month boundaries via new `/api/streak-data`; workout streak now matches Achievements' definition (1 rest day tolerance); plus design/accessibility, performance, and security fixes — see session 100 notes. |
| 1.30.3 | 2026-06-12 | 99 | Dynamic background's night sky now reaches the near-black `deepNight` palette within 2 hours of sunset and holds it until ~2 hours before sunrise, instead of slowly fading from the pink/magenta dusk palette over 5-6 hours. Added keyframes to `buildKeyframes()` in `lib/background/day-phase.ts`. |
| 1.30.2 | 2026-06-12 | 98 | 1.30.1's fix was incomplete: it changed `'ActivitySession'` → `'ExerciseSession'`, but the project pins `androidx.health.connect:connect-client:1.1.0-alpha11`, whose `RECORDS_TYPE_NAME_MAP` uses the legacy key `'ActivitySession'` (not `'ExerciseSession'`) — so the new key was *also* invalid, and the real bug (`'HeartRate'` should be `'HeartRateSeries'` in this alpha) was never fixed. Reverted to `'ActivitySession'` and corrected `'HeartRate'` → `'HeartRateSeries'` across `lib/health-connect-sync.ts` (permissions request, `canRead` checks, `readRecords` calls). Web-only fix, no APK rebuild needed. |
| 1.30.1 | 2026-06-12 | 97 | Bug fixes from first device testing of 1.30.0: weight dial haptic tick now uses `Haptics.impact()` instead of `Haptics.selectionChanged()` (which is a no-op on Android without a prior `selectionStart()`); Health Connect sync's `requestPermissions({read:[...]})` used the invalid record type `'ActivitySession'`, which made the native plugin reject the *entire* permissions request with "Invalid records specified" — blocking steps/HR/weight/sleep sync as well. Corrected to `'ExerciseSession'` (the real AndroidX `RECORDS_TYPE_NAME_MAP` key) in `lib/health-connect-sync.ts`. Web-only fix, no APK rebuild needed (Capacitor app loads the live Railway URL). ⚠️ This fix turned out to be incorrect — see 1.30.2. |
| 1.30.0 | 2026-06-12 | 96 | Added `@capacitor/haptics`, `@capacitor/local-notifications`, `@capacitor/status-bar`, `@capacitor/network`, `@capacitor/camera` (and wired up the previously-unsynced `@capacitor/geolocation`). Native haptics replace raw `navigator.vibrate()` everywhere; rest timer fires a local notification when it ends even if backgrounded; status bar set to dark style; nutrition photo capture uses the native camera/gallery picker; SQLite outbox drains immediately on network reconnect. `android/app/build.gradle` versionCode/versionName brought in line with `package.json` (was stuck at 2 / 1.14.0). |
| 1.29.4 | 2026-06-12 | 95 | Fixed an exercise shared between two sessions (e.g. an exercise that appears in both Push and Upper) incorrectly showing as already done in the other session's Recommended Workout list — "done today" is now scoped to the program session, both server-side and in the persisted client store. |
| 1.29.3 | 2026-06-12 | 94 | Home header: weather chip moved next to the date row (was crowding the greeting line) and the greeting now wraps to 2 lines (`line-clamp-2`) instead of truncating, so longer display names aren't cut off. |
| 1.29.2 | 2026-06-12 | 94 | Visual polish pass on the dynamic background (1.29.1): `accentCardStyle()` and the Home "Recommended/Trained Today" card now layer their accent gradient over a translucent `--muted` base (matching the Health "Training Load" card), fixing low-contrast cards on Home/Health. Fixed Workout Config sub-page and Nutrition meal/macro cards rendering fully opaque instead of showing the dynamic background. Wrapped the Health > Training calendar in its own card, fixing the sun/moon glow overlapping date cells. |
| 1.29.1 | 2026-06-12 | 93 | Fixed the dynamic background (shipped in 1.29.0) not rendering at all — `body`'s opaque `bg-background` painted above the `z-index: -1` background layer, and each page's root container had its own opaque `bg-background` on top of `<main>`. Moved the base background to `<html>` and added a `bg-page` utility that `DynamicBackground` makes transparent only when active for the current section. Fallback-location search now returns multiple geocoding matches (with region/country) to pick from instead of auto-selecting the first, and clarifies postcodes aren't supported. |
| 1.29.0 | 2026-06-12 | 92 | New optional dynamic background: an animated sky scene (gradient, sun/moon, weather effects via Open-Meteo) that follows time of day and local weather, in the style of the Samsung Weather app. Enable per-section (Home/Health/Workout/Nutrition/More) from Profile > Theme & Appearance, with a fallback-location search. Home screen also gets a small weather chip (icon + temperature) in the header. Off by default. |
| 1.28.0 | 2026-06-12 | 91 | AI workout builder phase-cycle customisation now auto-generates a per-program "owned" phase progression clone named `<template> (<program name>)`, linked via `phase_sets.owner_program_id`. Renaming a program cascades the rename to its owned clone; deleting a program always deletes its owned clone (replacing the old `(custom-xxxxxxxx)` orphan-cleanup heuristic). Program names are now unique per user — saving a duplicate name returns a 409 with a friendly toast instead of silently overwriting the existing program's sessions. `workout_sessions.phase_type` is now a write-time snapshot, decoupling historical deload/testing analytics from `program_phases` row lifecycle. |
| 1.27.0 | 2026-06-11 | 90 | UI/UX batch: Trophy Case + achievements merged into Profile (standalone Achievements tab removed); Health > Training shows the calendar before the training load chart; Strength/Hypertrophy/S+H/Powerbuilding Progression, Baselining, and Linear Progression phase sets are now read-only "Default" templates (clone to customise); widget colour pickers replaced with a curated MMO-rarity swatch grid (Common/Uncommon/Rare/Epic/Arcane/Legendary/Mythic/Primal) plus a custom fallback. |
| 1.26.0 | 2026-06-11 | 88 | Live-timer activity tracking: "Log Activity" now opens a pre→active→done flow with a running timer (mirrors the workout flow), live GPS distance/pace + route map for distance-based types (Walk, Run, Cycle, Hike, Swim), and saves route polyline, splits, best efforts, pace series, avg pace, and elevation gain/loss (`activity_logs` migration `059_activity_route_data.sql`, `lib/activity/route-encoding.ts`, `lib/activity/activity-metrics.ts`, `lib/stores/activity-store.ts`, `app/activity/`, `components/activity/`). New shared `ActivityDetailSheet` (stats + Leaflet route map + splits) opens from the Health > Training calendar day overlay and the Activities card. ⚠️ Real screen-off background GPS (`@capacitor-community/background-geolocation`) needs testing on a physical Android device — only the web `navigator.geolocation` fallback was verified in the sandbox. |
| 1.25.4 | 2026-06-11 | 87 | Home screen card widgets (Body Weight, Nutrition, Sleep, Steps, Mood, Streak, This Week) can now be dragged to reorder in edit mode, fixing a long-standing issue where only the Recommended Today card could be moved. Training Load chart on Health > Training now shows a colour legend for session names. |
| 1.25.3 | 2026-06-11 | 87 | Steps "Log" button on the Health page now matches the Weight/Body Fat buttons; the floating "Log" button on Body tab metric tiles is slightly larger for easier tapping. Backend: orphaned custom phase sets are cleaned up automatically when program phase settings change. |
| 1.25.2 | 2026-06-11 | 87 | Food logger, food library, and quick-edit nutrition sheets now close on the Android back gesture (`useSheetBackDismiss` pushes/pops a history entry) instead of leaving the sheet open and navigating away from the page. |
| 1.25.1 | 2026-06-11 | 86 | Fixed post-workout summary screen instantly bouncing back to the workout/pre-workout screen on completion (stale-session reset effect was keying off the whole zustand store object and re-firing the moment `mode` became "done"); also let "Complete Workout" be tapped repeatedly, firing duplicate completion/calendar requests. Effect now only runs on session mount; completion handlers guarded with a ref. |
| 1.25.0 | 2026-06-10 | 83 | Health Calendar marks days with a logged activity (separate cyan dot from workout-session dots); tapping such a day shows an Activities section in the day overview (icon, time, duration, distance, calories) with delete support. `getCalendarData` now returns `{ trainedDays, activityDays }`. |
| 1.24.0 | 2026-06-10 | 82 | Activity tracking redesign: `activity_logs` (replaces `cardio_sessions`) + `activity_types` catalog (admin-manageable, Phosphor icons). Log Activity sheet on Workout Select replaces the placeholder button — pick a type, title, time, duration, distance, calories, notes. Health > Training tab gets an Activities history card (last 14 days, expandable for HR/notes). Admin Console gets an Activities tab for CRUD on activity types. Health Connect sync now backfills HR/distance/calories onto recent activity logs once that data lands (`enrichActivityLogs`). Removed `/api/health-connect/webhook` and `/api/log-exercise-session` (superseded by `/api/sync-health` + `/api/activity-logs`). |
| 1.23.1 | 2026-06-10 | 81 | Profile cleanup: `/profile` (legacy "Goals & Profile Settings" page) now redirects to `/more`. Admin Console and Home Widgets (metric tile/card widget visibility + colours, weight sparkline lookback) moved into the More > Profile tab. Home avatar button and Health "→ Goals" row now link to `/more` instead of the dead `/profile` page. |
| 1.23.0 | 2026-06-10 | 80 | Bodyweight exercise support: `exercise_library.exercise_type` (`weighted`/`bodyweight`, migration 057, backfilled by exact equipment match). Active workout, set cards, and summary screen show a rep-first UI with collapsible added/assisted weight for bodyweight exercises; weight-target/warmup/Next-Session sections suppressed. `log-exercise` substitutes the user's bodyweight (90-day lookback) + added load as the effective weight for 1RM/PR/intensity; `set_logs.weightKg` keeps storing the raw added weight (volume = added weight × reps only). Admin exercise manager and Add Exercise sheet gain a Weighted/Bodyweight toggle. |
| 1.22.0 | 2026-06-09 | 79 | AI-gated exercise addition: any user can add exercises to the global library from stats search, workout builder swap panel, or admin manager. Gemini generates normalized name (equipment-prefixed), instructions, muscles, and equipment from just a name; fuzzy duplicate check offers "Use" / "Rename & use" merge. Admin form gets an inline AI "Generate" button. Post-ship fixes: AddExerciseSheet fuzzy match was empty when the session cache mirror wasn't warmed (now falls back to a direct fetch); AI naming now follows the equipment-prefix convention (e.g. "Hip Thrust" → "Barbell Hip Thrust"). |
| 1.21.0 | 2026-06-09 | 78 | App review fix batch: food delete confirmation dialog, drag-reorder index mapping fix (hidden sections), day overlay UTC date fix, distance tile onClick removed, localStorage IIFEs → useState, cache TTL epoch ms, achievements Cache-Control, accentCardStyle deduped to lib/utils, ta_wc_ cache keys use session ID, AI Analysis dead branch removed. Exercise admin Save failed fixed (null gifUrl/imageUrl rejected by Zod schema). |
| 1.20.9 | 2026-06-09 | 77 | Recommended Today colour picker (H2). AMRAP baseline reps capped at 36 (B12). Known Issues table audited — B8/B13/B14/B17/B18/B19/B20/B22 struck through as already fixed in prior sessions. |
| 1.20.8 | 2026-06-09 | 76 | Sleep vs Performance switches from raw avg 1RM to % deviation from per-exercise baseline — removes exercise-selection bias. Buckets show +X%/−X%; exercises need ≥3 sessions to qualify. |
| 1.20.7 | 2026-06-09 | 75 | ACWR requires ≥4 non-deload sessions with ≥2 older than 7 days before showing a ratio. Sleep vs Performance card shows consistent "Not enough data yet" state when hasSufficientData is false. |
| 1.20.6 | 2026-06-09 | 74 | Calendar edit/delete restored on Health→Training day detail sheet. Double-macro footer actually fixed in meal-card.tsx. SW cache ta-v7 flush. Nixpacks build cache cuts Railway deploy from ~7 min to ~2 min. |
| 1.20.5 | 2026-06-09 | 73 | Saved Meals reworked as single tabbed sheet (My Meals + Build inline), title localStorage persistence, SparklineChart dynamic import, optimizePackageImports for icons/motion. |
| 1.20.4 | 2026-06-09 | 72 | Edit saved meals (pencil icon → pre-populated builder + PUT endpoint), tappable title on Profile tab, B9 exercise summary grid overflow fix. |
| 1.20.3 | 2026-06-09 | 71 | More > Profile tab now shows full rich profile UI: avatar/hero, level/XP, stats, achievements, goals accordion, appearance. Separate Goals & Profile Settings link removed. |
| 1.20.2 | 2026-06-09 | 70 | Nutrition scan: photo preview + optional context text field before AI analysis. |
| 1.20.1 | 2026-06-09 | 69 | Bug fixes: profile name blank on load, cycle progress bar always empty (missing sessionId on log-exercise), progress bar now per-phase, nutrition scan network error swallowing real AI errors. |
| 1.20.0 | 2026-06-08 | 68 | Nav restructure (5-tab: Home/Nutrition/Workout/Health/More), friend system (TAI-XXXX codes, add friends, activity feed, leaderboard), achievement tiers + shimmer, trophy case, equippable titles, season badges, public profiles, weekly digest friends context. |
| 1.19.0 | 2026-06-08 | 67 | Full-codebase review: 21 bugs fixed across data integrity, timezone, cache consistency, and mobile UX. |
| 1.18.0 | 2026-06-08 | 66 | Baseline phase: optional AMRAP test week at program start seeds working weights from a scaled 1RM estimate. Builder review toggle prepends a Baseline cycle to the phase set on save. Active workout shows AMRAP Test UI (instructions, suggested weight, 'A' badge, no warmup). log-exercise uses a rep-band scale factor during baseline to produce conservative 1RM. PRs recorded during baseline regardless of deload state. |
| 1.17.0 | 2026-06-07 | 65 | Home: scroll lock fix (touch-action: none only on actively dragged item); card widget + streak/this week colour pickers via ta_card_colors localStorage. Nutrition: Saved Meals collapsible section on Health tab, food logger tabs (Recent / Saved Meals / Add Food), meal builder "Add new food" escape hatch when search returns no results. Builder: Program Length step (week presets + custom), editable per-phase cycle counts on review screen scaled to totalWeeks, phase-sets clone API for custom cycles, linear mode forces empty phases, Linear Progression removed from Phase Structure step. |
| 1.16.0 | 2026-06-07 | 64 | Batch A UI fixes: home metric tiles navigate to /health?tab=body, streak/week taps to /stats, mood icon updated. Profile: Goals renamed, duplicate achievements button removed, safe-area padding. Config: Advanced Settings accordion (Progression Sets + Phase Sets) inside Workouts section. Body screen: Distance/Burned/BMI/Trend/Balance/Lean Mass tiles. Sex field on profile (DB migration 050, JWT, edit form with birth year only). BMI label uses body fat % classification when available (sex-specific thresholds). Log buttons on Body Fat + Steps tiles. Toggleable ⓘ info buttons on BMI, Trend, Balance, Lean Mass tiles. |
| 1.15.0 | 2026-06-07 | 63 | APK: long-press drag without edit button (native WebView long-click suppression), screen keep-awake during workout (ScreenBridge), PiP pre-screen guard, VIBRATE permission, versionCode bump. Goal spectrum PB range fix (75→80%). Dynamic weekly target denominator. Cache invalidation after metric/food/target saves. Mood, readiness, day-log now cached. Sign-out clears cache. Security: LIKE wildcard escape, complete-workout ownership check. Timezone fix for AI chat and sleep correlation 14/90-day windows. Builder review null-style amber warning. katex explicit dependency. |
| 1.14.0 | 2026-06-07 | 63 | S+H Peak phase null style fixed (migration 048). Goal selector redesigned as spectrum scale. Home screen section hide/show with edit mode eye icon and Profile toggles. |
| 1.13.2 | 2026-06-06 | 62 | Bug fixes: Health Connect cross-day step aggregation, goal phase set null style IDs (migration 047), phase ~Xw left showing whole-block instead of current phase. |
| 1.13.1 | 2026-06-06 | 61 | PiP polish: circular ring timer replaces plain text, set-phase buttons reordered to Reps −/Reps +/Log. Fixed Java `onStart`/`onStop` access modifier compile error. |
| 1.13.0 | 2026-06-06 | 60 | In-app APK download link: auth-gated `/api/download-apk` redirects to latest GitHub release. Dismissible home screen banner + permanent Profile → About row. |
| 1.12.0 | 2026-06-06 | 59 | Goal-specific phase progressions in AI builder (Hypertrophy/S+H/Powerbuilding/Strength each auto-select correct phase set). Phase progression timeline shown in builder review. Fixed back-navigation clearing stale program. Fixed Powerbuilding Progression Accumulation phase showing no style info. |
| 1.11.0 | 2026-06-05 | 56 | Finishing touches: builder large-muscle volume priority, clean session names (Push/Pull/Legs/Upper Push/Lower Squat), individual card widget drag, nutrition custom save name, Lucide icons replacing static emoji, free-hue colour slider. |
| 1.10.1 | 2026-06-05 | 55 | APK fix: tinted card backgrounds (streak/week/nutrition) disappearing due to Samsung WebView GPU compositor bug triggered by SVG strokeDasharray. Replaced nutrition donut SVG with CSS conic-gradient + mask. Also fixed: FOUC dark-class flash, Meteors unscoped CSS, service worker cache flush. |
| 1.10.0 | 2026-06-05 | 54 | Builder: 6 new progression style variants (Hypertrophy 3-set, Strength 3-set/4-set, Peak 4-set, General 4-set, Powerbuilding 4×6 @ 80%). Strength updated to 5×5. Per-goal style rules (hypertrophy/strength/powerbuilding). Accurate time budget formula (reps×4s + restSec). 1RM default logic fix. 4 P1 builder bugs fixed (chat style context, swap preserves style, JSON.parse guard, empty exercise guard). Time budget baseline uses Powerbuilding for strength+hypertrophy goal. |
| 1.9.0 | 2026-06-04 | 53 | Gamification: XP earned card on done screen, PR pulse badge on exercise summary, haptic feedback on set log and workout complete, animated achievements toggle. Hardening: Zod validation on /api/log-exercise, admin JWT DB re-check, redundant auth() removed. Performance: batch program+phases fetch (N+1 fix), paginated admin user listing. UI: safe-area footer fix, WeightDial overflow fix, achievement preview now shows large square badge cards (latest 4 unlocked). |
| 1.8.3 | 2026-06-04 | 52 | Bug fixes: Barbell Squat GIF corrected (→ Barbell Full Squat in dataset), Dumbbell Curl GIF corrected, GIF sync now covers all library exercises (not just program/history), unmatched count accurate, recovery pills show all session muscles, stale home-screen metrics cache date-validated, workout UUID flash fixed, bottom nav consistent on admin and profile pages, admin exercises tab label fixed. |
| 1.8.2 | 2026-06-04 | 51 | Bug fixes + exercise library rename. Session UUID shown as name fixed. Upper-body muscles in Legs heatmap fixed. Verbose session names (calendar, training load, stats) stripped with shortSessionName(). Program activation optimistic update. Schedule step in AI builder (rolling rotation + dynamic example). Role-aware equipment prefix (barbell for primary, cable for accessory). Migration 032: splits generic exercises into equipment-specific variants (Barbell Squat, Dumbbell RDL, etc.); updates all history/PR refs; clears stale GIF cache. GIF matcher overrides for all new names. Repository CRUD for exercise library. |
| 1.8.1 | 2026-06-03 | 50 | Code review uplift: 13 fixes across timezone bugs, DB batch writes, security hardening, UX improvements. Phase context in active workout, meal type drag-to-reorder, safe-area insets on all scroll pages, semantic section headings, SyncProvider error handling. |
| 1.8.0 | 2026-06-03 | 49 | AI-powered workout builder: 7-step wizard generates programs via Gemini, exercise swap dropdowns, AI refinement chat, saves to templates. Science-backed volume guidelines, split recommendations (PPL for 3d, UL×2 for 4d, etc.), home/commercial equipment toggle. WeightDial centering fix. |
| 1.7.2 | 2026-06-02 | 46 | Tier 3 & 4 fixes: accessibility labels, food logger navigation, 44dp touch targets, exercise stats error handling, rate-limit pruning, parameter validation, responsive timer/dial, cachedFetch locking. |
| 1.7.1 | 2026-06-02 | 45 | Security & UX fixes: session state isolation, 48dp touch targets, Math.max guard, store date reset. All Tier 1 & 2 security/bug fixes from Uplift Backlog. |
| 1.7.0 | 2026-06-02 | 44 | Block Periodization: phase engine, phase editor, default style seeding, accessory phase type, deload exclusions from stats/ACWR, phase badges on session cards, block progress and early deload cards on home screen. |
| 1.6.0 | 2026-06-01 | 42 | Nutrition polish: 7-day chart, recent-items quick-log, daily calorie progress in Assign, confidence bar, barcode-not-found screen, nutrition context in AI chat. Cache bug fix, package renamed. |
| 1.5.2 | 2026-06-01 | 41 | Bug fixes: barcode scan per-serving macros, food log AEST date, live serving size scaling in Review step. |
| 1.5.1 | 2026-05-31 | 40 | Bug fixes: native Capacitor barcode scanner working, nutrition cache + AEST timezone, warmup GIFs, session timer carry-over, leave-workout confirmation dialog. |
| 1.5.0 | 2026-05-31 | 39 | Full nutrition logging system: AI photo scan, barcode scan, free-text AI, manual entry, dynamic meal types, saved meal templates, custom macro targets, region setting. |
| 1.4.0 | 2026-05-31 | 37 | Timezone audit (GMT+10 throughout), stats page redesign (calendar → load → AI pill), volume-based training load bars, compact weekly AI summary pill, hardcoded name cleanup. |
| 1.3.0 | 2026-05-30 | 36 | Exercise GIF/thumbnail library (forked dataset, lazy DB cache), AI chat context truncation. |
| 1.2.1 | 2026-05-30 | 35 | Morning briefing as dismissible sheet, AEST date fix, muscle recovery marquee, session-filtered pills, recovery cache, CLAUDE.md cleanup. |
| 1.2.0 | 2026-05-30 | 34 | Muscle recovery estimator, dynamic exercise library filters, AI morning briefing card, ACWR/Sleep cards moved to Health. Post-deploy bug fixes: admin JWT speed, pending badge, calendar 12am, markdown rendering. |
| 1.1.0 | 2026-05-30 | 33 | Tier 1–3 feature batch: admin badge, AI truncation, program week tracker, real workout start time, lean mass chart, ACWR, PR tracker, readiness score, sleep correlation, weekly AI digest, hardcoded-session cleanup. |
| 1.0.0 | 2026-05-30 | 30 | First versioned release. Animated workout select carousel, Chart.js sparklines, SpO₂/HRV/RHR sync, offline-first logging, Zustand state persistence, native Android APK. |

---


## Session 169 — Program Structure in the SQLite Pull Delta (2026-06-30) ✅ Shipped (device verification pending)

### Headline
Closed the last device-deferred offline-first item: the workout screen can now render a user's program (sessions → exercises, schedule, per-set progression) from the on-device SQLite store when offline, instead of always depending on a live `/api/workout-data` fetch. Shipped as PR #45, v1.69.0 → v1.70.0. Server half runtime-verified against the local dev DB; client (SQLite) half is device-only and awaits S25 confirmation.

### Why it was bigger than the backlog one-liner
The note ("Program structure not in SQLite pull delta") implied the data was already arriving and just needed writing locally. It wasn't: `getSyncDelta` selected only the *flat* `programs` + `progression_styles` rows — none of `program_sessions` / `session_exercises` / `schedules` / `schedule_days` / `style_sets`. So both halves had to grow: the server delta **and** the client SQLite layer.

### What shipped
- **Server delta (`lib/data/postgres/adapter.ts`).** `getSyncDelta` now also returns `programSessions`, `sessionExercises`, `schedules`, `scheduleDays`, `styleSets`. Children are gated on a changed parent: derive the changed program/style ids from the existing `updatedAt > since` parent selects, then re-send the full subtree for those parents only. An unchanged window returns empty child arrays (respects `since`). `SyncDelta` (`lib/data/repository.ts`) extended with the 5 fields.
- **Latent bug fixed (`lib/data/postgres/slices/programs.ts`).** `saveProgressionStyle` only set `name` on update, never `updatedAt` — so set-only edits (and even renames) never surfaced in the delta, which keys the style subtree off that column. Now bumps `updatedAt`.
- **Local schema v9 (`lib/sqlite/migrations.ts`).** New mirror tables `program_sessions` / `session_exercises` / `schedules` / `schedule_days` / `style_sets` (no FK constraints, denormalized parent-id columns) + new `local_programs` columns (`phase_mode`, `training_goal`, `started_at`, `sessions_per_cycle`, `total_weeks`, `auto_apply_prescriptions`, `created_at`). All registered in `RECONCILE_TABLES` / `RECONCILE_COLUMNS` so a partially-applied upgrade self-heals (the backstop that saved the WAL incident). No pragmas in the migration.
- **Local write (`lib/local-store/sqlite-backend.ts`).** `applyDelta` upserts the extended program/style parents, then **replaces children wholesale** for any changed parent (delete-then-insert by `program_id` / `style_id`) so renames/removals propagate. Read-only mirror — no `sync_status` guard, no outbox (mirrors `oura_daily` / `personal_records`).
- **Local read.** `getActiveProgramLocal()` reads the 6 row sets and delegates to a **pure, unit-tested assembler** (`lib/local-store/program-assembler.ts`) that reconstructs the active program into the `WorkoutExercise[]` shape the screen consumes (server-computed fields — last weights, 1RM, "logged today", phase-resolved style — intentionally null/empty offline). 7 tests in `lib/__tests__/program-assembler.test.ts`.
- **Sync-engine (`lib/local-store/sync-engine.ts`).** Maps the 5 new delta arrays into the local types, passes them to `applyDelta`, and folds them into the `domains.programs` signal (which `sync-provider.tsx` already uses to call `invalidateProgramStructure()`).
- **Workout screen (`components/workout-screen.tsx`).** When there's no sessionStorage cache, seeds program structure from `getActiveProgramLocal()` (no-op on web where SQLite is unavailable); the network response still overwrites once available.

### Verification
- `tsc --noEmit` clean · `pnpm lint` 0 errors · 257/257 tests pass (7 new) · `pnpm build` clean.
- Server delta runtime-checked against the seeded local dev DB (`test@local.dev`): full pull → 1 program / 3 sessions / 9 exercises / 1 schedule / 16 styles / 63 style-sets; `since`-now pull → all child arrays empty.

### ⚠️ Device-only checklist (still pending, S25 after deploy)
1. Fresh launch → v9 migration runs, no `[initSQLite] failed`.
2. Pull-to-sync online → the 5 new local tables populate.
3. Airplane mode → cold-open workout screen → tabs / exercises / per-set targets render from local.
4. Edit program on web → pull-to-sync → change reflects locally (replace-children).
5. No online regression.

## Session 169 (hotfix) — Mood Check-in Sync Failure + Food Investigation (2026-06-30) ✅ Device-confirmed

### Headline
After the v1.70.0 deploy, the user reported on the APK that (1) the daily mood check-in reappeared on every app open (mood not saving) and (2) logged food items disappeared on revisit — while workout logging saved fine. Root-caused and fixed the mood bug (#47, v1.70.1, device-confirmed); food self-resolved with no code change after investigation showed all its paths were clean.

### Mood — root cause (reproduced against the local dev DB)
The mood check-in stopped collecting sleep quality, so the queued outbox mutation payload is `{ energyLevel, bodyState, soreMuscles }` — no `sleepQuality`. The local store hardcodes `sleepQuality: 'ok'` and `/api/mood` (web path) defaults `sleepQuality ?? 'ok'`, but the **sync-push** branch in `adapter.pushMutations` passed `p.sleepQuality` (undefined) straight into `saveMoodLog`. `mood_logs.sleep_quality` is `NOT NULL`, so Postgres rejected the insert; the mutation errored, stayed stranded in the on-device `mutations_outbox`, and the mood never reached the server. The check-in read back empty → re-prompted on every launch. Only the APK was affected (it writes via the local-first outbox → sync-push); web users hit `/api/mood`, which already had the default.

Reproduced: `repo.pushMutations(userId, [{ domain: 'mood_logs', date, payload: { energyLevel:'good', bodyState:[], soreMuscles:[] } }])` → `processed:0` with `sleep_quality null violates NOT NULL`. After the fix → `processed:1`, row persists with `sleep_quality: 'ok'`.

Fix (`lib/data/postgres/adapter.ts`): default `sleepQuality: (p.sleepQuality as SleepQuality) ?? 'ok'` in the sync-push mood branch, mirroring `/api/mood` and the local store. Stranded mood mutations on a device drain on the next sync (so recent mood history back-fills). Device-confirmed: mood now persists across full app restarts.

### Food — investigated, no code change
Same symptom (optimistic success, gone on revisit), but every path tested clean against the local dev DB:
- `pushMutations` for a food_logs mutation → `processed:1`, `listFoodLogs` returns it.
- Food still persists when batched in the **same push request** as a failing mood mutation (`processed:1`) — so the mood failure was not collaterally breaking food server-side (no shared transaction; per-mutation try/catch).
- `invalidateCache('nutrition-food-logs-')` uses prefix matching (`LIKE`/`startsWith`), so the post-log cache refresh correctly clears the dated key and re-reads from the server.

Could not reproduce a food failure. Declined to speculatively patch the load-bearing sync layer (3 prior prod outages). The user re-tested on the new deploy: production HTTP logs showed the food save firing `POST /api/sync/push` → 200 and the item persisted ("Mandarin persisted this time"). Conclusion: food was collateral from the wedged/stuck outbox state and self-resolved once the queue drained on the new build.

### Latent risk noted (not changed)
Client `pushMutations` (`lib/local-store/sync-engine.ts`) does `if (!res.ok) break` on any non-OK push response. A future mutation that hard-fails validation (a 4xx from `/api/sync/push`'s Zod schema — e.g. a malformed `date`) that sits early in the FIFO outbox would `break` every push and never be removed, silently wedging the entire local-first queue (mood, food, body metrics, supplements…) while workout logging — which POSTs directly to `/api/log-exercise` — keeps working. No reproduced poison today, so left as-is, but flagged: if "local-first writes silently stop persisting" recurs, harden this to distinguish 4xx (skip/quarantine the bad chunk) from 5xx/429 (back off and retry).

### Verification
- `tsc --noEmit` clean · `pnpm lint` 0 errors · 257/257 tests pass · push repro flips `processed:0 → 1`. PR #47 squash-merged to `main` (`da6fc7f`) and deployed (Railway `668c406d`). Device-confirmed by the user: mood persists, food persists.

## Session 170 — Full App Review / Overview + Backlog Archive (2026-06-30) ✅ Docs-only

### Headline
At a stable point with the backlog cleared, ran a complete review/overview of the app and reorganised the planning docs. No code shipped — review + documentation only. Output: `docs/planned_upgrades.md` (a batched, cleared-of-completed list of new uplift work) plus an archive of the entire shipped plan/spec backlog. Merged via PR #49 (squash, auto-merge).

### What was done
1. **Documentation reconciliation.** Audited all 96 plans + 29 specs against the version history and live code — the entire backlog is shipped. Moved every plan to `docs/superpowers/plans/archive/` and every spec to `docs/superpowers/specs/archive/` (git-renamed, history preserved) so the active planning surface is clean. The only genuinely-open items were already tracked: device-only verifications, the muscle-volume-target setter UI, Phase 10 tier-borders (partial), and Body Battery tuning.
2. **Six-dimension review** (parallel subagents, every finding verified against real code with file:line): security, performance, logic/correctness, UI/data-viz, new features, docs. Findings batched into 8 data/structure-aligned groups in `planned_upgrades.md`.
3. **projectOverview.md** updated to point at the new doc, flag the still-open volume-targets writer gap, and list the archive folders in the Document Map.

### Key findings (high-confidence — flagged by ≥2 reviewers)
- **Volume targets are dead code** — `replaceVolumeTargets`/`upsertVolumeTarget` exist but nothing writes them, so the "Weekly Volume vs Target" card never renders and the AI engine always runs unconstrained (`signals.ts:232`).
- **Two divergent 1RM formulas** — the edit/PATCH route (`workout-entry/route.ts:40`) calls `calculate1RM` with no `style`, recomputing `estimated_1rm`/`target_80` on a lower basis than the original log (`log-exercise.ts:148`).
- **ACWR defined two incompatible ways** — session-count (feeds the AI engine) vs volume-load (readiness card).
- **#41 low-confidence gate is unreachable** — base `0.5 + sessions*0.1` can never fall below the `0.4` threshold, so the confirm shipped last session never fires.
- **Muscle-name matching inconsistent across 3 layers** ("Quads"/"quadriceps"/"quads" silently fail to join).
- Plus: Oura OAuth missing `state` (CSRF), in-memory per-replica rate limiter, AI-chat libs shipped eagerly on 4 screens, 1Hz timer re-rendering the whole workout orchestrator, sync filtering on un-indexed `updated_at` + un-batched `applyDelta`, `body_metrics.steps` never written from Oura, sleep hypnogram unbuilt despite stored `sleepPhase5Min`, 3 near-identical health detail pages, reduced-motion/tap-target a11y gaps.

### The 8 batches (see `docs/planned_upgrades.md` for full detail)
1. Periodization & strength-calc engine (densest correctness cluster) · 2. Biometric & recovery model (Body Battery/Oura) · 3. Sync & DB performance (migration 101) · 4. Client caching & bundle perf · 5. Security hardening · 6. Health data-viz & detail pages · 7. AI chat & proactive push · 8. Workout & nutrition UX features.

### Status
Review complete; batches left for later pending the user's notes. No version bump/changelog (docs-only, no user-visible code). PR #49 merged to `main`. This session-170 note added as a follow-up (PR after the merge of #49).

---

## Session 172 — Workout-UI batch + bodyweight rep-based progression (v1.73.0)

Branch `claude/screen-safe-spacing-pokr38` (single PR). Four screenshot-driven items from the user, brainstormed → spec → plan → implemented, verified end-to-end vs the local dev DB.

### 1. Safe-area header spacing
`.pt-safe`/`.pt-safe-or-4` used `max(1rem, env(safe-area-inset-top))`, which on devices where the inset equals the status-bar height left header content flush against the bar. Changed to `max(1rem, calc(env(safe-area-inset-top,0px) + 0.5rem))` — adds breathing room on-device, unchanged (1rem) where there's no inset. Fixes every `pt-safe` header at once (`app/globals.css`).

### 2. Two clipped 1RM charts
- Ready-screen 1RM **trend sparkline** (`active-workout-screen.tsx`): hand-rolled SVG mapped the max value to the top padding line and drew the value label above it → clipped above the viewBox on an uptrend; the middle-anchored label on the rightmost point also overflowed the right edge. Added top headroom (PAD_TOP) + right-anchored the label.
- Summary **Estimated-1RM sparkline** label (`components/ui/sparkline-chart.tsx`, Chart.js): the last-value plugin drew the label ~17px above the top point but the scale only reserved `grace` data-space. Added `layout.padding.top` so the label renders in full. Covers exercise-stats-sheet too.

### 3. Live 1RM readout under the rest timer
New `components/workout/live-1rm-readout.tsx`, rendered in the rest phase of `active-workout-screen.tsx` once ≥1 set is logged (hidden for bodyweight). Shows `Ø <avg wt> × <avg reps> = <projected 1RM> ▲/▼ <delta>`, colour-coded green (≥ previous 1RM) / red (< previous) / neutral (±0.5kg or no previous). New pure helpers `runningEstimate1RM` + `oneRmTrendStatus` in `lib/1rm.ts` — the projection calls the **same `calculate1RM`** the app saves with (fed the sets logged so far) so it equals the summary's "This session" exactly, with an all-sets fallback for `useFor1rm`-subset styles. Verified via headless browser (screenshot: `Ø 75kg × 8 = 100kg ▲ +2.00`, green).

### 4. Bodyweight = rep-based progression (the big one)
Replaced the body-weight-inflated 1RM for bodyweight exercises with a **reference-weight rep max**. `BW_REF = 100` (internal constant) stands in for the fluctuating weigh-in.
- `lib/workout/log-exercise.ts`: `effectiveWeights = max(1, BW_REF + added)` (no body-metrics read); bodyweight `estimated1rm = bodyweightOneRm(...)` = best-set `calc1RM` at the reference weight, **no** AMRAP/prescription scaling (keeps the reps↔rep-max round-trip clean and stops submaximal sets dragging the number down).
- `lib/1rm.ts`: `bodyweightOneRm` (best set) + `repMaxFromOneRm` (invert `calc1RM` at `BW_REF`, +0.5 rounding tolerance).
- `app/api/workout-data/route.ts`: bodyweight working sets prescribed as `floor(pct × repMax)`, min 1, with `repMax` from `max(lastLog, personalRecord)` — **PR-based so an easy day never lowers targets**. Added `listPersonalRecords` to the batch fetch.
- `components/workout-screen.tsx`: mirrors the bodyweight estimate client-side (caught in testing: `calculate1RM` on zero weights returned 0 → would have shown "0 RM").
- `components/workout/exercise-summary-screen.tsx`: shows **"REP MAX" in reps** (Previous/This session + rep delta) instead of kg; next-session block unhidden for bodyweight, showing per-set rep targets = `max(currentTarget, floor(pct × repMax(newEst1rm)))` so the preview never drifts down.
- **Design decisions** (in the spec): best-set not average (avoids rep-max spiral), PR-based prescription (no drift), round-down min 1. Added weight kept and factored in. No DB migration — historical bodyweight numbers stay, the reference-weight number takes over from the next log.

### Verification
`lib/__tests__/1rm.test.ts` +16 tests (31 total): running-average consistency, useFor1rm fallback, rep-max round-trip, monotonicity, best-set, colour thresholds. tsc clean (pre-existing `web-push` only), lint clean on all touched files. End-to-end: booted `pnpm dev` on the seeded local DB, drove the workout flow with a headless Chromium — confirmed the live readout, and (after temporarily adding a Pull-Up + rep-max PR to the seed) the bodyweight prescription (7,7,7 reps = `floor(75% × 10)`) via the workout-data API and the Pull-Up summary ("REP MAX 7 RM", next-session 7 reps/set). Test data cleaned up afterward.

Specs: `docs/superpowers/specs/2026-07-01-live-1rm-readout-design.md`, `2026-07-01-bodyweight-rep-progression-design.md`. Plans: matching files under `docs/superpowers/plans/`.

---

## Session 175 — Nutrition offline-first hardening + End of Day review (v1.74.4 → v1.75.0)

Closed the long-running "logged food vanishes on reload" bug at its root and shipped the End of Day review. Four PRs (#82 landed prior; #84, #85, #83 this run), all CI-green and merged to `main`.

### The bug, and its three layers
1. **Sync wedge (#82, prior):** one malformed queued mutation 400'd the whole `/api/sync/push` batch, and `if(!res.ok) break` stranded everything behind it. Fixed with per-mutation validation.
2. **Local-only read (#84, v1.74.4):** after #82 moved the Nutrition page to offline-first, `loadFoodLogs` rendered **only** from the on-device store — so any local-store error blanked the list even though the food was saved server-side ("shows, then vanishes on reload", online). Fix: render the local copy instantly (offline-first speed), then **always fetch + render the authoritative server copy when online** and hydrate the local store; fall back to the server copy if the local read/hydrate throws. A local error can no longer blank the list. **Device-confirmed persisting.**
3. **Dead local store (#85, v1.74.5):** the deepest cause. `capacitor-community/sqlite` runs the versioned upgrade in a transaction; `ADD COLUMN` isn't idempotent, so a partially-applied upgrade retried → "duplicate column" → whole upgrade rolls back → `open()` throws → `_db` null → **every** local read empty (food/activity/sleep/mood). Fix in `lib/sqlite/sqlite-service.ts`: wrap the versioned open; on failure `closeConnection` + reopen at **version 1** (never downgrades, so no re-run of the broken upgrade), then the idempotent `reconcileSchema()` brings the schema current.

### #85's key hardening — reconcileSchema as a complete schema mirror
The resilient reopen only heals what `reconcileSchema` knows about. The reconcile lists only covered the most-recently-added tables (v7+) and columns (v7/v8/v9/v11), so a failed **combined** upgrade (e.g. a fresh install jumping v1→v11) that dropped an earlier table would still leave it missing. Audited every migration v1–v11 and closed the gaps:
- **Added 17 tables** to `RECONCILE_TABLES` (base CREATE shapes; later ALTER columns restored by `RECONCILE_COLUMNS`): `workout_sessions`, `exercise_logs`, `set_logs`, `sync_outbox`, `sync_meta`, `api_cache`, `body_metrics`, `mood_logs`, `sleep_sessions`, `activity_logs`, `local_programs`, `local_progression_styles`, `mutations_outbox`, `food_logs`, `supplements`, `supplement_logs`, `injuries` — plus their indexes.
- **Added 4 columns** to `RECONCILE_COLUMNS`: `set_logs.rpe` (v3), `activity_logs.steps/avg_hr/max_hr` (v6).
- Net: `reconcileSchema` is now a complete mirror, so a reopen-at-v1 after **any** partial upgrade can restore whatever was dropped — not just the newest tables.

### End of Day review (#83, v1.75.0)
Replaces the end-of-night `MealBackfillSheet` with a full wrap-up on a new **offline-first `day_checkins` domain**:
- Postgres table (migration `102`) + Drizzle schema; `getDayCheckin`/`saveDayCheckin`; sync push branch + `/api/sync/push` domain enum; `getSyncDelta`/`applyDelta`; **local SQLite v12** table + store methods + outbox; `GET/POST /api/day-checkin` for hydration/web fallback.
- Click-and-forget UX: every structured field is a segmented 1–5 scale opening **pre-filled** from existing signals (`prefillEveningScales`: Body Battery→tiredness, steps→movement, water→hydration, neutral 3 otherwise); journal is the only free text; deterministic `buildTodayInsight` today-only card (no AI call).
- Components under `components/nutrition/end-of-day/` (orchestrator + day-summary / meal-backfill / wellness / journal / today-insight / scale-selector). Trigger: `?chat=backfill` deep-link + a 🌙 button on the Nutrition page.
- Built subagent-per-task with review between phases. Pre-fill + insight helpers are TDD.

### Merge mechanics
Merged #85 first, then merged the new `main` into `feat/end-of-day-review` and resolved three conflicts (keep-both): `lib/sqlite/migrations.ts` (#85's expanded reconcile lists + #83's `CREATE_DAY_CHECKINS` / v12), `lib/changelog.ts` (all three entries in version order), `package.json` (→1.75.0). Then merged #83.

### Verification
tsc clean, lint 0 errors, **372 tests** pass on the merged state; all three PRs 6/6 CI-green. **Device-confirmed:** food persists across reload/reopen after the APK rebuild. ⚠️ Still to spot-check on device: the End of Day sheet's offline write/persist (fill in airplane mode, force-close, reopen). Native SQLite paths (#85 resilient open, #83 v12 table) can't run in the web sandbox — verified at logic/test level.

### Notes for next time
- These are WebView-JS changes served from Railway (`server.url` in `capacitor.config.ts`) — they deploy on merge and take effect on next app launch; **no APK rebuild is strictly required** (only native/plugin changes need one). Corrected the over-cautious "requires rebuild" wording in the v1.74.5 changelog entry.
- Deferred fast-follows (documented in the End of Day spec): a Start-of-Day (morning) mirror on the reserved `phase` column, and correlation analytics ("what drains you") over the typed 1–5 `day_checkins` columns.
- The user's health detail-page work (themed hero backgrounds + 14-day trend sparklines, `/api/health/trends`, `DetailHero`/`TrendSparkline`) sits as 8 unpushed commits on their local `neko/nostalgic-shamir-c2034c` branch — not yet a PR.

Specs: `docs/superpowers/specs/2026-07-01-end-of-day-review-design.md`, `2026-07-01-offline-first-food-persistence-design.md`. Plan: `docs/superpowers/plans/2026-07-01-end-of-day-review.md`. CLAUDE.md gained the "Offline-First — the on-device local store is the source of truth" guardrail + checklist this session.

---

## Session 176 (2026-07-01) — Full eight-dimension app review + complete implementation-plan backlog (docs only)

**No code shipped.** User asked for a full app review across UI, security, data-saving/local-first, performance/caching, logic (1RM + AI programs), AI usage, data/analysis opportunities, and animations/carousel navigation — then detailed implementation plans for the entire backlog, merged to `main`. Branch `claude/app-review-upgrades-19k9n1`.

**Review (8 parallel deep-audits + reconciliation of the session-170 list):**
- **Reconciliation:** of the ~55 session-170 items, only 3 had shipped (volume-target auto-seed, Oura steps → `body_metrics.steps`, RPE autoregulation); 3 partial; the rest open. Migration numbering had gone stale (101/102 taken) — new allocations: Postgres **103–107**, local SQLite **v13–v15**.
- **Offline-first (the "data disappeared" dimension):** two live root causes — `food_items` never rides the pull delta (food logs sync without items; `getFoodLogsWithItems` JOIN silently drops them → fresh install / past dates render empty offline), and the outbox confirm protocol keys on `domain:date` instead of mutation id (one failed food log permanently strands every same-day sibling). Plus: no retry cap/dead-letter/UI for stuck mutations; persistent 5xx in the oldest chunk wedges the whole queue; `workout_sessions`/`activity_logs` pull paths can clobber pending local edits; activity pull drops `calories_burned`/`start_time`.
- **Logic:** emergency-deload prescription stored then immediately nulled by `advancePhase` (never survives a reload); edit-path 1RM ignores style + BW_REF and never reconciles PRs; Brzycki term explodes at 31–36 reps (two paths clamp to 36); `signals.acwr` near-degenerate (single session type, ÷4 weeks regardless of span); auto-apply gated on the LLM's self-reported confidence; realisation phase has no ceiling guard. **User decision recorded: AVERAGE-across-sets 1RM is deliberate** (prescriptionFactor makes on-target sets reproduce the prior 1RM; +1 rep on the last set nudges the average up) — C4 rescoped to aligning the bodyweight (max) and baseline (first-set) paths to the same rule + PR display semantics.
- **Performance/caching:** ~17 uncached read sites (friends/leaderboard/supplements have no cache keys at all); manual Oura sync + injury writes miss invalidation groups (up to 30 min stale); AI-chat markdown/KaTeX stack eager on 4 screens; missing `updated_at` indexes scanned by every sync pull.
- **Security:** posture strong (no IDOR/SQLi; `pushMutations` well-defended) but the Oura webhook signature check is bypassable by omitting the header (fail-open), and the mobile auth deep link uses an interceptable `trainingai://` custom scheme; `supplement_logs` delete in pushMutations not user-scoped; most Batch-5 items from v1 still open. GitHub also reports 55 Dependabot alerts on `main` (27 high) — untriaged.
- **AI usage:** four routes hand-parse JSON (→ `generateObject`); morning-briefing/digest/session-explain uncached (biggest free-tier drain); `prescribe`/`session-explain` unlimited; chat has no Oura/sleep/check-in context and no tools; streams fail silently mid-stream.
- **Data/analytics:** no morning check-in exists but `day_checkins` already types `phase: 'morning'`; Oura tags/session/BDI/rest-mode unsynced; `restTimeSec`/`setStartMs`/RPE stored but never trended.
- **Animations:** Health carousel inline/non-reusable; second hand-rolled swipe in workout-select; `@use-gesture` + Radix `Collapsible` installed but unused; `useReducedMotion` used nowhere; recommended architecture = extract `<SwipeCarousel>` + edge-swipe between the 5 tabs via `document.startViewTransition` (routes kept).

**Deliverables (all on the branch, merged via PR):**
1. `docs/planned_upgrades.md` **v2** — supersedes the session-170 list; exec summary, quick-wins table, batches A–I (I restores the v1 Batch-8 features that the rewrite had dropped: injury-aware substitution, dynamic TDEE, supersets, year-in-review).
2. **Ten task-by-task implementation plans** in `docs/superpowers/plans/`: `2026-07-01-quick-wins.md` + `batch-a-offline-first-integrity` + `batch-b-caching-performance` + `batch-c-training-engine-logic` + `batch-d-security-hardening` + `batch-e-ai-usage` + `batch-f-data-analytics` + `batch-g-ui-system` + `batch-h-animations-navigation` + `batch-i-workout-nutrition-features`. Quick-wins + A–F were written by plan agents (session hit the usage limit mid-run — 7 of 10 survived complete); G/H/I were written inline afterwards, one commit each, to keep token usage trackable.
3. Suggested execution order: quick wins → A → B → C → D → E → F → G/H → I.

**Process notes:** the 10-agent parallel plan fan-out hit the subscription session limit; recovery = commit the 7 completed plans, then write the remaining 3 inline one-at-a-time with a commit each (user preference for tracking usage going forward). Migration allocations pre-assigned across plans so batches can land in any order: 103 = perf indexes (quick wins), 104 = rate-limit store (D), 105 = AI response cache (E, if the 088 table can't be reused), 106 = oura_tags/morning-checkin extras (F), 107 = superset_group (I); local v13 = outbox hardening (A), v14 = F's additions, v15 = superset mirror (I).
