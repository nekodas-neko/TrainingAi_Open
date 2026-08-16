# TrainingAI — Session History (Sessions 51–104)

> Historical session log, archived from `projectOverview.md`. Covers sessions ~51–104 (the former "Past Changes" block).
> For current status, the live "What's Left To Do" list, and the document map, see `projectOverview.md`.

---

## Past Changes

### Session 104 — HR Chart Ghost Bands + Nutrition History Bug Fix (2026-06-24) ✅ Complete

**HR chart — phantom rest shading removed** (`components/health/hr-day-chart.tsx`):
Oura tags individual heart rate readings as `source: "rest"` during brief stillness (sitting at a desk, lying down momentarily), with no corresponding formal rest/nap session. The `findSourceWindows` function had no minimum duration check, so even a single tagged reading produced a purple shading band. Added a 20-minute minimum: windows shorter than 20 minutes of consecutive `rest`/`sleep` readings are now filtered out. Real sleep and nap sessions still render; scattered noise readings do not.

**Nutrition history — "add from history" silently closed the food logger** (`lib/hooks/use-sheet-back-dismiss.ts`):
Selecting an item from the food library (History button in the food logger) closed the entire sheet without advancing to the Assign step — no error shown. Root cause: each `useSheetBackDismiss` instance pushes a history entry when a sheet opens. When the nested food-library sheet closed programmatically after item selection, its cleanup called `window.history.back()` to undo the pushed entry. That fired a `popstate` event, which the parent food-logger sheet's popstate handler caught, triggering `reset()` + `onClose()` — silently dismissing everything before the Assign step could render. Fix: each pushed history state now carries a unique instance ID (`sheetId`). The popstate handler only calls `onClose` when the state arrived at is *not* our own entry, so a child sheet popping its history entry cannot cascade into parent sheet handlers.

### Session 103 — Ten UI/Bug Fixes from User Feedback (2026-06-13) ✅ Complete

Worked through a list of 10 issues the user reported after reviewing screenshots of the home, health, profile, workout-select, and config screens.

**UV index:** `WeatherSnapshot` (`lib/weather/types.ts`, `lib/weather/open-meteo.ts`) gained `uvIndex` from Open-Meteo's `uv_index` field. `weather-chip.tsx` shows `UV {n}` next to the temperature during daylight hours (UV ≥ 1), colour-coded green→purple by severity.

**Card link fixes:** Home screen Nutrition widget now routes to `/nutrition` instead of `/health` (`session-select-content.tsx`).

**Health tab default:** `health-content.tsx` now defaults to the Training tab (shows the calendar) when opened with no `?tab=` param, instead of Body.

**12-hour activity times:** New `formatTime12h()` helper in `lib/date-utils.ts` converts "HH:MM" to e.g. "8:30am". Applied to `activity-detail-sheet.tsx`, `activity-history-card.tsx`, and the activity log row in `health-content.tsx`.

**Estimated 1RM progress card:** New `components/health/strength-progress-card.tsx` reads the existing `/api/weights-summary` endpoint and renders each exercise's estimated 1RM as a progress bar, grouped by session. Added to the top of Health > Progress.

**"Trained today" fix:** `workout-select-content.tsx`'s `getLastTrainedLabel()` was using a global per-exercise-name `lastDate` lookup that could be set by *any* session, causing unrelated sessions to show "Trained today". Now prioritises the session-scoped `loggedTodayInSession` flag and excludes today's date from the cross-session `lastDate` fallback.

**Profile screen rework** (`components/more/profile-tab.tsx`, `lib/achievements.ts`):
- Title button under the display name changed from `flex justify-center` to `inline-flex` so the parent's `text-center` actually centres it.
- Friend code is now a button with a `Copy`/`Check` icon — tapping copies it to the clipboard with a toast.
- Stats strip redesigned from a 4-card `grid-cols-4` row into a 6-card `grid-cols-3 max-w-xs mx-auto` icon grid (Sessions/Sets/Volume/Best Streak/Distance/Member-since-or-Program-weeks), width-matched to the level pill/XP bar above.
- `computeAchievements()` now also returns `totalSets` (already computed, previously unused) and a new `totalDistanceKm` (summed from `activity_logs.distance_km`) in `lifetimeStats`.

**Weekly step goal:** Home Steps widget (`session-select-content.tsx`) now respects a `ta_steps_goal_type` of `"daily"` or `"weekly"` (mirroring the existing calorie-goal pattern). When weekly, it sums the last 7 days of steps and compares against the goal as-is, labelled "Steps (week)".

**Smaller toggles:** `components/ui/switch.tsx` shrunk from `h-7 w-12` / `size-5` thumb to `h-5 w-9` / `size-4` thumb — affects every `Switch` in the app.

**Workout Config back button:** `config-screen.tsx`'s back button now does `router.push('/more?tab=profile')` instead of `router.back()`, which could land on an unrelated page (e.g. Nutrition) depending on navigation history.

**Verification:** `pnpm exec eslint` and `pnpm exec tsc --noEmit` clean on all changed files (only pre-existing warnings elsewhere). Installed previously-missing `@capacitor/*` optional deps (already in `package.json`, just not present in this container) to get the dev server rendering; confirmed `/more` returns 200 with the new stats grid markup and `/api/achievements` returns the new `totalSets`/`totalDistanceKm` fields against local Postgres.

⚠️ **Pending on-device verification:**
- UV index appears next to the weather chip during the day and disappears at night.
- Nutrition home card opens `/nutrition`; Workout Config back button returns to More > Profile.
- Health page opens on Training tab from the bottom nav.
- Activity times show as e.g. "8:30am" in both the history card and detail sheet.
- Estimated 1RM card appears on Health > Progress with real lift data.
- Workout select only shows "Trained today" for the session actually completed today.
- Profile: title centred, friend code copies on tap, 6-card stats grid shows correct Distance (requires logged `activity_logs` rows).
- Setting step goal type to "weekly" in Profile > Goals shows the 7-day total on the home Steps widget.
- Toggle switches look proportionate across Config/Profile/Notifications.

**Files changed:** `app/health/health-content.tsx`, `app/session-select/session-select-content.tsx`, `app/workout-select/workout-select-content.tsx`, `components/activity/activity-detail-sheet.tsx`, `components/config-screen.tsx`, `components/health/activity-history-card.tsx`, `components/health/strength-progress-card.tsx` (new), `components/more/profile-tab.tsx`, `components/ui/switch.tsx`, `components/weather-chip.tsx`, `lib/achievements.ts`, `lib/date-utils.ts`, `lib/weather/open-meteo.ts`, `lib/weather/types.ts`.

---

### Session 102 — Meal Reminder Notifications (2026-06-13) ✅ Complete

Implemented the meal reminder feature designed in session 102's brainstorming/planning pass (specs: `docs/superpowers/specs/2026-06-13-meal-reminder-notifications-design.md`, plan: `docs/superpowers/plans/2026-06-13-meal-reminder-notifications.md`).

**Reconcile-on-open/resume:** New `lib/meal-reminders.ts` module — `computeMealReminderActions(mealTypes, foodLogs, now)` is a pure function deciding, per meal type, whether to cancel (already logged or reminders disabled), fire an immediate catch-up notification (window already passed and unlogged), or schedule a one-shot for the window's end time (`timeEndHour === 24` clamps to 23:59). `reconcileMealReminders()` wraps this with the actual `@capacitor/local-notifications` `.schedule`/`.cancel` calls, no-op on web via `Capacitor.isNativePlatform()`. `mealReminderNotificationId()` deterministically hashes a meal type UUID into the 9200–9999 range (avoids collision with `REST_COMPLETE_ID = 9001`). 11 Vitest unit tests cover cancel/immediate/scheduled/clamping/multi-meal-type cases.

**Triggers:** `components/sync-provider.tsx` runs `reconcileMealReminders` on mount (native only, gated by `ta_pref_meal_reminders` localStorage toggle, default on) and again on every `@capacitor/app` `resume` event, fetching `/api/nutrition/meal-types` and `/api/nutrition/food-logs?date=<today>` fresh (not via `cachedFetch`). New `meal-reminders` notification channel (normal importance, no vibration) created alongside `workout-timers` in `capacitor-native-init.tsx`.

**Cancel-on-log:** `cancelMealReminder(mealTypeId)` is called immediately after a successful food log in `lib/nutrition/log-meal.ts` (`logMealItems`), `food-logger-sheet.tsx` (`handleConfirm`), and `saved-meals-sheet.tsx` (`quickLog`).

**Data model:** New migration `063_meal_type_reminders_enabled.sql` adds `meal_types.reminders_enabled BOOLEAN NOT NULL DEFAULT true`; `MealType` type, Drizzle schema, `rowToMealType`, and the meal-types POST route all updated to carry `remindersEnabled`.

**UI:** `meal-type-manager.tsx` gains a bell/bell-off icon per row and a "Remind me if not logged" `Switch` in the edit form. `app/nutrition/nutrition-content.tsx` Settings sheet gains a "Meal Reminders" section with a global on/off `Switch` (`ta_pref_meal_reminders`) — turning it off cancels all pending meal reminders via `cancelAllMealReminders`, turning it on triggers an immediate reconcile.

**Verification:** `pnpm test` (93/93), `pnpm exec tsc --noEmit`, `pnpm lint` (no new errors in changed files — pre-existing warnings/errors elsewhere untouched), and `pnpm build` all pass. Playwright smoke test against local Postgres + dev server (`test@local.dev`) confirmed: Meal Reminders settings section renders and its switch toggles/persists across reload; per-meal-type "Remind me if not logged" switch renders in the edit form, toggles, saves, and updates the bell icon; no related console errors (web correctly no-ops).

⚠️ **Pending on-device/production verification (cannot be tested in this sandbox):**
- Log a meal mid-window on the Android app and confirm its scheduled/immediate reminder is cancelled.
- Let a meal's time window pass unlogged, then reopen the app and confirm the catch-up notification fires.
- Confirm a one-shot reminder scheduled for later today still fires via AlarmManager if the app is closed before the window ends.
- Toggle the global and per-meal-type reminder settings on a device and confirm notifications are (re)scheduled/cancelled accordingly.

### Session 101 — Friend Profiles, Distance Stats & Drag-and-Drop Reordering (2026-06-13) ✅ Complete

Nine UI/UX fixes and features from user feedback, spanning readability over the dynamic background, friend social features, and program editing.

**Friend profile views:** Tapping a friend in the Friends feed or leaderboard now navigates to `/profile/[userId]`, rebuilt to mirror the self-profile layout — brand-ring avatar, equipped title, level/XP progress bar, lifetime stats grid, and a read-only `TrophyCase` of their top 3 achievements by XP reward. Extracted `lib/achievements.ts` (`computeAchievements()`) so `/api/achievements` (self) and `/api/profile/[userId]` (friend/self) share one level/XP/achievement implementation — the friend profile previously used a simplified, duplicated formula.

**Total distance stat:** Runner profiles (self and friend) gain a 4th stat — total distance in km from `activity_logs.distance_km` — alongside Sessions/Volume/Best streak. Stats grid switches from 3 to 4 columns when distance > 0.

**Drag-and-drop reordering:** Program editor (`config-screen.tsx`) gained grip handles for both sessions and exercises-within-a-session, using `@dnd-kit/react`'s `DragDropProvider`/`useSortable` (new `components/config/sortable-row.tsx`). Nested providers — outer for session order, inner per-session for exercise order — both feed a single `handleProgramSessionDragEnd`.

**Readability over dynamic background:** New `text-shadow-bg` utility (`app/globals.css`) applied to Weekly Schedule session labels, friend profile titles, and Friends-feed text that was hard to read against the sky. Toned down the celestial glow and strengthened the scrim gradient (`celestial-layer.tsx`, `scrim-layer.tsx`) for the same reason.

**Health card contrast:** Resting HR, HRV, and SpO2 cards on the Health page now use the standard accent-card treatment instead of looking washed out.

**Accent colour fix:** The custom accent hue bootstrap moved from the appearance settings page into `app/layout.tsx`, so it applies on every page load — fixes the accent intermittently reverting to green after navigating directly to a page that never visited Appearance.

**Pre-workout padding:** Start Workout button now has more breathing room above the safe area.

**Activity icon picker:** New searchable `activity-icon-picker-sheet.tsx` and an expanded `lib/constants/activity-icons.ts` icon set — added `Gauge` for Treadmill.

**Verification:** `npx tsc --noEmit` and `pnpm lint` clean (no new errors/warnings beyond the pre-existing baseline). `/api/profile/[userId]` and `/api/achievements` verified end-to-end against local Postgres (`trainingai_dev`) via curl with a real NextAuth credentials session cookie — both return consistent level/XP/achievement data.

⚠️ **Pending on-device/production verification:**
- Tap a friend in the Friends feed and leaderboard — confirm the profile page loads with correct avatar, title, level/XP bar, stats, and trophy case.
- Runner profile shows the Distance stat (4-column grid) when `totalDistanceKm > 0`.
- ~~Drag a session and an exercise to reorder in the program editor — confirm the new order persists after saving and reloading.~~ ✅ Fixed (1.32.1) — `@dnd-kit`'s `OptimisticSortingPlugin` reorders the DOM live on `dragover` and clears the collision target by `dragend`, so `onDragEnd` was bailing out before updating state. Moved the reorder logic to `onDragOver`. Verified end-to-end via Playwright against local Postgres (drag → save → reload shows new order). ⚠️ Still needs a real on-device touch-drag confirmation.
- Weekly Schedule and Friends-feed text is legible against the dynamic background in both light and dark modes.
- Health page Resting HR/HRV/SpO2 cards show visible contrast (not washed out).
- Accent colour stays consistent across refreshes and direct navigation (does not revert to green).
- Pre-workout screen has visible padding below the Start Workout button.
- New activity icon picker sheet opens, searches, and selects icons correctly in the admin activity type manager.

**Files changed:** `app/api/achievements/route.ts`, `app/api/profile/[userId]/route.ts`, `app/profile/[userId]/page.tsx`, `app/globals.css`, `app/health/health-content.tsx`, `app/layout.tsx`, `app/session-select/session-select-content.tsx`, `components/admin/activity-icon-picker-sheet.tsx` (new), `components/admin/activity-type-manager.tsx`, `components/config-screen.tsx`, `components/config/sortable-row.tsx` (new), `components/dynamic-background/celestial-layer.tsx`, `components/dynamic-background/scrim-layer.tsx`, `components/more/friend-feed.tsx`, `components/more/friend-leaderboard.tsx`, `components/more/profile-tab.tsx`, `components/workout/pre-workout-screen.tsx`, `lib/achievements.ts` (new), `lib/constants/activity-icons.ts` (new), `lib/types/friends.ts`.

**Version:** 1.31.0 → 1.32.0 → 1.32.1 (1.32.1: fixed drag-and-drop reorder persistence, see pending checklist above)

---

### Session 100 — Uplift Batched Execution: 21 Tasks Across Design, Performance & Security (2026-06-13) ✅ Complete

Implemented the full `docs/superpowers/plans/2026-06-12-uplift-batched-execution-plan.md` — 21 tasks combining three pending uplift backlogs (design/accessibility, performance, security) plus 6 new findings from a follow-up review, sequenced into 4 batches and committed individually.

**Headline fix — cross-month streak data gap (New Task AB):** The home screen's Streak card, "This Week" bar strip, and 10-day strip were populated *only* from `/api/calendar-data?year=Y&month=M` (current calendar month), so near the start of any month the streak was truncated to a couple of days regardless of actual history. Added `getRecentTrainedDays(userId, days)` to the repository (rolling 90-day window, AEST-bucketed) and a new `/api/streak-data` route; `session-select-content.tsx` now merges both calendar-data and streak-data into `calendarDays`. Also gave `computeStreak()` in `app/api/achievements/route.ts` a `maxRestGap` parameter (workout streak now allows 1 rest day, matching the home screen; food/sleep/calorie streaks remain strict). Verified on local DB — home Streak card correctly showed 18 days spanning a May/June boundary after the fix.

⚠️ Found and fixed a bug in the plan's own `getRecentTrainedDays` code during implementation: the spec's `aestMidnight(y, m, d - 90)` produces an invalid date string whenever `d - 90 < 0` (always true), causing a 500. Replaced with a `todayMidnightUtc(DEFAULT_TZ)` anchor + millisecond offset arithmetic — avoids string-based date construction entirely.

**Design/Accessibility:** `--card-tint-pct` CSS variable fixes light-mode card contrast (`accentCardStyle`); Health page Lean Mass/BMI/Trend/Balance info buttons gained `aria-label`s and larger touch targets (B11 now fully closed); activity done-screen tiles standardized to the app's translucent-card convention; `WeatherChip` shows a loading skeleton instead of popping in; chat header gained `pt-safe` so it clears the status bar; activity pre-screen gained a back-navigation header.

**Performance:** `useWeather` gated behind an `enabled` flag and dedupes concurrent fetches (saves geolocation/weather calls when the dynamic background is off, which is the default); `ActivityRouteMap` throttled to 2s updates with an offline fallback; `ExerciseStatsSheet` lazy-loaded via `next/dynamic` to defer chart.js out of the pre-workout bundle; activity-store GPS distance now computed incrementally (O(1) per point) instead of O(n²); activity-store localStorage writes debounced during GPS tracking; `workout-data` route uses a new lighter `getDayExerciseNames` instead of `getDayLog` for "already logged today" checks; Health page's training-load/sleep-correlation/weekly-stats/program-meta fetches now go through `cachedFetch`.

**Security:** Health Connect ingest secret now compared with `timingSafeEqual` (S16); `/api/friends` POST rate-limited to slow email enumeration (S17); `/api/sync-workout` now batch-checks session/exercise-log ownership before writing, blocking cross-account writes — mismatched ids are skipped and the response reports `{ synced, skipped }` (S18).

**Other fixes:** mood check-in date format mismatch (`localDateString()` → `todayInTz()`) and missing cache invalidation on save; `ta_wc_*` workout-card session cache now cleared when program config is saved; deleted dead `app/history/history-content.tsx` (H4) and orphaned `components/nutrition/saved-meals-section.tsx`.

**Verification:** `npx tsc --noEmit` and `pnpm lint` clean (same 108 pre-existing warnings/errors, no new issues) after every batch. DB-touching changes (Tasks 2.4, 3.2, 4.2) verified against local Postgres (`trainingai_dev`) via curl with a real session cookie. UI changes verified via Playwright against the running dev server, including a full home-screen screenshot confirming the Streak card and bar strip render correctly.

⚠️ **Pending on-device/production verification** (sandbox + local-DB checks above passed, but not yet confirmed on the live Railway deploy / Samsung Galaxy S25 Ultra):
- Complete a real workout end-to-end — confirm sets sync and save, and "Trained Today" updates on home (exercises the S18 ownership check + `getDayExerciseNames` hot-path change).
- Mood check-in saves and the home-screen icon updates immediately without a refresh.
- Health page Training Load / Sleep vs Performance / Weekly Stats cards still populate correctly now that they go through `cachedFetch`.
- Saving the program config updates the home screen's workout cards (no stale `ta_wc_*` session cache).
- Home Streak card + 10-day bar strip show correct values, and the workout streak matches Achievements' `streak_7/14/30/60` progress.
- Activity tracking: route map updates smoothly under the new 2s throttle, offline fallback message appears when disconnected, GPS distance/pace stay accurate, pre-activity back button works, done-screen tiles match the translucent-card style.
- Chat header clears the status bar (`pt-safe`) on-device.
- Health page ⓘ info buttons (Lean Mass/BMI/Trend/Balance) have larger tap targets.
- Light mode: Home/Health cards show visible tint/contrast (not washed out).
- WeatherChip shows a loading skeleton before data arrives (only relevant if dynamic background is enabled).

**Files changed:** `app/api/achievements/route.ts`, `app/api/friends/route.ts`, `app/api/health-connect/ingest/route.ts`, `app/api/streak-data/route.ts` (new), `app/api/sync-workout/route.ts`, `app/api/workout-data/route.ts`, `app/globals.css`, `app/health/health-content.tsx`, `app/session-select/session-select-content.tsx`, `components/activity/activity-route-map.tsx`, `components/activity/done-activity-screen.tsx`, `components/activity/pre-activity-screen.tsx`, `components/chat.tsx`, `components/config-screen.tsx`, `components/dynamic-background/dynamic-background.tsx`, `components/mood-checkin-sheet.tsx`, `components/weather-chip.tsx`, `components/workout/pre-workout-screen.tsx`, `components/workout/warmup-screen.tsx`, `lib/data/postgres/adapter.ts`, `lib/data/repository.ts`, `lib/stores/activity-store.ts`, `lib/utils.ts`, `lib/weather/use-weather.ts`. Deleted: `app/history/history-content.tsx`, `components/nutrition/saved-meals-section.tsx`.

**Version:** 1.30.3 → 1.31.0

---

### Session 98 — Health Connect Sync: Corrected Record-Type Keys for alpha11 (2026-06-12) ✅ Complete

1.30.1 did not fix the sync — the user reported the same toast, now reading "Invalid records specified: ExerciseSession, HeartRate". That error message was the key clue: it showed both the *new* key from 1.30.1 (`ExerciseSession`) and the *original* key (`HeartRate`) as still invalid.

- **Root cause**: `@devmaxime/capacitor-health-connect`'s native `build.gradle` pins `androidx.health.connect:connect-client:1.1.0-alpha11`. Downloaded that exact version's sources jar from `maven.google.com` and read `RecordsTypeNameMap.kt` directly — this alpha uses **legacy key names** that differ from later/stable AndroidX naming:
  - `'ActivitySession'` → `ExerciseSessionRecord` (1.30.1 incorrectly changed this to `'ExerciseSession'`, which isn't a key at all in this version)
  - `'HeartRateSeries'` → `HeartRateRecord` (the original bug — code used `'HeartRate'`, which is invalid)
  - The native plugin's `requestPermissions()` rejects the **entire** call if *any* requested record type string isn't in this map, so one bad key blocks steps/weight/sleep/etc. too.
- **Fix**: in `lib/health-connect-sync.ts`, reverted `'ExerciseSession'` → `'ActivitySession'` and changed `'HeartRate'` → `'HeartRateSeries'`, across the main `requestPermissions({read:[...]})` call, `enrichActivityLogs()`'s permissions request, `canRead.has(...)` checks, and `readRecords({type:...})` calls (3 call sites total for each key).
- **New known issue discovered (not fixed this session)**: `RecordConverter.kt` in the same native plugin has no conversion case for `HeartRateRecord`, `OxygenSaturationRecord`, or `HeartRateVariabilityRmssdRecord` — they fall through to `record.toString()`, returning plain strings instead of structured JSON. So even with the corrected permission key, per-session avg/max HR, SpO₂, and HRV will likely stay unpopulated (no error, just no data). Fixing this needs a native Kotlin patch to the plugin + an APK rebuild — see Known Issue H6.

**Verified:** `pnpm exec tsc --noEmit` clean, `pnpm test` 79/79 pass, `pnpm lint` clean for the changed file.

---

### Session 97 — Post-Install Bug Fixes: Haptic Tick + Health Connect Sync (2026-06-12) ✅ Complete

First on-device test of the 1.30.0 APK surfaced two bugs, both fixed and shipped as 1.30.1 (web-only, no APK rebuild needed since the Capacitor app loads the live Railway URL):

- **Weight dial haptic tick not felt** — `hapticTick()` in `lib/haptics.ts` called `Haptics.selectionChanged()`, which on the Android `@capacitor/haptics` implementation is gated by a `selectionStarted` flag that's only set by `selectionStart()` (never called). Changed to `Haptics.impact({ style: ImpactStyle.Light })`, matching `hapticLight()`. Set-log haptic (`hapticLight()`) and workout-complete haptic (`hapticSuccess()`) were both confirmed working as-is.
- **Health Connect sync completely broken** — toast showed "HC sync failed: ... invalid record specified" and no steps/HR/weight/sleep synced. Root cause: `lib/health-connect-sync.ts`'s `requestPermissions({ read: [...] })` included `'ActivitySession'`, which is not a key in AndroidX's `RECORDS_TYPE_NAME_MAP` (the correct key is `'ExerciseSession'`). `@devmaxime/capacitor-health-connect`'s native plugin rejects the **entire** `requestPermissions()` call if even one record type string is invalid, so `canRead` was never populated and every data type — not just exercise sessions — failed to sync. Fixed all 3 references (`read` array, `canRead.has(...)`, `readRecords({type:...})`) to use `'ExerciseSession'`.
- **Background location for Walk activity** — user reported no "Allow all the time" prompt when starting a Walk, but a "tracking your activity" notification appeared on screen-lock. Investigated `@capacitor-community/background-geolocation`'s Android plugin: its `@Permission` annotation only requests `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` (foreground location) — it never requests `ACCESS_BACKGROUND_LOCATION`, even though that permission is declared in `AndroidManifest.xml`. This is expected: the plugin runs a foreground service (with the persistent notification observed), and Android grants foreground services continued location access under "while in use" permission without needing "Allow all the time". The notification appearing on lock is the correct signal that tracking continued. ⚠️ Not yet confirmed whether distance/pace actually kept updating after unlocking — pending user confirmation on a future Walk/Run.

**Verified:** `pnpm exec tsc --noEmit` clean, `pnpm test` 79/79 pass, `pnpm lint` shows the same 108 pre-existing problems as `main` (none introduced by this change).

---

### Session 96 — Capacitor Plugin Batch: Haptics, Local Notifications, Status Bar, Network, Camera (2026-06-12) ✅ Complete

Audited the existing Capacitor/Android setup (config, gradle wiring, manifest permissions, code usage) ahead of the first APK build/install, then added 5 requested native plugins plus a wiring fix for a 6th:

- **`@capacitor/haptics`** — new `lib/haptics.ts` (`hapticTick`, `hapticLight`, `hapticSuccess`). Replaced all `navigator.vibrate()` calls: weight dial scroll (`components/ui/weight-dial.tsx`), workout-select session swipe (`app/workout-select/workout-select-content.tsx`), set logging and workout completion (`components/workout-screen.tsx`).
- **`@capacitor/local-notifications`** — new `lib/notifications.ts` (`scheduleRestCompleteNotification`/`cancelRestCompleteNotification`). Rest timer now schedules a "Rest complete" notification that fires even if the app is backgrounded; cancelled if the rest phase ends early. Channel creation + permission request happen in new `components/capacitor-native-init.tsx`. Added `POST_NOTIFICATIONS` to `AndroidManifest.xml`.
- **`@capacitor/status-bar`** — sets `Style.Dark` (light icons) on native init, in `capacitor-native-init.tsx`, wrapped in try/catch for Android 15 edge-to-edge.
- **`@capacitor/network`** — `SyncProvider` now drains the SQLite outbox immediately on `networkStatusChange` reconnect, not just on mount.
- **`@capacitor/camera`** — nutrition photo capture (`components/nutrition/capture-step.tsx`) uses `Camera.getPhoto({source: CameraSource.Prompt})` on native (camera/gallery picker), falls back to `<input type="file">` on web.
- **`@capacitor/geolocation`** — was declared in `package.json` but missing from `android/capacitor.settings.gradle`/`capacitor.build.gradle`; fixed as a side effect of `pnpm add` + `npx cap sync android`.

Also bumped `android/app/build.gradle` `versionCode`/`versionName` (was stuck at `2`/`"1.14.0"` since session 63) to `3`/`"1.30.0"` to match `package.json`, ahead of the first real device install.

**Verified:** `pnpm exec tsc --noEmit` clean, `pnpm test` 79/79 pass, `pnpm lint` shows the same 108 pre-existing problems as `main` (none introduced). `npx cap sync android` completed cleanly after creating the (gitignored) `android/app/src/main/assets/` directory it needs to run.

⚠️ **Not yet verified on-device** — haptics feel, rest-timer background notification, status bar icon colour, native camera picker, and network-reconnect sync all need confirming on the Samsung Galaxy S25 Ultra once this build installs.

**Considered but deferred:** meal/workout reminder notifications (data model already supports it via `meal_types.timeStartHour`/`timeEndHour` — pure JS/Railway-deployable once wanted, no APK rebuild needed since `@capacitor/local-notifications` is now compiled in). Cadence tracking remains explicitly out of scope (no accelerometer/pedometer data source).

---

### Session 92 — Dynamic Wallpaper Backgrounds (2026-06-12) ✅ Complete

Implemented both previously-planned dynamic wallpaper plans end-to-end (data/settings layer, then visual rendering), tested against the local nonprod Postgres, and merged to `main`.

**Plan 1 — data & settings layer:**
- `lib/weather/types.ts`, `lib/weather/open-meteo.ts` (`mapWeatherCode`, `fetchWeatherSnapshot`), `lib/weather/geocode.ts` (`geocodeLocation`) — Open-Meteo forecast + geocoding APIs, no API key
- `lib/stores/background-settings-store.ts` — persisted Zustand store (`enabled`, per-section `sections`, `manualLocation`)
- `lib/location.ts` — `getDeviceLocation()`; added `@capacitor/geolocation` dependency (no existing one-shot location helper to reuse — `lib/activity/gps-tracking.ts` is a continuous watcher built on `@capacitor-community/background-geolocation` with a different shape). Android `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` permissions were already present from the activity-tracking work.
- `lib/weather/use-weather.ts` — `useWeather()` hook with 30-min localStorage cache
- `components/weather-chip.tsx` — home header weather chip; `components/profile/dynamic-background-settings.tsx` — Profile > Theme & Appearance settings UI (master toggle, 5 per-section toggles, fallback-city search)

**Plan 2 — visual rendering layer:**
- `lib/background/palettes.ts` + `lib/background/day-phase.ts` (`computeDayPhase`) — continuous interpolation across deep-night/dawn/day/dusk anchors plus sun/moon arc position
- `lib/background/weather-filters.ts` (`getSkyFilter`) — per-condition CSS `filter`
- New keyframes/utility classes in `app/globals.css` (twinkle, cloud-drift, rain-fall, snow-fall, fog-drift, lightning-flash) with `motion-reduce:` variants
- `components/dynamic-background/` — `sky-layer`, `celestial-layer`, `particles` (stars/clouds/rain/snow/fog/lightning), `weather-overlay`, `scrim-layer`, and the `dynamic-background.tsx` orchestrator (recomputes every 60s, paused when tab hidden)
- Mounted `<DynamicBackground>` in `app/layout.tsx` behind all content (`z-index: -1`); `<main>` raised to `z-index: 1`

**Verified:** `pnpm test` 78/78 pass (incl. 4 new test files for `open-meteo`, `geocode`, `day-phase`, `weather-filters`), `pnpm exec tsc --noEmit` clean, `pnpm lint` no new issues. Started `pnpm dev` against the local nonprod Postgres, logged in as `test@local.dev`, confirmed `/`, `/more`, `/health`, `/workout`, `/nutrition` all return 200 with no runtime errors.

⚠️ **Known gap (resolved in session 93):** the visual layer didn't actually render on-device — see session 93 below for the root cause and fix. Weather chip + real location data were confirmed working.

**Files changed:** see `docs/superpowers/plans/2026-06-11-dynamic-wallpaper-backgrounds-data-settings.md` and `...-visuals.md` file structure tables for the full list.

---

### Session 95 — Cross-Session "Done Today" Bug Fix (2026-06-12) ✅ Complete

**Problem:** An exercise shared between two program sessions (e.g. "Tricep Cable Combo" in both "Push" and "Upper") would show as already done — green checkmark + redo icon, last-set summary — in *both* sessions' Recommended Workout lists after being logged in just one of them. It correctly didn't mark the other session as fully complete or register on the training calendar, but the per-exercise "done" status leaked across sessions.

**Root cause (two layers):**
- `app/api/workout-data/route.ts` computed each exercise's "done today" status from `ex.lastDate === today`, which came from `getLastExerciseLogsBatch` — a global, exercise-name-keyed lookup with no session scoping.
- The persisted Zustand `todayLogged` set (`lib/stores/workout-store.ts`) was a single flat set of exercise names for the whole day, shared across all sessions.

**Fix:**
- `app/api/workout-data/route.ts` now also fetches `getDayLog(userId, todayStr)` and builds a `loggedTodayInThisSession` set filtered by `workoutSession.sessionId === programSession.id`. Each returned exercise gets a new `loggedTodayInSession: boolean` field.
- `components/workout/pre-workout-screen.tsx` and `components/workout/done-screen.tsx` now compute "done today" as `todayLogged.has(ex.name) || ex.loggedTodayInSession`.
- `lib/stores/workout-store.ts`: `todayLogged` changed from `string[]` to `Record<string, string[]>`, keyed by program session id (or `sessionType` as a fallback). `addTodayLogged(sessionKey, name)` now takes a session key.
- `components/workout-screen.tsx` passes `programSessionId ?? sessionType.toLowerCase()` as the session key when reading/writing `todayLogged`.

**Verified:** end-to-end against the local nonprod Postgres by simulating an exercise logged under one session's `workout_sessions.session_id` and confirming the other session's `workout-data` response no longer reports it as done. `pnpm tsc --noEmit`, `pnpm exec next lint`, and `pnpm test` (74/74, excluding the pre-existing unrelated `@mapbox/polyline` suite failure) all clean on the changed files.

**Also answered (no code change):** for bodyweight exercises (e.g. Pull-Ups), the "Next Session" target reps come from the program's static progression style (`progression_styles`/`style_sets`), not a bodyweight-derived calculation — the entire "Next Session" targets card is hidden for `exerciseType === "bodyweight"` exercises on the summary screen. Only the *weight* side (effective weight = bodyweight + added load) is bodyweight-aware, used for 1RM/PR estimation.

---

### Session 94 — Dynamic Background Card Contrast & Opaque-Card Fixes (2026-06-12) ✅ Complete

**Problem (reported after testing 1.29.1 live):** with the dynamic background now visible (session 93), several cards were too see-through against the bright sky, and a few were the opposite — fully opaque, breaking the effect entirely:
- Home (Streak, This Week, Body Weight, Nutrition, Sleep, Steps, Mood, metric tiles, Recommended/Trained Today) and the Health accent cards were low-contrast and hard to read.
- More > Config > Workout Config rendered as a solid opaque block (`bg-background` on its root + sticky header).
- Nutrition meal cards and the macro ring rendered as solid opaque blocks (`bg-card` is fully opaque `oklch(0.09 0 0)` in dark mode).
- Health > Training: the celestial (sun/moon) glow visually overlapped the training calendar's date cells, since the calendar had no card background of its own.

**Fix — target look was the Health "Training Load" card (`bg-muted/60 border border-border`):**
- `lib/utils.ts` — `accentCardStyle(hex)` now sets `backgroundColor: color-mix(in oklch, var(--muted) 60%, transparent)` as a base layer plus `backgroundImage` for the existing accent gradient (previously a single `background` gradient with no opaque base). This single change fixes all 21 usages across Home and Health (Streak, This Week, Body Weight, Nutrition donut, Sleep, Steps, Mood, metric tiles, Training Load ACWR, etc.).
- `app/session-select/session-select-content.tsx` — the "Recommended Today"/"Trained Today" card's bespoke background gets the same `color-mix(...)` base layer (split `background` into `backgroundColor` + `backgroundImage`).
- `components/config-screen.tsx` — root container and sticky header `bg-background` → `bg-page` (Workout Config sub-page now shows the dynamic sky like every other page).
- `components/nutrition/meal-card.tsx`, `components/nutrition/macro-ring.tsx`, and the "Saved Meals" button in `app/nutrition/nutrition-content.tsx` — `bg-card border border-border/40` (opaque) → `bg-muted/60 border border-border` (translucent, matches Training Load).
- `app/health/health-content.tsx` — wrapped `<CalendarWidget>` on the Training tab in a `rounded-2xl bg-muted/60 border border-border p-4` card (previously rendered with no card background at all), which both improves contrast and masks the sun/moon glow so it no longer overlaps date cells.

**Verified:** `pnpm test` 79/79 pass, `pnpm exec tsc --noEmit` and `pnpm exec eslint` clean on all changed files. Used Playwright against `pnpm dev` + local nonprod Postgres in both light and dark mode (system colour scheme), with the dynamic background enabled (all sections) and disabled, across Home, Nutrition, More > Config, and Health > Training — confirmed all previously-opaque cards now show the sky background through them, accent cards have noticeably better contrast, the calendar sits on its own card with the glow no longer overlapping date cells, and the disabled (no dynamic background) appearance is unchanged in both themes.

**Follow-up (1.29.3):** the weather chip on the Home header was crowding the greeting line, truncating longer display names (e.g. "Good afternoon, Ne…"). Moved `<WeatherChip>` to sit next to the date row instead of the greeting row, and changed the greeting `<h1>` from `truncate` to `line-clamp-2` so longer names wrap onto a second line instead of being cut off.

---

### Session 93 — Dynamic Background Not Rendering + Location Search (2026-06-12) ✅ Complete

**Problem (reported after deploy):** weather chip worked correctly, but the sky/celestial/particle background layer never appeared on any page despite the toggle being on and all 5 sections enabled.

**Root cause:** two stacked opaque backgrounds sat in front of `<DynamicBackground>` (`fixed inset-0 z-[-1]`):
1. `body { @apply bg-background ... }` in `globals.css` — per CSS painting order, a non-positioned ancestor's own background paints *above* a negative-z-index descendant within the same stacking context, so `body`'s opaque background completely covered the `z-[-1]` layer.
2. Every page's root container (`session-select-content.tsx`, `health-content.tsx`, `nutrition-content.tsx`, `more-content.tsx`, `workout-select-content.tsx`, and the workout flow screens `pre-workout-screen.tsx`/`warmup-screen.tsx`/`active-workout-screen.tsx`/`exercise-summary-screen.tsx`/`done-screen.tsx`) also had its own opaque `bg-background`, sitting inside `<main>` (`z-index: 1`) above `<DynamicBackground>`.

**Fix:**
- Moved the base `bg-background` from `body` to `html` in `globals.css` (now painted at the very bottom of the stacking order, below `z-[-1]`).
- Added a `.bg-page` utility (`background-color: var(--page-bg, var(--background))`) and replaced `bg-background` with `bg-page` on all 10 page-root containers listed above.
- `DynamicBackground` now computes `isActive` (mounted + enabled + section enabled) and sets `--page-bg: transparent` on `<html>` via `useEffect` only while active, removing it otherwise — so `.bg-page` falls back to the normal solid background when the feature/section is off.

**Location search (`components/profile/dynamic-background-settings.tsx`):** `geocodeLocation()` → `geocodeLocations(query, count = 5)` in `lib/weather/geocode.ts`, returning up to 5 matches with `"<name>, <admin1>, <country>"` for disambiguation. The settings UI now shows a tappable result list instead of auto-selecting the first match, adds a placeholder (`"City or suburb name, e.g. Brisbane"`) and helper text clarifying postcodes aren't supported, and submits on Enter.

**Verified:** `pnpm test` 79/79 pass, `pnpm exec tsc --noEmit` and `pnpm exec eslint` clean on all changed files. Used Playwright (Chromium) against `pnpm dev` + local nonprod Postgres, logged in as `test@local.dev`, enabled the background with all sections on, and confirmed via screenshots that the sky gradient + celestial glow now render correctly behind Home, Health, Workout, Nutrition, and More, and that disabling the feature restores the original solid background with no regression.

---

### Session 91 — Phase Set Ownership & Program Name Uniqueness (2026-06-12) ✅ Complete

**Problem:** The AI workout builder's "clone on save" flow (for customised phase cycle lengths) generated phase sets named `<template> (custom-xxxxxxxx)` with no link back to the program that created them. `updateProgramPhaseSettings`'s `deletePhaseSetIfOrphaned` heuristic tried to clean these up by name-matching and reference-scanning, but it was fragile, and deleting a program never touched its clone at all — clones just accumulated. Separately, `saveProgram` used `onConflictDoUpdate` on `(user_id, name)`, so saving a *new* program with a name that already existed silently overwrote the existing program's sessions/exercises instead of erroring.

**Fix — three sequential changes, in order:**

1. **`workout_sessions.phase_type` write-time snapshot** (migration `061`): `phase_type` is now captured and stored on the session row itself at write time (`sync-workout`, `log-exercise`), backfilled from the existing `phase_id` join for historical rows. `buildWorkoutSessions` reads it directly — `isDeload`/`isTesting`-derived analytics (exercise history, training load, weekly stats) no longer depend on `program_phases` rows still existing. This is what makes "always delete a program's owned phase set" safe in step 3.
2. **Per-user program name uniqueness**: `saveProgram` now pre-checks for a name clash (excluding the program being updated) inside its transaction and throws `A program named "<name>" already exists. Use a different name.` if found; the `onConflictDoUpdate` upsert is removed entirely. `/api/workout-templates` returns this as `409`, and the AI builder's save flow shows the message in a toast instead of "Failed to save program".
3. **Phase set ownership** (migration `062`): `phase_sets` gains `owner_program_id` (FK → `programs.id`, `ON DELETE SET NULL`) and `template_base_name`. New repo methods `createOwnedPhaseSetClone(userId, templateBaseName, programName, phases)` and `linkPhaseSetOwnership(phaseSetId, programId, userId)` replace the old `createPhaseSet`-based clone in `/api/phase-sets/clone`. The clone is named `<template> (<program name>)` via `lib/phase-set-naming.ts`'s `buildOwnedPhaseSetName`. `saveProgram` now cascades a rename to the owned clone whenever the program's name changes (no-op otherwise). `deleteProgram` now runs in a transaction that deletes the program's owned phase set first, then the program — unconditionally, no orphan-scanning. `updateProgramPhaseSettings` and the `deletePhaseSetIfOrphaned` heuristic it called are removed entirely. Migration 062 backfills existing `(custom-xxxxxxxx)`/`(custom)` clones (from before this change, including the legacy ones migration `060` already flagged) into the new ownership model where they're referenced by exactly one program and the new name wouldn't collide.

**Verified:** Local dev DB only (never production). `npx tsc --noEmit` clean, `pnpm test` 57/57 pass, `pnpm lint` baseline unchanged. A repository-level end-to-end test exercised the full scenario: clone "Strength Progression" with an override → save as new program "john" with `linkPhaseSetOwnership: true` → confirmed `owner_program_id`/`template_base_name`/override persisted → in-place edit of the clone preserves the link → duplicate name "john" rejected with 409 → renaming "john" → "john2" cascades the phase set rename to `Strength Progression (john2)` → a fresh "john" gets its own distinct clone → deleting "john2" removes only its owned clone (`program_phases` and `phase_sets` rows gone) while "john"'s clone and the canonical `is_default=true` templates are untouched.

⚠️ **Known gaps (deliberately deferred, low-impact):**
- If `/api/phase-sets/clone` succeeds but the subsequent `/api/workout-templates` save fails, the fresh clone is left unowned (`owner_program_id IS NULL`) and unreferenced — harmless, retrying creates a new one rather than fixing the orphan.
- If a user manually reassigns another program's owned clone via the config-screen phase-set dropdown, and the owning program is later deleted, the borrowing program's `phase_set_id` silently becomes `NULL` (`ON DELETE SET NULL`) and it loses its phase progression.

**Files changed:**
- `lib/data/postgres/migrations/061_workout_sessions_phase_type.sql`, `062_phase_set_ownership.sql` (new)
- `lib/data/postgres/schema.ts`, `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`
- `lib/types/log.ts`, `lib/types/program.ts`, `lib/phase-set-naming.ts` (new) + `lib/__tests__/phase-set-naming.test.ts` (new)
- `app/api/sync-workout/route.ts`, `app/api/log-exercise/route.ts`, `app/api/phase-sets/clone/route.ts`, `app/api/workout-templates/route.ts`
- `components/workout-builder/builder-review.tsx`

---

### Session 90 — UI Bug Fixes & MMO Colour Palette (2026-06-11) ✅ Complete

**Phase set templates:** The named built-in phase sets that the AI program builder maps goals onto by name (Strength/Hypertrophy/S+H/Powerbuilding Progression, Baselining, Linear Progression) were editable, so users could rename/delete the canonical templates the builder relies on, and the phase-cycle "clone on save" flow had been generating a growing list of `(custom-XXXXXXXX)` clones (plus one legacy suffix-less `(custom)` row) with no way to tell which were intentional.

- Migration `060_phase_set_templates_readonly.sql` flags those 6 templates `is_default = true` (same treatment as "Phase-Based Progression"), so they show a "Default" badge + Clone button instead of being directly editable, and deletes orphaned `(custom)`/`(custom-xxxx)` clones with no referencing program or workout history.
- `lib/data/postgres/adapter.ts`: new users are now seeded with these templates as `isDefault: true`; `deletePhaseSetIfOrphaned`'s regex now also matches the legacy suffix-less `(custom)` name.

**Profile/Achievements merge:** The Profile and Achievements tabs both surfaced overlapping XP/level/badge data. Trophy Case now renders inside the Profile tab (above the existing collapsible Achievements summary, which already supported "minimised by default" + "see all"), and the standalone Achievements tab/nav entry is removed (`app/more/more-content.tsx`, `components/more/achievements-tab.tsx` deleted).

**Health > Training reorder:** The Training tab on `/health` showed the Training Load chart above the calendar. Reordered so the calendar (the most-used widget) renders first, followed by Training Load (`app/health/health-content.tsx`).

**MMO-themed colour palette:** Widget/card accent colours were picked via a raw native `<input type="color">` HSV picker — unintuitive on mobile and disconnected from the app's gamification theme. Added `lib/rarity-colors.ts` (an 8-tier MMO rarity palette: Common/Uncommon/Rare/Epic/Arcane/Legendary/Mythic/Primal, anchored on the user's existing Body Weight=Rare/blue, Sleep=Arcane/purple, Mood=Legendary/gold defaults) and a new `components/ui/color-swatch-picker.tsx` (Radix Popover swatch grid + 🎨 custom fallback that still opens the native picker). Replaced all 21 colour-dot instances across Home Widgets (Card Widgets + Metric Tiles) and the Home dashboard's inline edit-mode dots.

**Verified:** Local DB + Playwright on the 412×915 viewport — confirmed the 4 named phase sets show "Default"/Clone in `/more?tab=config` → Advanced Settings → Phase Sets; `/more?tab=profile` shows Trophy Case + collapsible Achievements with only Profile/Friends/Config tabs; `/health?tab=training` shows the calendar before Training Load; the rarity swatch popover opens from Home edit-mode dots and Profile → Home Widgets, live-updates the card colour, and persists via `ta_card_colors`/`ta_pill_colors`. `tsc --noEmit` and `eslint` clean.

**Files changed:**
- `lib/data/postgres/migrations/060_phase_set_templates_readonly.sql` (new)
- `lib/data/postgres/adapter.ts`
- `components/more/profile-tab.tsx`
- `app/more/more-content.tsx`
- `components/more/achievements-tab.tsx` (deleted)
- `app/health/health-content.tsx`
- `lib/rarity-colors.ts` (new)
- `components/ui/color-swatch-picker.tsx` (new)
- `components/more/home-widgets-section.tsx`
- `app/session-select/session-select-content.tsx`

---

### Session 87 — Card Widget Drag Fix + Training Load Legend (2026-06-11) ✅ Complete

**Problem (H1):** On the real device, only the Recommended Today card could be long-press dragged to reorder in Home edit mode. Streak, This Week, and the Weight/Nutrition/Sleep/Steps/Mood card widgets did not respond to a long-press at all.

**Root cause:** Recommended Today's content sits in a plain `<div>`, while every other section's content was wrapped in a native `<button>` (with `pointer-events-none` applied in edit mode to disable its `onClick`). On Android, a `<button>` element's built-in touch handling intercepts the long-press gesture before dnd-kit's `PointerSensor` 300ms activation delay can register a drag, even with `pointer-events: none` set.

**Fix:** Replaced all the `<button>` wrappers (Streak, This Week, Body Weight, Nutrition, Sleep, Steps, Mood cards) with `<div role="button" tabIndex={0} onClick={...}>`, matching the working Recommended Today pattern. The `onClick` handler now guards on `!sectionEditMode` directly instead of `e.preventDefault()`.

**Problem (training load legend):** The Training Load bar chart on Health > Training colours each day's bar segments by which session was trained that day, but had no legend mapping colours to session names — `WeeklyStatsHub` already supports a `sessions` prop that renders this legend (used on `/stats`), but `health-content.tsx` wasn't passing it.

**Fix:** Pass `sessions={activeSessions}` to `WeeklyStatsHub` in `health-content.tsx`.

**Verified:** Local dev server + Playwright — confirmed click-to-navigate still works on the converted cards (clicking Body Weight navigates to `/health`), and a simulated drag (300ms hold + move) reorders `card_weightSparkline` above `streak` and persists to `ta_home_section_order`. Training Load legend confirmed showing "Push / Pull / Legs" with matching bar colours on `/health?tab=training`. `tsc --noEmit` and `eslint` clean.

**Files changed:**
- `app/session-select/session-select-content.tsx`
- `app/health/health-content.tsx`

---

### Session 87 — Sync-Workout Phase Over-Count Fix (2026-06-11) ✅ Complete

**Problem:** `app/api/sync-workout/route.ts` fetched `countSessionsSinceStart` once before the batch, then incremented a local counter for every item processed — including items whose `workoutSessionId` already existed in the DB (idempotent re-syncs after a partial failure). This over-counted the session number used to compute the training phase, causing later items in the same batch to be assigned to a phase ahead of where they actually belong.

**Fix:**
- `WorkoutRepository.ensureWorkoutSession()` now returns `boolean` (was `void`) — `true` if a new row was inserted, `false` if a session with that id already existed (`adapter.ts` uses `.onConflictDoNothing().returning(...)` and checks the result length).
- `sync-workout/route.ts` only increments `syncedSessionCount` when `ensureWorkoutSession` returns `true`, so re-synced sessions no longer skew the phase calculation for subsequent items in the batch.

**Verified:** Local DB — set up an automatic-phase test program (3 phases, durations 7/1/100 cycles, `sessionsPerCycle=1`) with 7 prior sessions counted. Re-synced an existing session plus one new session in the same batch: the existing session's `phase_id` was left untouched (not overwritten on conflict) and the count stayed at 7 for the new session, correctly placing it in phase P1 (the 8th session). Confirmed `pnpm tsc --noEmit` and `eslint` pass on the changed files.

**Files changed:**
- `lib/data/postgres/adapter.ts`
- `lib/data/repository.ts`
- `app/api/sync-workout/route.ts`

---

### Session 87 — Back-Gesture Dismiss for Hand-Rolled Sheets (2026-06-11) ✅ Complete

**Problem:** B10 noted that hand-rolled `fixed inset-0` overlays only close on backdrop click — Android's back gesture/button navigates the underlying router instead of closing the sheet. The original `health-content.tsx` overlays cited in B10 had already been migrated to Radix `<Sheet>` (which doesn't have this problem), but `food-logger-sheet.tsx`, `food-library-sheet.tsx`, and `quick-edit-log-sheet.tsx` are still hand-rolled and had the same issue.

**Fix:** Added `lib/hooks/use-sheet-back-dismiss.ts` — a `useSheetBackDismiss(open, onClose)` hook that pushes a `history` entry while the sheet is open and calls `onClose` on `popstate`. If the sheet is closed via the UI (not back-gesture), the cleanup calls `history.back()` to remove the pushed entry, so a single subsequent back press returns to the real previous page rather than being absorbed by a leftover history entry. Wired into all three sheets.

**Verified:** Playwright against the local DB — opening the food logger pushes a history entry (`history.length` 2→3); a simulated back navigation (`page.goBack()`) closes the sheet and stays on `/nutrition` (no router navigation). Closing via the X button leaves history in a clean state — a single subsequent back press navigates away from `/nutrition` as expected (no double-back needed). Confirmed `pnpm tsc --noEmit` and `eslint` pass.

**Files changed:**
- `lib/hooks/use-sheet-back-dismiss.ts` (new)
- `components/nutrition/food-logger-sheet.tsx`
- `components/nutrition/food-library-sheet.tsx`
- `components/nutrition/quick-edit-log-sheet.tsx`

---

### Session 87 — Food Log Quick-Log Rollback on Partial Failure (2026-06-11) ✅ Complete

**Problem:** B15 — `food-logger-sheet.tsx`'s `quickLogSavedMeal` and `saved-meals-section.tsx`'s `quickLog` each looped over a saved meal's items, POSTing one `food_log` per item sequentially. If a request failed partway through (e.g. a flaky connection), the items logged before the failure stayed in the DB with no way to undo them — a "Log" tap could silently leave a partial meal in the diary.

**Fix:** Added `lib/nutrition/log-meal.ts` with `logMealItems(meal, date, mealTypeId)` — shared by both call sites. It logs items sequentially, collecting the created `food_log` ids; if any POST fails (network error or non-2xx), it `DELETE`s every previously-created log for that meal before re-throwing, so the caller's existing `catch` (toast "Failed to log meal") sees a clean all-or-nothing result.

**Verified:** Local DB — created a 2-item saved meal, ran `logMealItems` against the real local API with the second item's POST forced to return 500. Confirmed the call threw as expected and the first item's `food_log` row was deleted (table empty afterward) — no partial log left behind. `pnpm tsc --noEmit` and `eslint` pass.

**Files changed:**
- `lib/nutrition/log-meal.ts` (new)
- `components/nutrition/food-logger-sheet.tsx`
- `components/nutrition/saved-meals-section.tsx`

---

### Session 87 — Touch Target Fixes + Orphaned Phase Set Cleanup (2026-06-11) ✅ Complete

**Problem (B11):** The Steps "Log" button on the Health page used `text-[9px]` and smaller padding than the Weight/Body Fat "Log" buttons next to it. The floating per-tile "Log" button on session-select metric tiles was also undersized (`text-[9px] px-2 py-1.5`, ~18px tall) relative to the 44dp touch target guideline.

**Fix:** Steps "Log" button now uses `rounded-xl px-3 py-1.5 text-xs` to match Weight/Body Fat. The session-select tile "Log" button increased to `text-[10px] px-2.5 py-2`. Full 44dp isn't achievable on the 76px-wide tiles without a layout redesign, so this is a modest improvement rather than a full fix — InfoIcon buttons on BMI/Trend/Balance/Lean Mass tiles remain untouched.

**Problem (B1):** Saving program phase settings (e.g. toggling the baseline phase or changing `sessionsPerCycle`) clones a new `phase_sets` row each time but never cleaned up the previous custom clone, so unused `(custom-...)` phase sets accumulated indefinitely.

**Fix:** `updateProgramPhaseSettings` in `lib/data/postgres/adapter.ts` now looks up the program's previous `phaseSetId` before updating, and afterward calls a new `deletePhaseSetIfOrphaned(phaseSetId, userId)`. That method only deletes phase sets matching the `(custom-XXXXXXXX)` naming pattern (never default/built-in sets), and only if no program's `phaseSetId` and no `workout_session.phase_id` (via `program_phases`) still references it.

**Verified:** Local DB via a temporary vitest test — created two custom phase sets, switched the test program's `phaseSetId` from set A to set B (set A deleted as orphaned, set B retained), then switched back to the default set (set B deleted as orphaned). `tsc --noEmit` and `eslint` clean.

**Files changed:**
- `app/health/health-content.tsx`
- `app/session-select/session-select-content.tsx`
- `lib/data/postgres/adapter.ts`

---

### Session 86 — Done Screen Bounce-Back Fix (2026-06-11) ✅ Complete

**Problem:** On finishing a workout (either via the last exercise's "Next" button or the pre-workout "Complete Workout" button), the done screen (confetti, "You crushed it!", stats grid) would flash for a single frame and then immediately revert to the pre-workout screen with "Complete Workout" still showing — letting the user tap it again and fire duplicate `/api/complete-workout`, achievements, and calendar requests.

**Root cause:** The "reset stale persisted state" effect in `components/workout-screen.tsx` depended on `[sessionType, store]`. `useWorkoutStore()` returns a new object reference on every state mutation, so the effect re-ran on every store change. The instant `mode` flipped to `"done"`, the effect fired, called `resetSession()` (which resets `mode` back to `"pre"`), and bounced the user straight back.

**Fix:**
- Effect now depends only on `[sessionType]` — it only runs on mount/session-change (its intended purpose: clean up a stale `"done"` state left over from a previous visit), not in response to in-session completion.
- Added an `isCompletingRef` guard around both completion handlers (`advance()`'s final-exercise branch and `PreWorkoutScreen`'s `onCompleteWorkout`) so a stray double-click can't fire duplicate completion/calendar/achievements requests.

**Verified:** Playwright against the local DB — before the fix, 5 rapid clicks on "Complete Workout" produced 4× `POST /api/complete-workout` and the screen bounced back to pre-workout; after the fix, exactly 1× `POST /api/complete-workout` and the done screen (3/3 exercises, 9 sets, 45 kcal, confetti) renders and persists.

**Files changed:**
- `components/workout-screen.tsx`
- `package.json` — version 1.25.1
- `lib/changelog.ts` — 1.25.1 entry

---

### Session 84 — Local Postgres for Sandboxed Sessions (2026-06-10) ✅ Complete

**Problem:** Session 83 noted that the production Railway Postgres is unreachable from Claude Code on the web sandboxes — outbound TCP is restricted to ports 80/443, so the DB proxy port (e.g. `24841`) always times out, even with the network policy set to "all". This blocked any DB read/write testing in sandbox sessions.

**Fix — local Postgres 16 instance, set up automatically per session:**
- `.claude/hooks/session-start.sh` (registered via `.claude/settings.json` `SessionStart` hook, web-only via `CLAUDE_CODE_REMOTE`) runs `pnpm install` (if needed) and `scripts/local-db/setup.sh`.
- `scripts/local-db/setup.sh` — `initdb`s a cluster at `/var/lib/postgresql/local-dev` (idempotent), starts Postgres on port 5433, creates `trainingai_dev`, applies all migrations via `scripts/local-db/migrate.js` (standalone runner mirroring `ensureSchema`), seeds fake data on first run only (checked via empty `users` table), and writes `DATABASE_URL` to `.env.local` for `next dev`.
- `scripts/local-db/seed.sql` — one test user (`test@local.dev`), a Push/Pull/Legs program with a "Standard" progression style, rotation schedule, ~9 logged workout sessions over the last 18 days, 14 days of body metrics, 7 days of sleep/mood logs, and 3 personal records.
- `package.json` — added `pnpm db:local` to re-run setup manually.

**Verified:** Full setup ran cleanly (migrations apply with the same expected/tolerated warnings as production `ensureSchema`), seed data persists across reruns without duplication, and `pnpm dev` against the local DB starts cleanly with no connection errors.

**Caveat:** This local DB only persists for the lifetime of the sandbox container — each new session re-runs setup (fast, idempotent) but starts from the same seed data, not real production data.

**Files changed:**
- `.claude/hooks/session-start.sh`, `.claude/settings.json` (new)
- `scripts/local-db/setup.sh`, `scripts/local-db/migrate.js`, `scripts/local-db/seed.sql` (new)
- `package.json` — `db:local` script added
- `CLAUDE.md` — new "Local Development Database" section

No version bump — infrastructure-only change, no user-visible app changes.

---

### Session 85 — Local DB Connection Fix + Activity Logging E2E Test (2026-06-10) ✅ Complete

**Problem:** The Session 84 local DB setup didn't actually work end-to-end — `pnpm dev` failed with `ensureSchema` connection timeouts / SSL errors, because the container pre-sets `DATABASE_URL` (production Railway) and `DATABASE_SSL=true`, and Next.js won't let `.env.local` override already-set `process.env` vars.

**Fix:** `setup.sh` now writes a unix-socket `DATABASE_URL` (TCP was hanging in the sandbox) with proper `&` escaping in the sed replacement, `session-start.sh` writes `unset DATABASE_URL` / `unset DATABASE_SSL` to `$CLAUDE_ENV_FILE`, and `seed.sql` now includes a `password_hash` for `test@local.dev` (password `testpass123`) so credentials login works out of the box. Documented in `CLAUDE.md`.

**Verified end-to-end against the local DB:**
- Credentials login for `test@local.dev` works (session cookie issued correctly).
- Activity logging (Session 82-83 feature): `GET /api/activity-types`, `POST`/`GET`/`DELETE /api/activity-logs` all work correctly.
- `GET /api/calendar-data` correctly returns `activityDays` (cyan dot data) alongside `trainedDays`.
- `GET /api/day-log?date=YYYY/MM/DD` (note: `/`-separated date format required) returns `activityLogs` for the day.
- Admin activity type management (`/api/admin/activity-types` POST/DELETE) works for admin users.

No version bump — infrastructure fix + testing only, no user-visible app changes.

---

### Session 83 — Activity Logs in Health Calendar (2026-06-10) ✅ Complete

**Problem:** Session 82 added manual activity logging, but logged activities were invisible outside the Health > Training history card — the Health Calendar (used for workouts and body data) didn't show or link to them, and there was no way to delete an activity from the day overview.

**What was built:**
- `getCalendarData(userId, year, month)` now returns `{ trainedDays, activityDays }` — `activityDays` maps date strings to the distinct `activityType`s logged that day, queried from `activity_logs`.
- `repository.deleteActivityLog(userId, id)` — deletes an activity log scoped to its owner; exposed via a new `DELETE` handler on `/api/activity-logs`.
- `app/api/day-log/route.ts` — `DayLogResult` now includes `activityLogs: ActivityLog[]` for the requested date.
- `components/calendar-widget.tsx` — days with a logged activity get a small cyan dot alongside (or instead of) workout-session dots, with a new "Activity" legend entry.
- `app/health/health-content.tsx` — the day overlay gains an "Activities" section (between sessions and Body Data) showing each activity's icon (via `getActivityIcon`/`activity-types` cache), title, and a `time · duration · distance · calories` summary line, each with a delete button (confirmation dialog mirrors the existing exercise-delete flow, calls the new `DELETE /api/activity-logs` and invalidates the `activity-logs` cache).

**Caveats:**
- The calendar widget caches `getCalendarData` results in `sessionStorage` (`ta_calendar_v2_${year}_${month}`); a newly logged activity's dot may not appear until that cache entry expires or the page is hard-refreshed.
- "Log Activity" is still a manual entry form (see deferred live-timer redesign below) — HR/distance/calorie enrichment from Health Connect still only happens on the next sync.

**Verification:** `pnpm test` (37/37 pass), `pnpm build` succeeds, `npx tsc --noEmit` clean, targeted `npx eslint` on changed files clean (aside from a pre-existing unrelated warning). Not tested against a live DB/session — the non-prod Postgres instance set up for sandbox testing this session still resolved to Railway's internal hostname (unreachable from the sandbox); needs the `DATABASE_URL` env var fixed to the public proxy host (`DATABASE_PUBLIC_URL`) in a future session before live sandbox testing is possible.

**Version:** 1.24.0 → 1.25.0

---

### Session 82 — Activity Tracking Redesign (2026-06-10) ✅ Complete

**Problem:** `cardio_sessions` only covered Health-Connect-synced cardio (run/walk/cycle/etc.) with a fixed set of fields, and the "Log Activity" button on Workout Select was a placeholder. There was no way to manually log an arbitrary activity (yoga, sport, etc.) or to manage which activity types existed.

**What was built:**
- DB: new `activity_types` catalog table (id, label, Phosphor icon name, `isDistanceBased`, `sortOrder`) seeded with the existing cardio types plus `other`; new `activity_logs` table replaces `cardio_sessions` (adds `activityType` FK, `title`, `notes`, optional `avgHr`/`maxHr`/`distanceKm`/`caloriesBurned`).
- `lib/health-connect-sync.ts`: `mapExerciseTypeToActivityType()` maps HC `exerciseType` constants to `activity_types` ids (falls back to `other`); per-session `getSessionMetrics()` (distance/calories/avg+max HR) extracted to a shared helper; new exported `enrichActivityLogs(candidates)` backfills HR/distance/calories on activity logs that were saved without them once HC data for that window is available.
- `/api/sync-health`: writes synced sessions into `activity_logs` (dedup on date+startTime), and returns `enrichmentCandidates` (recent logs missing HR/distance/calories) for the client to enrich post-sync.
- New API routes: `/api/activity-types` (read-only, cached), `/api/admin/activity-types` (admin CRUD), `/api/activity-logs` (list + create), `/api/activity-logs/[id]/metrics` (PATCH for enrichment).
- New UI: `components/workout/log-activity-sheet.tsx` (Log Activity sheet — type grid, title, date/time, duration, distance for distance-based types, calories, notes), `components/health/activity-history-card.tsx` (Health > Training "Activities" card, last 14 days, expandable for HR/notes), `components/admin/activity-type-manager.tsx` (admin CRUD UI, wired into a new "Activities" tab in `app/admin/admin-content.tsx`).
- `lib/constants/activity-icons.ts` — maps activity type icon names to `@phosphor-icons/react` components.
- Removed: `/api/health-connect/webhook` (Sheets-era webhook, superseded by `/api/sync-health`) and `/api/log-exercise-session` (superseded by `/api/activity-logs`).
- `app/api/body-metadata/route.ts` — `calsBurnedToday` now sums `activity_logs` instead of `cardio_sessions`.

**Caveats:**
- HR/distance/calorie enrichment only runs as part of the native Health Connect sync flow (`syncHealthConnect()`), so manually-logged activities won't get enriched until the next time the app syncs with HC and that activity's time window has HC session data available.
- The old Tasker automation that POSTed to `/api/health-connect/webhook` (using `GOOGLE_REFRESH_TOKEN`/`WEBHOOK_SHEET_ID`) must be disabled/removed — that route no longer exists. The `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID` Tasker → `/api/health-connect/ingest` flow (body metrics only) is unaffected.

**Verification:** `pnpm build`, `pnpm test` (37 tests), `npx eslint`, `npx tsc --noEmit` all pass. Dev server smoke-checked: `/api/activity-types` (401 unauth), `/workout-select`, `/health`, `/admin` (all 307 redirect to sign-in, no compile errors). Not tested against a live DB/session — needs manual QA of the Log Activity sheet, Activities history card, and admin Activities tab.

**Version:** 1.23.1 → 1.24.0

---

### Session 81 — Profile Page Cleanup (2026-06-10) ✅ Complete

**Problem:** The Admin Console link only existed on the legacy `/profile` page (`app/profile/profile-content.tsx`, 1136 lines), which was supposed to have been retired when the More > Profile tab became the primary profile screen (session 71). Two stale links still pointed at it: the home screen avatar button and the Health page "→ Goals" row.

**Fix:**
- New `components/more/home-widgets-section.tsx` — ports the "Home Widgets" customization (Home Sections visibility, Card Widgets show/hide + colour, Metric Tiles show/hide + colour, Weight Sparkline 7d/30d) from the legacy page, same localStorage keys (`ta_ss_widgets`, `ta_ss_cards`, `ta_pill_colors`, `ta_card_colors`, `ta_home_hidden_sections`, `ta_weight_lookback`) so existing settings carry over.
- `components/more/profile-tab.tsx` — renders `<HomeWidgetsSection />` (between Appearance and About) and a new "Admin" section (between About and Sign Out/Edit Profile actions), gated on `user?.isAdmin || user?.email === '<owner-email>'`, with the same `/api/admin/pending-count` badge as before. (The literal address is redacted here — that hardcoded check is long gone, replaced by `users.is_admin` plus the `ADMIN_EMAIL` boot bootstrap.)
- `app/profile/page.tsx` — now `redirect('/more')`, matching `/config` and `/stats`. Deleted `app/profile/profile-content.tsx`.
- `app/session-select/session-select-content.tsx` (avatar button) and `app/health/health-content.tsx` ("→ Goals" row) now link to `/more` instead of `/profile`.

**Verification:** `tsc --noEmit`, `next lint`, `pnpm build` all pass with no new warnings. Not browser-tested this session (no `DATABASE_URL`/`SESSION_SECRET` in the sandbox) — needs manual check.

**Version:** 1.23.0 → 1.23.1

---

### Session 80 — Bodyweight Exercise Support (2026-06-10) ✅ Complete

**Feature: rep-based exercises without external weight (push-ups, pull-ups, sit-ups, dips, etc.)**

- `lib/data/postgres/migrations/057_exercise_type.sql` — adds `exercise_library.exercise_type` (`'weighted' | 'bodyweight'`, default `'weighted'`), backfills `'bodyweight'` where `equipment = ARRAY['bodyweight']` exactly.
- `app/api/log-exercise/route.ts` — for `bodyweight` exercises, `effectiveWeight = max(0, bodyweight (90-day lookback from body_metrics) + addedWeight)` is fed into the existing 1RM/PR/intensity pipeline. `weights`/`set_logs.weightKg` continue to store the raw added/assisted load (default 0, range -100..500 in the API, dial range -50..+100); `volume` is still added-weight × reps only (bodyweight contributes 0 volume by design).
- `components/workout/set-card.tsx` + new `components/workout/added-weight-toggle.tsx` — active card shows a large rep stepper as the primary control for bodyweight exercises, with a collapsible "+ Add weight" picker (defaults open only if a non-zero load is already set). Done/upcoming chips collapse to "`X reps`" when there's no added load, or show "`+X kg`/`X kg assisted`" alongside reps.
- `components/workout/active-workout-screen.tsx` — set-targets/warmup/AMRAP-suggested-weight sections hidden for bodyweight exercises; "Last session" chips and rest-phase previews use the new `formatSetLoad`/`formatSetLoadParts` helpers (`components/workout/utils.ts`).
- `components/workout/exercise-summary-screen.tsx` — "Sets" list uses the same formatting; "Next Session" target card hidden for bodyweight (1RM comparison card stays, now reflecting bodyweight + added load).
- `components/admin/exercise-manager.tsx` + `components/exercises/add-exercise-sheet.tsx` — Weighted/Bodyweight toggle added to both forms; Add Exercise pre-fills `bodyweight` when AI-generated equipment is exactly `['bodyweight']`.

**⚠️ Known caveats / things to watch for during testing**

- **No bodyweight logged in the last 90 days** → `bodyweightKg` resolves to 0, so `effectiveWeight = addedWeight` (often 0), `estimated1rm` comes back as 0 — no PR, no intensity %, and the summary screen shows "0 kg" for "This session" 1RM. Log a current weight under Body → Body Metrics before testing 1RM/PR behaviour for bodyweight exercises.
- **Per-set "Add weight" toggle doesn't carry over** — `perSetWeights` for bodyweight exercises always initialises to `[0,0,0,...]`, so the collapsible toggle starts closed on every set. For weighted pull-ups across multiple sets you currently have to re-open and re-enter the load each set.
- **Backfill is an exact-array match only** — exercises whose equipment is `['bodyweight']` plus anything else (e.g. a dip belt or weighted vest tag) won't be auto-classified; reclassify manually in the admin exercise manager if needed.
- **Reclassifying an exercise with existing weighted history** changes how old `set_logs.weightKg` values are displayed (e.g. "Last session" chips now render as `+Xkg`/assisted instead of plain `Xkg`) — the underlying numbers aren't migrated, only the display logic changes.
- **1RM for bodyweight exercises moves with your bodyweight** — losing weight can lower the estimated 1RM (and suppress a PR) even with identical or better reps/added load. This is intentional given the bodyweight+added-load model but may be surprising.
- **Time-based exercises (planks/holds) are out of scope** — if one of these gets tagged `bodyweight`, the UI will show a rep stepper, not a duration input. Leave hold/plank-style exercises as `weighted` (or skip reclassifying them) until time-based logging is built.
- **1RM calculator dialog** opens pre-filled with 0 kg for bodyweight exercises (since `perSetWeights` defaults to 0) — minor, not addressed in this pass.

### Session 79 — AI-Gated Exercise Addition (2026-06-09) ✅ Complete

**Feature: any user can add exercises to the global library**

Previously only the admin exercise manager could create `exercise_library` rows. Now any authenticated user can submit a new exercise from three entry points, with Gemini doing the data-entry work:

- `app/api/exercises/generate/route.ts` (new) — `POST { name }` → Gemini (`gemini-3.1-flash-lite`) returns `{ normalizedName, instructions, muscles, equipment }`. System prompt expands abbreviations (DB → Dumbbell, BB → Barbell, RDL → Romanian Deadlift, OHP → Overhead Press, etc.), restricts `muscles`/`equipment` to the existing fixed vocabularies, and follows the established equipment-prefix naming convention from migration `032_exercise_equipment_variants.sql`.
- `app/api/exercises/route.ts` (new) — `POST` creates a new `exercise_library` row (stamped with `created_by`) or, with `mergeWithId`, renames an existing entry in place (`renameExercise`).
- `lib/data/postgres/migrations/056_exercise_library_created_by.sql` — adds `created_by` column to `exercise_library`.
- `lib/data/repository.ts` / `lib/data/postgres/adapter.ts` — new `createExercise` and `renameExercise` methods.
- `components/exercises/add-exercise-sheet.tsx` (new) — bottom sheet: name input → "Generate" → review/edit form (name, instructions, equipment chips, muscle chips with main/secondary roles) → save. Runs a fuzzy duplicate check (`fuzzyScore` in `lib/exercise-utils.ts`, threshold 0.3) against the user's exercise library and surfaces "Use existing" / "Rename & use" options for close matches.
- Wired into three entry points: stats exercise-library search (`components/stats/exercise-library-search.tsx`), workout builder exercise-swap panel (`components/workout-builder/builder-review.tsx`), and the admin exercise manager (`components/admin/exercise-manager.tsx`), which also gained an inline AI "Generate" button on its existing add/edit form.
- `lib/__tests__/exercise-utils.test.ts` (new) — unit tests for `fuzzyScore`.

**Post-ship bug fixes (from user testing)**

1. **Empty fuzzy-match list** — `AddExerciseSheet` read the exercise library via `readCacheSync('exercise-library')` (sessionStorage mirror), but `SyncProvider.warmCache()` skips writing that mirror on a cache hit (see new Known Issue B23). In a fresh session with a warm `localStorage` entry, the mirror was empty, so "similar exercises" never appeared even for exact matches like "Hip thrust" → "Barbell Hip Thrust" / "Single Leg Hip Thrust". Fixed by adding a direct `fetch('/api/exercise-library')` fallback in `AddExerciseSheet` whenever its local `library` state is empty on sheet open.
2. **AI names not equipment-prefixed** — for equipment-agnostic inputs (e.g. "Hip thrust"), Gemini returned "Hip Thrust" instead of the library convention "Barbell Hip Thrust". Updated the `SYSTEM_PROMPT` in `app/api/exercises/generate/route.ts` to require an equipment prefix (the single most common equipment for that exercise) unless the exercise is inherently bodyweight, and to list that equipment first in the `equipment` array.

### Session 77 — Quick Wins: H2 + B12 + Known Issues Audit (2026-06-09) ✅ Complete

**H2 — Recommended Today colour picker** (`app/session-select/session-select-content.tsx`)

Added `recommendedToday` key to `CARD_DEFAULT_COLORS` (default `#06b6d4`). In home screen edit mode a colour dot appears top-right of the card. Choosing a colour updates the card background, border, label text, phase progress bar track and fill, and Start Workout button — all driven from the single stored hex value via inline rgba maths. The "Trained Today" (green) state is unchanged. Stored in `ta_card_colors` localStorage alongside all other section colours.

**B12 — AMRAP reps cap** (`app/api/log-exercise/route.ts`)

Baseline AMRAP path called `calc1RM(weights[0], reps[0])` with no reps guard. Above 36 reps the Epley formula inflates wildly (100 reps at 50 kg → 216 kg 1RM). Added `Math.min(reps[0], 36)`. Normal sets were already protected by the `r <= 30` guard in `calculate1RM`.

**Known Issues audit**

Checked every open item in the Known Issues table against the current codebase. Eight items marked as still open were already fixed in prior sessions and never struck through: B8, B13, B14, B17, B18, B19, B20, B22. All struck through with confirmation notes so they don't get re-investigated.

**Files changed:**
- `app/session-select/session-select-content.tsx` — `recommendedToday` colour key + edit-mode dot + card style wiring
- `app/api/log-exercise/route.ts` — `Math.min(reps[0], 36)` in AMRAP baseline path
- `projectOverview.md` — Known Issues table cleaned up; session 77 notes; version table
- `lib/changelog.ts`, `package.json` — v1.20.9

**Version:** 1.20.8 → 1.20.9

---

### Session 76 — Sleep Correlation % Baseline Rewrite (2026-06-09) ✅ Complete

**Problem** (`app/api/sleep-performance-correlation/route.ts`)

Raw average 1RM across all exercises was confounded by exercise selection — if heavy compound sessions happened to fall on 6–7h sleep nights and lighter work on 8h+ nights, the bucket averages reflected exercise choice, not sleep quality. As seen: 8h+ (41.6kg) was lower than 6–7h (80.8kg), which is physiologically implausible.

**Fix — per-exercise % deviation from baseline**

1. First pass over all 90 days of sessions: collect every estimated 1RM by exercise name
2. Any exercise with fewer than 3 logged sessions is excluded — no meaningful baseline
3. Remaining exercises get a mean baseline across all their sessions in the window
4. Second pass: for each workout-sleep pair, each qualifying exercise contributes `((estimated1rm − baseline) / baseline) × 100` to the relevant sleep bucket
5. Buckets average those % deviations

A squat and a lateral raise now contribute equally as "+4% / −2%" regardless of absolute weight. The correlation measures whether you perform *above or below your own norm* on different sleep nights.

**UI** (`app/health/health-content.tsx`)

- Bucket values changed from `Xkg` to `+X% / −X%`
- Below-baseline buckets render in red (`#ef4444`), above-baseline in brand colour
- Info blurb updated to explain the baseline-relative approach
- Insight text reads e.g. *"After 7–8h sleep your lifts average 4.2% above baseline — vs 1.8% below after <6h."*

**Files changed:**
- `app/api/sleep-performance-correlation/route.ts` — full algorithm rewrite; `SleepCorrelationResponse.buckets` field renamed `avgOneRm` → `avgPctChange`
- `app/health/health-content.tsx` — bucket display and info blurb updated
- `lib/changelog.ts`, `package.json`, `projectOverview.md` — session notes + v1.20.8

**Version:** 1.20.7 → 1.20.8

---

### Session 75 — ACWR + Sleep Correlation Data Validation (2026-06-09) ✅ Complete

**ACWR minimum-data threshold tightened** (`app/api/training-load/route.ts`)

The previous check (`chronicAvg < 100`) was purely volume-based. Sessions bunched in the last 7 days with high volume could pass it and produce an inflated, meaningless ratio because there was no real chronic baseline. Added two new session-count guards:
- At least **4 non-deload sessions** in the 28-day window
- At least **2 sessions older than 7 days** (to establish a meaningful chronic baseline)

All three conditions must pass; otherwise `interpretation: 'insufficient_data'` is returned and the card shows "Not enough data yet".

**Sleep vs Performance "not enough data" state** (`app/health/health-content.tsx`)

Previously when `hasSufficientData` was false the card still rendered and showed the raw insight string `"Not enough paired sleep + workout data yet."`. Now it shows the same pattern as the ACWR card — bold **"Not enough data yet"** + a subtitle — with the info blurb always visible below regardless of data state.

**Files changed:**
- `app/api/training-load/route.ts` — session count guards added to `insufficient_data` check
- `app/health/health-content.tsx` — sleep correlation card "not enough data" state
- `lib/changelog.ts`, `package.json`, `projectOverview.md` — session notes + v1.20.7

**Version:** 1.20.6 → 1.20.7

---

### Session 74 — Calendar Edit/Delete, Double-Macro Fix, Build Cache (2026-06-09) ✅ Complete

**Calendar day detail edit/delete**
- Exercise rows in the Health → Training calendar day sheet now show pencil + trash icon buttons
- Pencil opens an edit Dialog with per-set kg/reps inputs; Save calls `PATCH /api/workout-entry` and refreshes the overlay
- Trash opens a destructive confirmation Dialog; Delete calls `DELETE /api/workout-entry` and refreshes the overlay
- State: `editEx`, `deleteEx`, `mutating`; callbacks `refreshDayOverlay`, `handleEditSave`, `handleDelete`

**Double-macro footer (actually fixed this session)**
- Session 73 documented this as done but the fix was never applied to `meal-card.tsx`
- The totals footer div was unconditional — always rendered even for single-item meals
- Fixed: wrapped in `{logs.length > 1 && (...)}`

**Service worker cache flush (ta-v6 → ta-v7)**
- Previous ta-v6 bump had not yet been picked up by all clients
- Bumped again to ta-v7 to force all clients to evict stale `_next/static/` chunks and pick up the nutrition UI changes

**Railway build cache (Nixpacks)**
- Added `nixpacks.toml` caching pnpm store, node_modules, and .next/cache between deploys
- First cold-cache build still ~7 min; subsequent builds should drop to ~2 min

**Files changed:**
- `app/health/health-content.tsx` — edit/delete dialogs + callbacks, `activeSessions` fetch, `onDayClick` wired to `CalendarWidget`
- `components/nutrition/meal-card.tsx` — totals footer gated on `logs.length > 1` (actual fix)
- `public/sw.js` — CACHE bumped to `ta-v7`
- `nixpacks.toml` — new file, Railway build cache config
- `lib/changelog.ts`, `package.json`, `projectOverview.md` — session notes + v1.20.6

**Version:** 1.20.5 → 1.20.6

---

### Session 73 — Saved Meals Rework + UI Fixes (2026-06-09) ✅ Complete

**Saved Meals tabbed sheet**
- Replaced `SavedMealsSection` (collapsible inline) + `MealBuilderSheet` (separate sheet) with a single `SavedMealsSheet`
- My Meals tab: card list with Log / Edit (pencil) / Delete; tapping Edit slides to Build tab pre-populated
- Build tab: meal name + ingredient list (above search so existing items visible first) + search + add-new-food escape hatch; back chevron returns to My Meals
- On save/update: refreshes My Meals list and returns to it automatically
- `SavedMealsSheet` now calls `invalidateCache` for both nutrition cache keys on every quick-log (fixes B16)

**UI fixes**
- Equipped title localStorage persistence: `_equippedTitle` module-level var + `ta_equipped_title`/`ta_title_cleared` keys survive full page reloads
- Double-macro footer: documented as fixed this session but the change was not applied to `meal-card.tsx` — actually fixed in session 74

**Build optimisations**
- `SparklineChart` switched to `next/dynamic` in `exercise-summary-screen.tsx` — removes Chart.js from the critical workout bundle
- `next.config.ts`: `optimizePackageImports` for `lucide-react`, `@phosphor-icons/react`, `motion/react`

**Files changed:**
- `components/nutrition/saved-meals-sheet.tsx` — full rewrite as tabbed sheet
- `app/nutrition/nutrition-content.tsx` — replaced `SavedMealsSection` + `MealBuilderSheet` with `SavedMealsSheet` + entry button row
- `app/more/more-content.tsx` — localStorage persistence for equipped title
- `components/workout/exercise-summary-screen.tsx` — dynamic SparklineChart
- `next.config.ts` — `optimizePackageImports`
- `lib/changelog.ts`, `package.json`, `projectOverview.md` — session notes + v1.20.5

**Version:** 1.20.4 → 1.20.5

---

### Session 72 — Quick Win Batch (2026-06-09) ✅ Complete

Three quick-win items shipped together:

**Edit existing saved meal**
- Pencil icon on each saved meal row in the Saved Meals section opens `MealBuilderSheet` pre-populated with the meal's name and ingredients
- Saving issues a `PUT /api/nutrition/saved-meals/[id]` which updates the name and replaces all items
- `updateSavedMeal` added to repository interface and Postgres adapter (delete-and-reinsert items pattern)
- Sheet title and button label change to "Edit Meal" / "Update Meal" in edit mode

**Tappable title on More > Profile tab**
- The equipped title display (or "Tap to set title" hint) is now a button that opens `TitlePickerSheet`
- Equipping a title propagates back to `MoreContent` via new `onTitleChange` prop on `ProfileTab`
- Works alongside the existing Achievements tab title picker — both stay in sync via shared `equippedTitle` state

**B9 exercise summary grid fix**
- `ps.slice(0, 5)` caps set cards to match the `Math.min(ps.length, 5)` column count in `gridTemplateColumns`

**Files changed:**
- `lib/data/repository.ts` — `updateSavedMeal` added to interface
- `lib/data/postgres/adapter.ts` — `updateSavedMeal` implemented
- `app/api/nutrition/saved-meals/[id]/route.ts` — `PUT` handler added
- `components/nutrition/meal-builder-sheet.tsx` — `initialMeal` prop, edit mode
- `components/nutrition/saved-meals-section.tsx` — pencil button, edit sheet instance
- `components/more/profile-tab.tsx` — `onTitleChange` prop, `showTitlePicker` state, tappable title, `TitlePickerSheet`
- `app/more/more-content.tsx` — `onTitleChange={setEquippedTitle}` passed to `ProfileTab`
- `components/workout/exercise-summary-screen.tsx` — `ps.slice(0, 5)`
- `lib/changelog.ts`, `package.json`, `projectOverview.md` — session notes + v1.20.4

**Version:** 1.20.3 → 1.20.4

---

### Session 71 — Profile Tab Merge (2026-06-09) ✅ Complete

Replaced the sparse More > Profile tab (small name card + "Goals & Profile Settings" link + edit/sign-out buttons) with the full rich profile UI:

- Large glowing avatar with camera upload button
- Equipped title + name + email + friend code
- Level badge (tappable → level detail sheet) + XP progress bar
- Stats strip: sessions, volume, best streak, member since / weeks on program
- Achievements section: recent 4 badge cards, expandable to full grid
- Season badges (if any)
- Goals accordion: steps, sleep, calories, water, target weight, target BF%
- Appearance accordion: theme colour picker
- About: version badge + APK download link
- Edit Profile sheet + Sign Out

~~The separate `/profile` page (`Goals & Profile Settings`) still exists but the More > Profile tab is now the primary place for all profile-related settings.~~ ✅ Resolved session 81 — `/profile` now redirects to `/more`, and its remaining unique sections (Admin Console, Home Widgets) were ported into the Profile tab.

**Files changed:**
- `components/more/profile-tab.tsx` — full rewrite
- `projectOverview.md`, `lib/changelog.ts`, `package.json` — session notes + v1.20.3

**Version:** 1.20.2 → 1.20.3

---

### Session 70 — Nutrition Scan Context Input (2026-06-09) ✅ Complete

**What was built:**

Photo context input for the nutrition scan flow. Previously, tapping "Scan Photo" opened the camera and immediately sent the image to Gemini with no opportunity to add context. Now:

1. User takes the photo → a preview screen appears showing the thumbnail
2. An optional text field ("Add context") lets the user type clarifying info (e.g. "it's protein pasta", "200g portion", "Aldi brand")
3. "Analyse" sends both the image and the note to Gemini; "Retake" goes back
4. The API passes the note as `Additional context from user: "..."` in the prompt alongside the image

**Files changed:**
- `components/nutrition/capture-step.tsx` — `pendingPhoto` + `photoNote` state; new preview UI between photo capture and AI call; `handlePhotoSubmit` sends image + optional text
- `app/api/nutrition/scan/route.ts` — when `body.image` is present, reads `body.text` as optional user note and injects it into the Gemini prompt
- `lib/changelog.ts` — 1.20.2 entry
- `package.json` — 1.20.1 → 1.20.2
- `projectOverview.md` — session notes

**Version:** 1.20.1 → 1.20.2

---

### Session 69 — Bug Fixes (2026-06-09) ✅ Complete

**Bugs fixed:**

1. **Profile name blank on app load** — `app/more/page.tsx` only passed `equippedTitle`/`friendCode` from JWT; `displayName` is DB-only so `user` state started null until the async fetch resolved. Fixed by fetching user from DB server-side in `page.tsx` and passing as `initialUser` prop (same pattern as `health/page.tsx`). Also fixed the fallback `useEffect` fetch which was typed as `User | null` but `/api/user/profile` returns `{ user, hasPassword, workoutCount }` — `_user` was being set to the wrapper object with no `displayName` at top level.

2. **Cycle progress bar always empty** — `countSessionsSinceStart` uses an INNER JOIN on `program_sessions`, so it only counts `workout_sessions` rows where `session_id` is set. The client was never sending `sessionId` (program session UUID) in the `log-exercise` body, so every `workout_sessions.session_id` was NULL and the JOIN matched nothing — `sessionsInCurrentCycle` was always 0. Fixed by reading `session.id` from the `workout-data` response and including it as `sessionId` in the log-exercise POST body. Also added `programSessionId` to `handleCompleteSet` dep array (same stale-closure pattern as B14). Also fixed `workout-data:meta` cache (TTL_LONG 6h, never invalidated) — now busted on workout completion and on home screen refresh tap.

3. **Progress bar per-phase instead of whole-program** — Changed bar calculation to use `totalPhaseCycles`/`cycleInPhase` so it resets to 0% at the start of each phase and fills to 100% when the phase completes, rather than tracking whole-block progress.

4. **Nutrition scan "Network error"** — `generateText` had no try-catch in `app/api/nutrition/scan/route.ts`. Any Gemini failure caused an unhandled exception → Next.js returned HTML 500 → `res.json()` failed to parse it → client catch block showed "Network error. Check your connection." Fixed by wrapping both `generateText` calls in try-catch returning a proper JSON error response.

**Files changed:**
- `app/more/page.tsx` — server-side DB fetch, pass `initialUser`
- `app/more/more-content.tsx` — accept `initialUser` prop, seed `_user`, fix fetch response extraction
- `components/workout-screen.tsx` — store `programSessionId`, send in log-exercise body, add to dep array, invalidate `workout-data:meta` on complete
- `app/session-select/session-select-content.tsx` — invalidate `workout-data:meta` on refresh tap, per-phase progress bar
- `app/api/nutrition/scan/route.ts` — try-catch around `generateText` calls
- `projectOverview.md`, `lib/changelog.ts`, `package.json` — session notes + v1.20.1

**Version:** 1.20.0 → 1.20.1

---

### Session 68 — Nav Restructure + Friend System (2026-06-08) ✅ Complete

**What was built:**

A full navigation redesign and the first social feature set.

**Nav restructure:**
- Bottom nav: Home (`/`) / Nutrition (`/nutrition`) / Workout (`/workout`) / Health (`/health`) / More (`/more`)
- `/workout` now serves dual purpose: no `?session=` param → session picker (muscle heatmap + swipe); with param → active workout
- `/nutrition` is a standalone page with all meal logging, macro ring, and nutrition targets (extracted from Health)
- `/health` has 3 sub-tabs: Body (weight/BF/metrics), Training (stats hub + calendar), Progress (weight trend + goals)
- `/more` has 4 sub-tabs: Profile, Achievements, Friends, Config
- `/stats`, `/config`, `/profile` now redirect to their new locations

**Friend system:**
- DB migration `055_friends_and_titles.sql`: `friend_code` + `equipped_title` on users, `friendships`, `seasons`, `season_results` tables
- Every user gets a unique `TAI-XXXX` code generated at migration time (existing users) or first login (new users)
- Add friends by email or `TAI-XXXX` code; pending/accepted state management
- Activity feed: friends' PRs and workout completions, sorted by recency
- Leaderboard: weekly (Mon–Sun) and all-time, three metrics (sessions / volume / streak)
- Public profile page at `/profile/[userId]` — visible to friends and self

**Achievement tiers + cosmetics:**
- Badge tiers: Bronze (<50 XP warm border), Silver (50–199 XP grey), Gold (≥200 XP amber border + outer glow + "Gold" chip)
- Shimmer sweep animation on newly-unlocked badges (tracked in `ta_seen_achievements` localStorage)
- Trophy case: pin up to 3 badges to your profile showcase (`ta_trophy_case` localStorage)
- 16 equippable titles — earned by unlocking milestone achievements; title + Lucide icon shown next to your name
- Season badges: quarterly rank snapshots (Gold/Silver/Bronze)
- Weekly digest prompt now includes friend count context line

**DB migration:** `055_friends_and_titles.sql` — auto-applied by `ensureSchema` on cold start

**Bug fixes (post-deploy):**
- Profile nickname/display name disappeared after switching More sub-tabs. Root cause: `onUserSaved` in `more-content.tsx` called `setUser(updated)` but never wrote back to the module-level `_user` variable. When `router.refresh()` fires after a save, Next.js re-renders the component tree and `MoreContent` reinitialises its state from `_user` — which was still the old value — discarding the just-saved nickname. Fixed by updating `_user = updated` alongside `setUser(updated)` in the handler (`app/more/more-content.tsx`).
- Profile details (display name) missing on every fresh app load. Root cause 1: `app/more/page.tsx` only passed `equippedTitle` and `friendCode` from the JWT — `displayName` is a DB-only field, so `user` state started as `null` and showed "No name set" until the async `/api/user/profile` fetch resolved. Fixed by fetching the user from DB server-side in `page.tsx` and passing as `initialUser` prop (same pattern as `health/page.tsx`). Root cause 2: the fallback `useEffect` fetch was typed as `User | null` but the API returns `{ user, hasPassword, workoutCount }`, so `_user` was being set to the wrapper object with no `displayName` at the top level. Fixed by extracting `d.user` from the response.

**Known issues / deferred:**
- Log Activity button on Workout tab is a placeholder — activity_logs table and UI deferred to next session
- Push notifications deferred — no service worker infrastructure exists yet
- `ShareMilestoneCard` component deferred (no share target API or OS share sheet integration)

**Files changed:**
- `lib/data/postgres/migrations/055_friends_and_titles.sql` (new)
- `lib/data/postgres/schema.ts` — friendships, seasons, seasonResults tables; friendCode/equippedTitle on users
- `lib/types/friends.ts` (new) — Friendship, FeedEvent, LeaderboardEntry, PublicProfile, Season, TitleDef, TITLES constant
- `lib/types/user.ts` — friendCode, equippedTitle fields
- `lib/data/repository.ts` — friend + season + title methods
- `lib/data/postgres/adapter.ts` — generateUniqueFriendCode, upsertUser seeds code, all friend/season/title methods
- `types/next-auth.d.ts`, `auth.config.ts`, `auth.ts` — friendCode/equippedTitle in JWT + session
- `app/api/friends/route.ts`, `app/api/friends/[id]/route.ts`, `app/api/friends/feed/route.ts`, `app/api/friends/leaderboard/route.ts` (new)
- `app/api/profile/[userId]/route.ts`, `app/api/seasons/route.ts`, `app/api/user/equipped-title/route.ts` (new)
- `app/api/weekly-digest/route.ts` — friends context line
- `components/shell/bottom-nav.tsx` — 5-tab restructure
- `app/page.tsx` — renders session-select dashboard directly
- `app/workout/page.tsx` — dual-mode (select vs active)
- `app/nutrition/page.tsx` + `app/nutrition/nutrition-content.tsx` (new)
- `app/health/health-content.tsx` — 3-tab restructure (body/training/progress)
- `app/more/page.tsx` + `app/more/more-content.tsx` (new)
- `app/profile/[userId]/page.tsx` (new) — public profile page
- `app/profile/page.tsx`, `app/stats/page.tsx`, `app/config/page.tsx` — redirect to new locations
- `app/session-select/page.tsx` — redirect to `/workout`
- `components/more/` (8 new files) — profile-tab, achievements-tab, friends-tab, friend-feed, friend-leaderboard, manage-friends-sheet, trophy-case, title-picker-sheet
- `components/profile/achievements-grid.tsx` — tier badges, shimmer, seen tracking
- `app/globals.css` — shimmer-sweep keyframe, no-scrollbar utility
- `app/workout-select/workout-select-content.tsx` — Log Activity placeholder button
- `package.json` — 1.19.0 → 1.20.0
- `lib/changelog.ts` — 1.20.0 entry

**Version:** 1.19.0 → 1.20.0

---

### Session 66 — Baseline Phase / AMRAP Test Week (2026-06-08) ✅ Complete

**What was built:**

An optional "baseline" phase that can be prepended to any phase-based program. During the baseline cycle every exercise is performed as a single AMRAP set. The rep count is fed through a rep-band scale factor to produce a conservative 1RM estimate that seeds working weights for the rest of the program.

**Builder:**
- "Add baseline test week" toggle on the builder review screen (only visible for phase-based programs).
- When enabled, a dimmed preview row appears at the top of the Phase Progression list so the user can confirm before saving.
- On save, `POST /api/phase-sets/clone` is called with `includeBaseline: true`. The clone shifts all existing phase positions +1 and inserts a `phaseType: 'baseline'` phase at position 0 with `durationCycles: 1`.
- Cloned phase set uses a randomised name suffix (`${source.name} (custom-{8chars})`) to avoid collisions with the `UNIQUE(user_id, name)` constraint on `phase_sets`.
- Clone failures now show an explicit error toast and abort the save rather than silently using the original phase set.

**Active workout:**
- `workout-data` API sets `defaultSets: 1`, `progressionStyle: null`, and `styleName: null` for all exercises when the current phase is baseline — including accessory exercises (which previously kept their own `styleId` via `resolveStyleForExercise` returning `'own'`, causing a spurious "Style not found" warning).
- Pre-exercise ready screen shows "AMRAP Test" card (instructions + suggested weight at ~65% of last 1RM) instead of SET TARGETS. Warmup sets are suppressed.
- Set card badge shows "A" and the logged row reads "AMRAP · Logged".
- An AMRAP instruction banner appears above the set list during the active workout.

**1RM calculation:**
- `calcAmrap1RM` helper in `components/workout/utils.ts` (also tested in `lib/__tests__/utils.test.ts`): applies `calc1RM(weight, reps) × factor` where factor = 1.0 / 0.97 / 0.93 / 0.88 / 0.82 by rep band.
- `log-exercise` API detects baseline via `currentPhaseType === 'baseline'` and applies the same scale factor server-side. Result is stored as `estimated1rm` and used as the base for `target80`.
- PRs are recorded during baseline even if a deload flag is active (`!isAnyDeload || isBaseline`).

**DB migration:**
- Migration `053_baseline_phase_type.sql`: drops and re-adds the `program_phases_phase_type_check` CHECK constraint. The original constraint from migration 021 only allowed `('normal', 'peak', 'deload', 'accessory', 'testing')`. The new constraint adds `'baseline'`. The migration loops over `pg_constraint` to drop ALL check constraints on the `phase_type` column by name (covering both system-generated and named constraints) before re-adding the canonical one.

**Bugs found and fixed during this session:**

1. **DB CHECK constraint blocked 'baseline' inserts** — Root cause. The `phase_type` column had a CHECK constraint that didn't include 'baseline'. Every clone attempt failed with a PostgreSQL constraint violation, the API returned 500, and builder-review silently fell back to the original phase set. Fixed by migration 053.

2. **Duplicate phase set name on repeated saves** — `phase_sets` has `UNIQUE(user_id, name)`. Saving the builder twice produced `"Powerbuilding Progression (custom)"` twice and failed on the second attempt. Fixed by appending a random 8-char UUID suffix to clone names.

3. **"Style not found" warning on accessory exercises** — `resolveStyleForExercise` returns `'own'` for accessories when no accessory-type phase exists in the set (true for baseline). This kept `effectiveStyleId = ex.styleId` so `styleName` remained non-null. Combined with `progressionStyle: null` in baseline, this triggered the amber warning. Fixed by also setting `styleName: null` when `isBaselinePhase`.

4. **Clone API had no try-catch** — A DB error returned a raw 500 with no server-side logging. Added try-catch that logs the full error to `console.error` and returns the detail string in the response body, making future failures diagnosable without needing Railway logs.

**Known issues / potential future bugs:**

| # | Risk | Notes |
|---|------|-------|
| ~~B1~~ | ~~**Orphaned custom phase sets accumulate**~~ | ✅ Fixed (session 87) | `updateProgramPhaseSettings` now calls `deletePhaseSetIfOrphaned` on the program's previous `phaseSetId` whenever it changes — the old custom (`(custom-...)`) phase set is deleted if no program or logged session still references it. Default/built-in phase sets are never touched. |
| B2 | **Baseline 1RM seeded from AMRAP may be inaccurate for very low reps** | The scale factor is 1.0 for ≤5 reps (no discount). A user who chooses a near-maximal weight and grinds out 3 reps will get a 1RM estimate very close to their actual max — which may produce unrealistically heavy working weights in the next phase if the AMRAP was done with suboptimal form. Acceptable for now; a UI note warning users to pick a "challenging but clean" weight is the only mitigation without changing the formula. |
| B3 | **Phase engine has no concept of "baseline skipped"** | If a user logs zero sessions during the baseline cycle and then starts the next phase manually (e.g. via early deload or program editing), the phase engine still counts baseline as needing its `durationCycles` sessions before advancing. Since baseline is always 1 cycle, this resolves itself after 1 full training rotation, but the user will see "Baseline" for longer than expected if they don't actually do the AMRAP. |
| B4 | **Baseline is always exactly 1 cycle, not configurable** | The clone API hardcodes `durationCycles: 1` for the baseline phase. For users with a small `sessionsPerCycle` (e.g. 1 session per cycle), this means baseline is just 1 session — fine. For users with large `sessionsPerCycle` (e.g. 6), baseline is 6 AMRAP sessions — potentially too many. Not configurable in the current UI. |
| B5 | **`resolveStyleForExercise` returns 'own' for accessories in baseline** | This is currently handled by setting `styleName: null` in the API. If `resolveStyleForExercise` is ever changed to return the baseline phase's `primaryStyleId` (which is null) for accessories, accessory exercises would get `effectiveStyleId: null` instead of 'own', which would make the existing null-guard logic work naturally. Low risk as-is but worth keeping in mind if style resolution logic changes. |

**Files changed:**
- `lib/types/program.ts` — added `'baseline'` to `ProgramPhaseType`
- `components/workout/utils.ts` — added `calcAmrap1RM`
- `lib/__tests__/utils.test.ts` (new) — 8 Vitest tests for `calcAmrap1RM`
- `app/api/workout-data/route.ts` — `isBaseline` on `PhaseStatus`; `defaultSets`, `progressionStyle`, `styleName` all nulled in baseline
- `components/workout-screen.tsx` — passes `isBaseline` to `ActiveWorkoutScreen`
- `components/workout/active-workout-screen.tsx` — AMRAP Test ready screen, AMRAP banner, suppressed warmup
- `components/workout/set-card.tsx` — `isAmrap` prop; 'A' badge; "AMRAP · Logged" label
- `app/api/log-exercise/route.ts` — `currentPhaseType`; `amrapScaleFactor`; baseline 1RM branch; PR during baseline
- `app/api/phase-sets/clone/route.ts` — `includeBaseline` support; try-catch with logging; random name suffix
- `components/workout-builder/builder-review.tsx` — baseline toggle; preview row; explicit error on clone failure
- `lib/data/postgres/migrations/053_baseline_phase_type.sql` (new)
- `package.json` — 1.17.0 → 1.18.0
- `lib/changelog.ts` — 1.18.0 entry

**Version:** 1.17.0 → 1.18.0

---

### Session 65 — Home Customisation, Nutrition UX & Builder Cycle Length (2026-06-07) ✅ Complete

**Home screen:**
- Scroll lock fixed — `touchAction: 'none'` now only applies to the item actively being dragged, not all sections in edit mode. Scrolling works normally while in edit mode.
- Card widget colours — each card (Weight, Nutrition, Sleep, Steps, Mood) reads its background tint from `ta_card_colors` localStorage key (`Record<string, string>`), with defaults matching the previous hardcoded colours. Colour dot overlay in edit mode opens `<input type="color">` inline.
- Streak / This Week colour pickers — same colour-dot pattern added to Streak and This Week sections in edit mode, using `streakLeft` and `streakRight` keys in `ta_card_colors`.
- Card widget colour picker added to Profile → Card Widgets section (same pattern as Metric Tiles).
- `pointer-events-none` fix applied to card widget buttons in edit mode to prevent inner buttons from intercepting dnd-kit's 300ms drag activation delay.

**Known remaining home issues (not fixed this session):**
- Card widget drag (Weight/Nutrition/Sleep/Steps/Mood) still does not work — `pointer-events-none` fix was applied but insufficient. Tracked as H1. (Fixed in session 87 — see Past Changes.)
- Recommended Today section has no colour picker. Tracked as H2.

**Nutrition UX:**
- Saved Meals collapsible section added to the Health tab (above the macro ring). Fetches saved meals + meal types when expanded. Quick-log button loops over meal items and POSTs each to `/api/nutrition/food-logs`. Delete button with confirmation.
- Food logger sheet now has a tab bar (Recent | Saved Meals | Add Food) replacing the old step indicator when on the capture step. "Add Food" tab provides a manual entry form (name, calories, macros).
- Meal builder "Add new food" escape hatch — when a search query returns no results, a "+ Add '{query}' as new food" link appears. Clicking opens an inline form (name pre-filled, calorie + macro fields). Submits via `POST /api/nutrition/food-items`, then adds the new item as an ingredient immediately. Covers the gap where personal food library is empty and global DB search is not available.

**Workout Builder — Cycle Length & Phase Fixes:**
- Program Length wizard step added (step 9 of 10) — 6 preset buttons (8/10/12/14/16/20 weeks) + custom `−/+` stepper. Persisted as `totalWeeks` on `BuilderInputs`.
- `totalWeeks` stored to DB (`programs.total_weeks` — migration 052).
- Builder review: phase cycle counts now scaled proportionally to `inputs.totalWeeks` on initialisation (e.g. 11 DB cycles → scaled to 16 if user chose 16 weeks). Editable `−/value/+` controls per phase with live "Total: N cycles" counter.
- Phase-sets clone API (`POST /api/phase-sets/clone`) — when the user changes cycle counts on review, a user-owned copy of the phase set is created with the overridden `durationCycles` per phase position. The cloned set ID is used when saving the program.
- Linear mode: `generate-program` API now forces `phases: []` and `phaseSetId: ''` when `progressionMode === 'linear'`, preventing the linear program from receiving a default phase set's phases.
- "Linear Progression" removed from the Phase Structure picker (step 8) — that step is only shown for phase mode and the two remaining options are Baselining and Phase-Based Progression.

**Files changed:**
- `components/home-sortable-section.tsx` — touch-action fix
- `app/session-select/session-select-content.tsx` — card colours, colour dot overlays, streak pickers, pointer-events-none fix
- `app/profile/profile-content.tsx` — card colour pickers in Card Widgets section
- `components/nutrition/saved-meals-section.tsx` (new) — collapsible saved meals on Health tab
- `app/health/health-content.tsx` — SavedMealsSection added
- `components/nutrition/food-logger-sheet.tsx` — Recent / Saved Meals / Add Food tabs
- `components/nutrition/meal-builder-sheet.tsx` — Add new food escape hatch
- `lib/data/postgres/migrations/052_programs_total_weeks.sql` (new)
- `lib/data/postgres/schema.ts` — totalWeeks column
- `lib/types/builder.ts` — totalWeeks on BuilderInputs
- `lib/types/program.ts` — totalWeeks on Program
- `components/workout-builder/builder-wizard.tsx` — Program Length step, linear mode handling
- `components/workout-builder/builder-review.tsx` — scaled phaseCycles, editable controls, clone on save
- `app/api/generate-program/route.ts` — totalWeeks in prompt, linear forces empty phases
- `app/api/phase-sets/clone/route.ts` (new)
- `lib/data/postgres/adapter.ts` — totalWeeks in saveProgram

**Version:** 1.16.0 → 1.17.0

---

### Session 64 — Batch A UI Fixes (2026-06-07) ✅ Complete

**Home screen navigation:**
- Metric tiles (Steps, Sleep, etc.) now navigate to `/health?tab=body` (body tab) on tap, not the Nutrition default.
- A small **Log chip** button in the top-right of each tile opens the log sheet via `stopPropagation`; tapping the tile body navigates.
- Outer tile element changed from `<button>` to `<div role="button">` to fix invalid nested-button HTML (inner Log button was silently stripped by the browser).
- Streak and This Week cards now navigate to `/stats` on tap.
- Mood empty-state icon changed from `🫀` to `MessageCircle` (Lucide).

**Profile cleanup:**
- "Daily Goals" renamed to "Goals"; subtitle updated.
- Duplicate "View all {n} achievements →" button removed (achievements expandable section already exists).
- Scroll container given `env(safe-area-inset-bottom)` padding so content doesn't clip behind the gesture nav bar.

**Config screen:**
- Phase Sets and Progression Sets sections removed from their standalone positions.
- **Advanced Settings** accordion added inside the Workouts section (below the programs list), collapsed by default, containing both Progression Sets and Phase Sets with full functionality.

**Body screen — new tiles:**
- Distance tile (3-col grid alongside Steps + Sleep).
- Calories Burned tile (from cardio sessions today, via `listCardioSessions`).
- BMI tile — calculated from weight + height; label uses body fat % thresholds when BF% data is available (more accurate for muscular builds). Toggleable ⓘ info button explains calculation.
- Weight Trend tile — linear regression slope (kg/week) across recent weight readings. Toggleable ⓘ.
- Energy Balance tile — calories eaten minus TDEE estimate (Mifflin-St Jeor BMR × 1.4). Toggleable ⓘ.
- Lean Mass tile — weight × (1 − BF%). Toggleable ⓘ.
- Biometrics section: always rendered, shows "No data" instead of collapsing.
- Training Load: always rendered, shows "Not enough data yet" when ACWR is 0.

**Body screen — Log buttons:**
- Log button added to Body Fat tile (opens inline number input, saves via body-metadata POST).
- Log button added to Steps tile.
- Both required restructuring from full-card `<button>` to `<div>` with nested buttons (nested-button HTML fix).

**BMI label — BF% override:**
- When body fat % is available, `bmiLabel` uses sex-specific thresholds (Athletic/Fitness/Average/High fat) instead of the standard weight-only categories (Overweight/Obese).
- Thresholds: Male < 6% Essential, 6–13% Athletic, 14–17% Fitness, 18–24% Average, ≥25% High fat. Female: < 14% / 14–20% / 21–24% / 25–31% / ≥32%.
- Shows "via body fat %" sub-label below the BMI value when override is active.

**Sex field on user profile:**
- Migration `050_users_sex.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS sex text`.
- Drizzle schema, User type, NextAuth JWT/Session types all updated.
- `rowToUser` in `adapter.ts` now maps `sex` (was silently dropped, causing profile saves to appear not to persist).
- Edit Profile sheet: 3-button toggle (Male / Female / Other); DOB field changed to **Birth Year** only (4-digit number, stored as `YYYY-01-01`) to minimise PII.
- Health page: switched from stale JWT to fresh DB fetch (`repo.getUserByEmail`) so BMI/energy balance calculates immediately after profile save.

**Bug fixes shipped during this session:**
- App crash on load: `useSession` called outside `SessionProvider` (which doesn't exist in this app). Fixed by replacing with props pattern — server page passes sex/height/DOB as explicit props.
- ESLint build failure: `as any` cast on `session.user` in `page.tsx`. Removed since Session types already declare the fields.
- Sex not saving: `rowToUser` was missing `sex: r.sex`. Fixed.
- BMI/energy balance not calculating: stale JWT after profile save. Fixed by fresh DB read in server page.
- Advanced Settings position: was placed as a sibling section after Workouts; moved inside the Workouts `workoutsOpen` block.

**Files changed:**
- `lib/data/postgres/migrations/050_users_sex.sql` (new)
- `lib/data/postgres/schema.ts`
- `lib/types/user.ts`
- `types/next-auth.d.ts`
- `auth.config.ts`, `auth.ts`
- `lib/data/repository.ts`
- `lib/data/postgres/adapter.ts`
- `app/api/user/profile/route.ts`
- `app/api/body-metadata/route.ts`
- `components/profile/edit-profile-sheet.tsx`
- `app/health/page.tsx`
- `app/health/health-content.tsx`
- `app/session-select/session-select-content.tsx`
- `app/profile/profile-content.tsx`
- `components/config-screen.tsx`

**Version:** 1.15.0 → 1.16.0

---

### Session 63 — APK Batch, Full App Review & Bug Fixes (2026-06-07) ✅ Complete

**Features / APK improvements (rebuild required):**
- **Long-press drag without edit button** — `MainActivity.java`: `setOnLongClickListener(v -> true)` suppresses Android WebView's long-press context menu, which was sending `pointercancel` before dnd-kit's 300ms delay could fire. Sensor switched back from `Distance(12px)` to `Delay(300ms, tolerance:8)`.
- **Screen keep-awake during workout** — `ScreenBridge` JavascriptInterface added to `MainActivity.java` (`window.AndroidScreen.setKeepAwake(bool)`). Activated when workout mode is `active` or `exercise-summary`, released on done/pre/unmount. No Capacitor plugin needed.
- **PiP pre-workout screen guard** — Java guard changed from blacklist (`!= "done"`) to whitelist (`rest | set | complete | summary`) so PiP doesn't open when user is on the pre-workout screen.
- **VIBRATE permission** — Added to `AndroidManifest.xml`; was silently suppressing haptic feedback on some devices.
- **versionCode** — Bumped `1 → 2`, `versionName "1.0" → "1.15.0"` in `build.gradle`.

**UI fixes:**
- Goal spectrum Powerbuilding range corrected from `75–90%` to `80–90%` (matches actual Accumulation start of 80%).
- "This Week" counter denominator now computed from program schedule (`weekly` day count or `rotation` restAfterN) instead of hardcoded 5.
- Builder phase review shows amber `"style missing"` text when `primaryStyleName` is null, rather than silently displaying only the cycle count.

**Security:**
- Food item search LIKE query now escapes `%` and `_` wildcards (was allowing wildcard injection).
- `completeWorkoutSession` now filters by both `workoutSessionId` AND `userId` — previously any authenticated user could complete another user's workout session by guessing a UUID.

**Timezone:**
- `app/api/ai-chat/route.ts` — 14-day body metrics window used `.toISOString().slice(0,10)` (UTC), returning the wrong date before 10am AEST. Fixed with `formatInTimeZone(from14d, tz, 'yyyy-MM-dd')`.
- `app/api/sleep-performance-correlation/route.ts` — same fix for the 90-day sleep window.

**Caching — missing invalidations fixed:**
- Body metric save (`handleSaveLog`) now calls `invalidateCache('body-metadata')` before re-fetching.
- Food log save (`food-logger-sheet.tsx`) invalidates `nutrition-food-logs-` and `nutrition-weekly-summary` before calling `onLogged()`.
- Nutrition targets save invalidates `nutrition-targets`.
- Sign-out now calls `invalidateCache('')` (clears all device cache) before redirecting.

**Caching — new entries:**
- Mood log cached as `mood:{date}` with `TTL_SHORT`.
- Readiness score cached as `readiness-score` with `TTL_SHORT`.
- History day-log overlay cached as `day-log:{date}` with `TTL_MEDIUM` — tapping the same day twice in a session skips the DB round-trip.

**Other:**
- `katex` added as an explicit dependency (was a transitive peer dep of `rehype-katex`; caused build failures on fresh local installs).

---

### Session 62 — Three Bug Fixes (2026-06-06) ✅ Complete

---

#### Bug 1: Health Connect steps/distance/calories aggregating across day boundaries

**Symptom:** On a fresh cold sync (30 days), two AEST days' worth of steps were summed into a single day (yesterday 12k + today 20k = 32k shown as today).

**Root cause** (`lib/health-connect-sync.ts`): The Capacitor Health Connect plugin iterates fixed 24-hour windows from `startInstant`. Since `startInstant = new Date() - N * 86400000` is the current moment minus N days (never a local midnight), every window straddles two AEST calendar days. Both days' data lands in a single bucket, keyed to whichever local date the window's start falls on.

**How to diagnose this class of bug in future:** If aggregated data is combining values from two adjacent local days, check whether the query window start/end is aligned to local midnight. Print `startIso`/`endIso` and compare against local midnight — if they differ by anything other than a whole number of hours equal to the UTC offset, the windows are misaligned.

**Fix:**
```typescript
const todayStr     = toLocalDate(new Date().toISOString());
const [ty, tm, td] = todayStr.split('-').map(Number);
const start        = new Date(ty, tm - 1, td - (daysBack - 1), 0, 0, 0); // local midnight
const end          = new Date(ty, tm - 1, td + 1, 0, 0, 0);               // tomorrow midnight
```
`new Date(y, m-1, d, 0, 0, 0)` uses the JS runtime's own timezone (device-local), so the windows start and end at local midnight without any manual UTC offset arithmetic. Fixes steps, distance, and calories — all three share the same window.

**Deployment:** Railway deploy only (runs in WebView JS bundle). Confirmed working on partner's phone.

---

#### Bug 2: Builder phase progression showing "N cycles" without sets/reps (Hypertrophy Intensification)

**Symptom:** In the AI builder review screen, the Intensification phase of "Hypertrophy Progression" showed "3 cycles" with no style detail (e.g. "4 × 10 @ 65%").

**Root cause** (`lib/data/postgres/migrations/042_goal_phase_sets.sql`): Migration 042 resolves style IDs at run time via `SELECT id INTO hypertrophy_id FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy'`. If that style didn't exist yet when the migration ran (e.g. the migration ran before the user's first login, which is what seeds default styles), `hypertrophy_id = NULL` and `program_phases.primary_style_id` is stored as NULL. The `listPhaseSets` LEFT JOIN then finds nothing for that phase, returning `primaryStyleName = null`, so the builder displays no style detail.

**How to diagnose this class of bug in future:** When a builder/config screen shows a phase name and cycle count but no sets/reps, the phase's `primary_style_id` is almost certainly NULL in the DB. The LEFT JOIN in `listPhaseSets` (`adapter.ts`) produces `primaryStyleName = null` when `primary_style_id` doesn't match any row in `progression_styles`. Check the DB: `SELECT name, primary_style_id FROM program_phases WHERE phase_set_id = '...'` — any NULL `primary_style_id` is the culprit. Also check that the referenced style name actually exists in `progression_styles` for that user.

**Fix** (`lib/data/postgres/migrations/047_fix_goal_phase_set_styles.sql`): New migration that unconditionally re-resolves and UPDATEs every phase → style link for all four goal phase sets (Hypertrophy, S+H, Powerbuilding, Strength Progression) for every user. Safe to run repeatedly. Covers all phases in all four sets so any past or future NULL from a migration timing race is corrected.

**Pattern to follow for future phase set migrations:** Never rely on style IDs being present at migration time. Either (a) create the style in the same migration before referencing it, or (b) write a separate fix migration that does an unconditional UPDATE after confirming the style exists.

**Deployment:** Railway deploy only. Migration auto-runs on cold start (migrations are auto-discovered by `ensureSchema` via `readdirSync`).

---

#### Bug 3: "~Xw left" showing whole-block remaining instead of current phase remaining

**Symptom:** Home screen card showed "Accumulation · Cycle 1/4 ~7w left" for a 3-session/week plan. User expected ~4w (4 cycles × 1 week/cycle). The 7w figure was actually the time remaining for the entire block (Accumulation + Intensification + Peak + Testing + Deload).

**Root cause** (`lib/phase-engine.ts`): `approxWeeksRemaining` was computing `Math.ceil((totalProgramCycles - completedCycles) * sessionsPerCycle / avgPerWeek)` — i.e., weeks for ALL remaining program cycles, not just the current phase. Displayed next to the phase name ("Accumulation"), users naturally read it as "time left in Accumulation" rather than "time left in the whole block".

**How to diagnose this class of bug in future:** If "~Xw left" seems disproportionately large compared to the displayed cycle count, check whether `approxWeeksRemaining` is using `cyclesRemaining` (whole block) or a phase-local cycle count. Trace through `getCurrentPhase` in `lib/phase-engine.ts` and log `cyclesRemaining` vs `totalPhaseCycles - cycleInPhase + 1`.

**Fix** (`lib/phase-engine.ts`):
```typescript
// Before (whole block):
return Math.ceil((cyclesRemaining * sessionsPerCycle) / avgSessionsPerWeek)

// After (current phase only):
const phaseCyclesLeft = phase.durationCycles - cycleInPhase + 1
return Math.ceil((phaseCyclesLeft * sessionsPerCycle) / avgSessionsPerWeek)
```
Now "Accumulation · Cycle 1/4 ~4w left" — the weeks figure matches the remaining cycles in the current phase. The progress bar underneath still tracks the whole block so both views are preserved.

**Deployment:** Railway deploy only. Tests updated and passing (21/21).

---

### Session 61 — PiP Timer Ring & Button Polish (2026-06-06) ✅ Complete

**What changed:**

- **`components/workout/pip-view.tsx`** (new) — Self-contained circular ring timer for PiP mode. Replaces the previous plain `MM:SS` text-only view. Uses a 1s `setInterval` tick to drive live updates. SVG ring arc behaviour:
  - **Rest phase**: arc fills from 0 → 100% as rest progresses toward target, with `/ MM:SS` target shown below the time. Turns red and shows `+Ns over` when elapsed exceeds target. Same over-time colour logic as the full app.
  - **Set phase**: arc grows up to a 3-min visual cap and pulses (matching the `border-run` animation style). Weight × reps shown below the ring.
  - Centre always shows the live elapsed time in the same red/white logic as before.

- **`components/workout-screen.tsx`** — Replaced the 40-line inline PiP text block with `<PipView>`, passing `lapStartMs`, `restStartMs`, `currentRestSec`, and current set metadata from the store.

- **`android/app/src/main/java/com/trainingai/app/MainActivity.java`**:
  - **Java compile fix**: `onStart()` and `onStop()` were declared `protected` but `BridgeActivity` (which extends `AppCompatActivity`) declares them `public`. Java disallows weakening access on override → changed both to `public`.
  - **5-button test**: Restored all 5 set-phase actions (W−, R−, LOG, R+, W+) to verify Android 13+ behaviour on S25 Ultra. **Result: only 3 visible** — Samsung One UI enforces a 3-action limit in PiP regardless of Android version.
  - **Final button layout** (set phase): `Reps −` (pip_minus), `Reps +` (pip_plus), `Log` (pip_log) in that order. Label strings `"Reps -"` / `"Reps +"` are passed as the `RemoteAction` title but **do not appear visually** on Samsung's PiP overlay — One UI renders icons only, titles are silently ignored.

**Deployment:** JS changes (`pip-view.tsx`, `workout-screen.tsx`) deploy via Railway — no APK rebuild needed for those. Java changes (`MainActivity.java`) require a full APK rebuild and reinstall.

**Version:** 1.13.0 → 1.13.1

---

**Known limitations / future issues with PiP:**

| Issue | Detail |
|-------|--------|
| **Button labels invisible** | Samsung One UI's PiP overlay does not render `RemoteAction` title text — icons only. "Reps -" / "Reps +" strings are set but never shown. No workaround without Samsung changing One UI behaviour. |
| **3-button hard cap** | Confirmed on S25 Ultra: only 3 PiP actions are visible regardless of how many are registered. Weight adjustment (W−/W+) is therefore unavailable in PiP — user must exit PiP to change weight. |
| **No reps adjustment visible** | With 3 buttons showing Reps −, Reps +, Log — there is no label telling the user what the buttons do. Users have to learn by feel. Could potentially be addressed with better icon assets (e.g. icons that incorporate a digit). |
| **PiP SVG on Samsung WebView** | The PiP view is still a WebView (Android shrinks it into the PiP window). The ring SVG uses simple `strokeDasharray` on a solid black background with no sibling `rgba()` gradients, so the Samsung compositor bug (session 55) should not apply — but worth checking if ring rendering breaks after a WebView update. |
| **Weight adjustment unavailable in PiP** | Weight is pre-populated from the program. If the user needs to deviate mid-set they must exit PiP, adjust, and press Home again to re-enter PiP. |

---

### Session 60 — In-App APK Download Link (2026-06-06) ✅ Complete

**What changed:**

- **`app/api/download-apk/route.ts`** (new) — Auth-gated GET route. Returns 401 if not logged in. Calls `https://api.github.com/repos/nekodas-neko/TrainingAI/releases/latest`, finds the `.apk` asset, and returns a 302 redirect to `browser_download_url`. Response cached for 5 minutes via Next.js `next: { revalidate: 300 }`. No GitHub token required (public repo). Returns 502 if GitHub is unreachable; 404 if no APK exists in the latest release.

- **Profile page** (`app/profile/profile-content.tsx`) — Added "Download Android App" row inside the About card, between the version header and the changelog. Download icon (Lucide `Download`) + "Latest APK from GitHub releases" sub-label. Tapping opens `/api/download-apk` which redirects to the file.

- **Home screen banner** (`app/session-select/session-select-content.tsx`) — Dismissible card above the sortable sections (below the readiness/deload cards). Brand-accented border, Download icon, "Download Android App" + "Get the latest APK". Dismiss button (×) writes `apk-banner-dismissed` to `localStorage` so it never shows again. State initialises to `true` (hidden) and is un-hidden by `useLayoutEffect` after reading localStorage — no flash for users who've already dismissed it.

**How the link stays up to date:** The GitHub API always returns the latest published release, so no code changes are needed when a new APK is built and published.

**Deployment:** Merged to `main`, deployed to Railway.

**Version:** 1.12.0 → 1.13.0

---

### Session 59 — Goal-Specific Phase Progressions & Builder Fixes (2026-06-06) ✅ Complete

**What changed:**

- **4 training goals in the AI builder** (`components/workout-builder/builder-wizard.tsx`): Added Powerbuilding goal and rewrote the goal step to show 4 options (Hypertrophy, Strength + Hypertrophy, Powerbuilding, Strength) with plain-English descriptions. Removed the manual phase structure picker step — the phase set is now auto-selected based on goal.

- **Goal-specific phase sets** (`lib/data/postgres/migrations/042_goal_phase_sets.sql`, `lib/data/postgres/adapter.ts`): 4 new progression styles (Hypertrophy Plus 4×8@70%, Heavy Strength 5×5@85%, Strength Plus 4×3@87%, Max Strength 3×3@92%) and 4 new goal-aligned phase sets created for all users:
  - *Hypertrophy Progression*: Accumulation (General 4-set) → Intensification (Hypertrophy) → Peak (Hypertrophy Plus)
  - *S+H Progression*: Accumulation (Hypertrophy) → Intensification (Hypertrophy Plus) → Peak (Strength 4-set)
  - *Powerbuilding Progression*: Accumulation (Powerbuilding) → Intensification (Heavy Strength) → Peak (Peak)
  - *Strength Progression*: Accumulation (Strength) → Intensification (Strength Plus) → Peak (Max Strength)

- **`GOAL_STYLE_RULES` + `GOAL_PHASE_SET_MAP`** (`app/api/generate-program/route.ts`): Server-side enforcement maps each goal to the correct per-role accumulation styles, and to the matching phase set name. AI style choices are always overridden for primary/secondary compounds.

- **Phase progression timeline in builder review** (`lib/types/builder.ts`, `app/api/generate-program/route.ts`, `components/workout-builder/builder-review.tsx`): Added `GeneratedPhase` type and `phases` array to `GeneratedProgram`. The generate-program route resolves phase style names via `listPhaseSets` JOIN and populates the array. Builder review now shows a "Phase Progression" block above sessions (e.g. "Accumulation · 4 cycles · 4 × 6 @ 80%", "Testing · 1 cycle · Test day"). Accessory phase filtered out. `phaseStyleShort()` helper strips rest time from display strings.

- **Back-navigation clears stale program** (`components/workout-builder/builder-wizard.tsx`): `onBack` from review now calls `setProgram(null)` so going back to step 6 and changing the goal triggers a fresh generation rather than re-showing the old review.

**Bugs encountered and how they were fixed:**

1. **Migration 042 silent failure** — `INSERT INTO progression_styles` included a `created_at` column that no longer exists on the table. The entire PL/pgSQL DO block rolled back silently. Fixed by removing `created_at` from the four new-style inserts.

2. **Accumulation phase showing "4 cycles" with no style info (Powerbuilding)** — Root cause: the 'Powerbuilding' progression style did not exist for the user. Migration 038 (which should have created it) also used `created_at` in its INSERT, so it failed silently for users whose account predated that column's removal. All subsequent fix-attempt migrations (043–045) tried to JOIN against `progression_styles WHERE name = 'Powerbuilding'` and found zero rows, matching nothing. Diagnosed via a temporary `/api/debug-phases` endpoint that revealed `primary_style_id: null` for the Accumulation phase and confirmed 'Powerbuilding' was missing from `relevantStyles`. Fixed by migration 046 which creates the 'Powerbuilding' style directly (no `created_at`) then updates the Accumulation phase in a single DO block.

3. **`styleById` UUID lookup returning undefined** — Even after migration fixes, the phase style name lookup in `generate-program` used `styleById.get(p.primaryStyleId)` which fails if the stored UUID doesn't match any key. Fixed by modifying `listPhaseSets` to do a `LEFT JOIN progression_styles` and return `primaryStyleName` directly in the phase data, bypassing the UUID reverse-map entirely (`lib/data/postgres/adapter.ts`, `lib/types/program.ts`).

**Files changed:**
- `lib/data/postgres/migrations/042_goal_phase_sets.sql` — fixed `created_at` bug
- `lib/data/postgres/migrations/043–046_*.sql` — progressive fixes for Accumulation phase style
- `lib/data/postgres/adapter.ts` — new styles + phase sets in `upsertUser`; `listPhaseSets` now JOINs style names
- `lib/types/program.ts` — `primaryStyleName` added to `ProgramPhase`; `GeneratedPhase` type added
- `lib/types/builder.ts` — `GeneratedPhase` interface; `phases` on `GeneratedProgram`; 4-goal union
- `app/api/generate-program/route.ts` — `GOAL_STYLE_RULES`, `GOAL_PHASE_SET_MAP`, `styleById`, `phases` in response
- `components/workout-builder/builder-wizard.tsx` — 4 goals, removed phase picker step, back clears program
- `components/workout-builder/builder-review.tsx` — phase progression block, new `STYLE_DISPLAY` entries, `phaseStyleShort()`

**Version:** 1.11.0 → 1.12.0

---

### Session 56/57 — Finishing Touches (2026-06-05) ✅ Complete

**What changed:**

- **Builder volume priority** (`app/api/generate-program/route.ts`): Rewrote rules 7–13 in the AI prompt. Large muscles (chest, back, quads, hamstrings, glutes) must now reach their full weekly set target (15–20 for hypertrophy, 20–25 for strength) before any direct small-muscle (shoulder/arm/calf/core) isolation work is added. If the time budget runs out, isolation exercises are cut first.

- **Clean session names** (`app/api/generate-program/route.ts`, `lib/utils.ts`): Added rule 10 to the builder prompt enforcing short standard names: Push, Pull, Legs, Upper Push, Upper Pull, Lower Squat, Lower Hinge, Full Body, Full Body A/B — no parenthetical muscle annotations in any form. `shortSessionName()` updated to also hard-cap at 14 characters as a safety net.

- **Individual card widget drag** (`app/session-select/session-select-content.tsx`): Replaced the single `"cardWidgets"` draggable block with five individual `card_*` section keys (`card_weightSparkline`, `card_nutritionDonut`, `card_sleepWidget`, `card_stepsWidget`, `card_moodWidget`). Each enabled widget is now its own draggable item in the home feed. A sync `useEffect` keeps the section order consistent when widgets are toggled on/off in Profile. Stored order is migrated from the old `"cardWidgets"` key automatically.

- **Nutrition custom save name** (`components/nutrition/review-step.tsx`): When "Save to my food library" is toggled on in the Review step, a text input appears pre-filled with the detected food name, allowing the user to rename it before saving.

- **Lucide icons replacing emoji** (`app/session-select/session-select-content.tsx`, `app/profile/profile-content.tsx`): Sleep widget corner icon (🌙 → Moon), Steps widget (👣 → Footprints), Mood widget (💭 → MessageCircle). Profile `WIDGET_DEFS` and `CARD_WIDGET_DEFS` updated from emoji strings to Lucide icon components (Scale, Footprints, Flame, Route, Beef, Wheat, Droplets, TrendingUp, Apple, Moon, MessageCircle).

- **Free-hue colour picker** (`components/theme-color-picker.tsx`, `lib/brand-themes.ts`): Added a rainbow hue slider (0–360°) above the preset swatches. Dragging the slider calls `applyCustomHue(hue)` which derives `oklch(0.7 0.2 {hue})` and uses an inline OKLCH→sRGB conversion to compute `rgba` values for the card bg/border/glow CSS variables. Custom hue is persisted to `ta_brand_hue` in localStorage. Selecting a preset swatch clears the custom hue and vice versa.

- **Samsung WebView compositor bug fix — Lucide icon SVGs** (`app/session-select/session-select-content.tsx`): Adding Lucide icons to the Sleep/Steps/Mood card widget headers triggered the same compositor bug seen in session 55 — the Steps widget's `<Footprints>` SVG caused adjacent card backgrounds to disappear on Samsung WebView. Fix: added `willChange: 'transform'` to the `accentCardStyle` helper so every card button is always promoted to its own GPU compositor layer. Each card renders independently, preventing any one card's SVG from affecting siblings' `linear-gradient`/`rgba()` backgrounds. Confirmed working on S25 Ultra. See "Samsung WebView Compositor Bug" section above for full pattern documentation.

**Deployment:** All changes merged to `main`, deployed to Railway.

**Version:** 1.10.1 → 1.11.0

---

### Session 58 — Section order persistence fix (2026-06-05) ✅ Complete

**Problem:** Home screen section drag order reset to default whenever the user navigated away and came back.

**Root cause:** Two async patterns were tried and both failed:
1. `localStorage.setItem` inside `setSectionOrder(prev => { ... })` — React (concurrent mode) can discard queued functional updates for components that unmount before the next render flush.
2. A `useEffect([sectionOrder])` — fires asynchronously after paint; if navigation happens before the next paint, the component unmounts and the effect is skipped entirely.

**Fix** (`app/session-select/session-select-content.tsx`):
- Added `sectionOrderRef = useRef<SectionKey[]>(...)` mirrored by a `useLayoutEffect(() => { sectionOrderRef.current = sectionOrder; })` with no dependencies — this fires synchronously before every paint, keeping the ref always fresh without any async gap.
- Rewrote `handleSectionDragEnd` to read `sectionOrderRef.current`, compute the reordered array, call `localStorage.setItem(...)` directly (synchronous), then `setSectionOrder(next)`.
- Rewrote the card-widget sync `useEffect` the same way — reads the ref, computes the new order, saves directly to localStorage, then calls `setSectionOrder(next)`.
- Removed the `sectionOrderLoadedRef` guard and the `useEffect([sectionOrder])` persistence effect entirely.

**Result:** Order is written to localStorage in the same synchronous call as the drag, so it can never be skipped regardless of when navigation occurs.

---

### Session 55 — APK Tinted Card Background Fix (2026-06-05)

**Problem:** On the Samsung Galaxy S25 Ultra Capacitor APK, the gradient-tinted card backgrounds on the home screen (streak card, this week card, nutrition widget) were visible for ~1 second after the page loaded, then disappeared entirely. The Chrome PWA was unaffected.

**Root cause (progressively narrowed):**

The nutrition widget contained an SVG donut chart using `<circle>` elements with `strokeDasharray` + `strokeDashoffset`. On Samsung's Android system WebView (not Chrome), this SVG pattern triggers GPU compositor layer creation. That compositor layer interfered with the rendering of earlier DOM sibling elements, causing their `linear-gradient(rgba(...))` backgrounds to fail to composite correctly — they appeared transparent.

This was confirmed by the user disabling each widget in turn: the tinted backgrounds returned as soon as the nutrition widget was turned off.

**Fixes applied (in order of investigation):**

1. **FOUC (dark class flash)** — `app/layout.tsx`: Extended the inline blocking script to apply `document.documentElement.classList.add('dark')` synchronously before React hydration. Previously the dark class was only applied by `next-themes` after hydration, causing a brief light-mode flash on every load.

2. **Service worker cache flush** — `public/sw.js`: Bumped cache name from `ta-v4` to `ta-v5` so Android WebView's cache-first static asset strategy picks up all JS/CSS changes immediately rather than serving stale bundles.

3. **Meteors component unscoped CSS** — `components/ui/meteors.tsx` + `app/globals.css`: The component used `<style jsx>` in the Next.js App Router without `styled-jsx` installed. This rendered as an unscoped global `<style>` tag containing `div > div { animation: meteor linear infinite }` — a rule that would apply to any `div > div` on the page, potentially triggering unexpected GPU layers. Fixed by removing the `<style jsx>` block and adding a `.meteor-particle` class to each meteor `<div>`, with the keyframe defined in `globals.css` scoped to `.meteor-particle`.

4. **`rgba()` notation** — `app/session-select/session-select-content.tsx` + `app/health/health-content.tsx`: The `accentCardStyle` function was using 8-digit hex alpha notation (`${color}4d`) for backgrounds. Converted to `rgba(r,g,b,0.3)` for maximum Android WebView compatibility.

5. **SVG `transform` attribute removal** — Removed `transform="rotate(-90 29 29)"` from the nutrition donut SVG and replaced with `strokeDashoffset` math. Confirmed by user this did not fix the issue.

6. **CSS conic-gradient replacement (the fix)** — `app/session-select/session-select-content.tsx`: Replaced the entire nutrition SVG donut chart with a pure-CSS approach:
   - A `<div>` with `background: conic-gradient(from -90deg, ...)` draws the coloured ring
   - `mask: radial-gradient(farthest-side, transparent 60%, black 61%)` punches the donut hole
   - Text overlay is a plain flexbox `<div>`
   - **No SVG, no `strokeDasharray`, no `strokeDashoffset`** — eliminates the compositor trigger entirely
   - Confirmed working by user: tinted backgrounds now persist correctly in the APK

**Files changed:**
- `app/layout.tsx` — FOUC dark-class fix
- `public/sw.js` — cache version bump (`ta-v4` → `ta-v5`)
- `components/ui/meteors.tsx` — removed `<style jsx>`, added `.meteor-particle` class
- `app/globals.css` — added `@keyframes meteor` + `.meteor-particle` class
- `app/session-select/session-select-content.tsx` — `rgba()` notation + CSS conic-gradient nutrition donut
- `app/health/health-content.tsx` — `rgba()` notation for card backgrounds
- `package.json` — version bump 1.10.0 → 1.10.1
- `lib/changelog.ts` — patch entry added

**Key finding for future work:** Any SVG element using `strokeDasharray`/`strokeDashoffset` (or likely other animated SVG properties) inside a home screen widget will trigger this Samsung WebView compositor bug and break `rgba()` gradient backgrounds on sibling cards. See the "Samsung WebView Compositor Bug" section above for the fix pattern.

**Deployment:** All changes committed and pushed to `main` — live on Railway.

**Version:** 1.10.0 → 1.10.1

---

### Session 54 — Builder Progression Styles & Bug Fixes (2026-06-05)

**What changed:**

**New progression styles (migrations 037–040):**

- **Migration 037** — Idempotent DO block seeds 4 new style variants for all users: `Hypertrophy 3-set` (3×10 @ 65% · 60s), `Strength 3-set` (3×5 @ 80% · 120s), `Peak 4-set` (4×3 @ 90% · 180s), `General 4-set` (4×12 @ 60% · 60s).
- **Migration 038** — Seeds `Powerbuilding` style (4×6 @ 80% · 120s) for all users.
- **Migration 039** — Updates `Strength` from 4×5 to 5×5 (adds 5th set); updates `Powerbuilding` from 4×8 @ 75% · 90s to 4×6 @ 80% · 120s.
- **Migration 040** — Seeds `Strength 4-set` (4×5 @ 80% · 120s) for all users.
- `lib/data/postgres/adapter.ts` — `defaultStyles` array updated to match all new/updated styles. Rest times are now percentage-driven: 60% → 60s, 80% → 120s, 90% → 180s.

**Builder AI prompt improvements (`app/api/generate-program/route.ts`):**

- `KNOWN_STYLES` constant with accurate time-per-exercise formula: `(sum of reps×4s + restSec per set) + 90s overhead`
- Per-goal style selection rules:
  - `hypertrophy`: primaries → Hypertrophy (4×10), secondaries → Hypertrophy 3-set
  - `strength`: primaries → Strength (5×5), secondaries → Strength 4-set (fallback: Strength 3-set on time constraint)
  - `strength+hypertrophy`: primaries → Powerbuilding (4×6 @ 80%), secondaries → Hypertrophy 3-set
- Time budget baseline corrected: `strength+hypertrophy` now uses Powerbuilding style (~11 min/exercise) instead of Hypertrophy (~8 min/exercise) — was allowing 35% too many exercises per session.
- Guard: returns 400 if `filteredExercises` is empty (prevents AI hallucinating exercise names for unsupported equipment).

**1RM default logic fix (`app/api/log-exercise/route.ts`):**

- Equal reps across sets → all sets count for 1RM estimation.
- Varied reps → only min-rep sets count (closest to maximal effort). Explicit `progressionStyle[i].useFor1rm` always overrides.

**4 P1 builder bugs fixed:**

- **`app/api/builder-chat/route.ts`**: Fetches `userStyles` in parallel with exercises; injects full style menu + per-goal rules into system prompt; maps `progressionStyleName → progressionStyleId` server-side on response; wraps `JSON.parse` in inner try/catch for clean error handling.
- **`components/workout-builder/builder-review.tsx`**: `swapExercise()` now copies `progressionStyleName` and `progressionStyleId` onto the replacement exercise.

**`STYLE_DISPLAY` in builder-review** updated for all 9 styles (shows set/rep/% · rest under each exercise in the review screen).

**Deployment:**
- All changes on `main`, deployed to Railway.

**Version:** 1.9.0 → 1.10.0

---

### Session 53 — Gamification, Hardening & Performance (2026-06-04)

**What changed:**

**Phase 1 — Critical fixes:**

- **Safe-area footer padding** (`components/workout/active-workout-screen.tsx`): Footer `pb` increased from `0.75rem` to `1.25rem` minimum so the Log button clears the gesture nav bar on S25 Ultra.

- **WeightDial overflow** (`components/workout/set-card.tsx`): `visible={3}` → `visible={2}` — the dial was 144px tall; the set card interior is ~100px. Was clipping on the S25 Ultra.

- **Zod input validation on `/api/log-exercise`** (`app/api/log-exercise/route.ts`): Added `LogExerciseSchema` using Zod — bounds-checks all numeric fields (weights 0–500 kg, reps 0–100, sets 1–20, arrays max 20 items, strings max 200 chars). Replaces the old manual presence-check with a typed `safeParse`.

- **Admin JWT DB re-check** (`lib/admin.ts`): Removed the `isAdmin` JWT short-circuit in `requireAdmin`. Now always DB-checks — prevents a deactivated admin from retaining admin access until their JWT expires.

- **Redundant `auth()` removed** (`app/api/body-metadata/route.ts`): A second `auth()` call inside the POST handler was redundant (session was already resolved at the top of the route). Removed.

**Phase 2 — Gamification:**

- **XP earned card on Done screen** (`components/workout/done-screen.tsx`, `components/workout-screen.tsx`, `app/globals.css`): After completing a workout, the done screen shows an animated `+{n} XP` card (brand colour, `xp-pop` keyframe bounce-in). XP delta is fetched from `/api/xp` before and after the workout.

- **PR pulse badge on exercise summary** (`components/workout/exercise-summary-screen.tsx`, `app/globals.css`): When a new personal record is detected (`newEst1rm > prevEst1rm + 0.1`), a gold "🏆 New Personal Record!" badge replaces the "Set summary" subtitle with a `pr-pulse` keyframe animation.

- **Haptic feedback** (`components/workout-screen.tsx`): A `haptic()` helper wraps `navigator.vibrate()` (guarded for non-vibrating environments). 50ms buzz fires after each successful set log. Pattern `[80, 40, 120]` fires before transitioning to the done screen.

- **XP bar labels improved** (`app/profile/profile-content.tsx`): Left label shows `{n.toLocaleString()} XP`; right label shows `{gap} to next level` (or "Max level") instead of the raw threshold value.

- **Achievements toggle animated** (`app/profile/profile-content.tsx`): Collapse/expand wrapped in `AnimatePresence` with `motion.div` height transition (0.25s ease-in-out) and fade (0.15s). Uses `motion/react` (Framer Motion v12).

- **Achievement preview uses large square tiles** (`app/profile/profile-content.tsx`): Collapsed state now shows the existing `AchievementBadges` 4-column grid of `BadgeCard` square tiles (category colours, glow, tap-for-popover) — same cards as the full expanded view, just the latest 4 unlocked. Replaces the previous row-list layout.

**Phase 3 — Performance:**

- **N+1 fix on log-exercise** (`app/api/log-exercise/route.ts`, `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`): Added `getActiveProgramWithPhases(userId)` to the repository interface and adapter. It fetches the active program and its phases in one call (only for automatic-mode programs). `log-exercise` now uses this instead of making separate `getActiveProgram` + `listProgramPhases` calls.

- **Admin user listing paginated** (`app/api/admin/users/route.ts`, `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`): `listUsers` now accepts `limit` (default 100, max 200) and `offset` parameters. The admin GET route reads `?limit=&offset=` query params, preventing a full-table scan as the user base grows.

**Deployment:**
- Merged to `main` — deployed to Railway.

**Version:** 1.8.3 → 1.9.0

---

### Session 52 — GIF Matching & UI Bug Fixes (2026-06-04)

**What changed:**

- **Barbell Squat GIF wrong** (`lib/exercise-gif-matcher.ts`): Added `"barbell squat": "barbell full squat"` to `MANUAL_OVERRIDES`. The dataset uses "Barbell Full Squat" — without this, Jaccard scoring was tying between unrelated exercises ("kneeling barbell squat" etc.).

- **Dumbbell Curl GIF wrong** (`lib/exercise-gif-matcher.ts`): Fixed override target from `"dumbbell bicep curl"` to `"dumbbell biceps curl"` — the dataset uses the plural form "Dumbbell Biceps Curl".

- **Removed incorrect `"barbell deadlift": "deadlift"` override** (`lib/exercise-gif-matcher.ts`): The dataset has "Barbell Deadlift" exactly, so step 2 (exact match) handles it correctly. The override was redundant and potentially harmful.

- **GIF sync missing library-only exercises** (`app/api/admin/seed-exercise-gifs/route.ts`): `allNames` was built only from `session_exercises` + `exercise_logs`. Added a fourth parallel query to `exercise_library` so exercises that exist in the catalogue but aren't yet in any program or history (e.g. "Adductor Machine") also get GIFs assigned on sync.

- **Unmatched count wrong in admin panel**: Same root cause as above — the unmatched list only reflected processed exercises. Now covers all library exercises.

- **Recovery pills showing "Core Core" / wrong muscles** (`app/workout-select/workout-select-content.tsx`): `MuscleRecoveryCard` intentionally duplicates the array for a seamless marquee loop, so 1 muscle was rendering as "Core Core". Fixed by building `sessionRecoveryMuscles` from all main-muscle activations for the session, defaulting unrecovered muscles to 100% (fully recovered) so every muscle always shows.

- **Home screen sleep/nutrition stuck on previous day** (`components/overview-screen.tsx`): `readCacheSync` has a 30-min TTL that doesn't know about day boundaries. Added a date comparison: if the cached `body-metadata.today.date` doesn't match `localToday` (device timezone), the cache is ignored and a fresh fetch is triggered.

- **Workout header flashing session UUID** (`components/workout-screen.tsx`, `components/workout/pre-workout-screen.tsx`): Removed `|| sessionType` fallback so the UUID was never shown as a display name. Added a pulse skeleton `<div>` in the pre-workout header while `sessionDisplayName` is still loading.

- **Admin page missing bottom nav** (`app/admin/page.tsx`): Added `<BottomNav />` import and render, matching profile and other pages.

- **Profile page missing bottom nav** (`app/profile/page.tsx`): Added `<BottomNav />` to the profile page for consistency with the rest of the app.

- **Admin exercises tab label showing "Invites"** (`app/admin/admin-content.tsx`): The tab label expression had `'Invites'` hardcoded as the else branch for non-users tabs. Fixed to use `t` directly with Tailwind's `capitalize` class for correct display.

- **Migration 035** (`lib/data/postgres/migrations/035_clear_gif_cache_v2.sql`): Truncates `exercise_gif_cache` on deploy so all the above matcher fixes take effect on next admin sync, clearing any previously wrong-matched entries (Barbell Squat, Dumbbell Curl, etc.).

- **GIF overrides for exercises absent from dataset** (`lib/exercise-gif-matcher.ts`): Added fallback overrides for two exercises the dataset doesn't have directly:
  - `"dumbbell skull crusher"` → `"barbell lying triceps extension skull crusher"` (same movement pattern, barbell GIF used as substitute)
  - `"dumbbell overhead tricep extension"` → `"cable overhead triceps extension rope attachment"` (cable variant GIF used as substitute)
  - `"pec deck"` → `"chest fly"` (closest visual substitute in dataset)

- **Manual instructions via migration 036** (`lib/data/postgres/migrations/036_exercise_instructions_manual.sql`): Wrote instruction text directly into `exercise_library` for 6 exercises that have no dataset entry: Ab Wheel, Face Pull, Pec Deck, Hip Flexor Raise, Dumbbell Skull Crusher, Dumbbell Overhead Tricep Extension.

**Potential issues introduced:**

1. **GIF substitutes show wrong equipment** — Dumbbell Skull Crusher displays a barbell GIF; Dumbbell Overhead Tricep Extension displays a cable GIF; Pec Deck displays a dumbbell fly GIF. These are the closest visual matches available in the dataset, but technically show different equipment. The real fix is adding custom GIFs to the forked dataset repo (tracked in Planned Work).

2. **GIF cache must be re-synced after deploy** — Migration 035 truncates `exercise_gif_cache` on cold start. Until the admin runs the sync button (admin → Exercises → refresh), all exercises will show "No GIF". This is intentional but must not be forgotten after deployment.

3. **"Left Knee" / "Right Knee" in unmatched list** — These are stale data artifacts from old logs (exercises logged against a knee injury note rather than a real exercise). They will always appear as unmatched and cannot be matched to a GIF. They can be cleaned up with a one-off `DELETE FROM exercise_library WHERE name IN ('Left Knee', 'Right Knee')` — safe to do via the admin delete button.

4. **Ab Wheel, Face Pull, Hip Flexor Raise still have no GIF** — Instructions are now set, but the exercises remain in the unmatched panel. This is expected until custom GIFs are added to the dataset repo.

**Deployment:**
- Merged to `main` and deployed.

**Version:** 1.8.2 → 1.8.3

---

### Session 51 — Bug Fixes + Exercise Library Equipment Variants (2026-06-04)

**What changed:**

- **Session UUID shown as name** (`components/workout-screen.tsx`): Added `sessionDisplayName` state. When `/api/workout-data` returns `data.session.name`, that name is stored separately and used for all display purposes. The URL continues to pass `session.id` so DB lookups are stable by UUID.

- **Legs heatmap showing upper-body muscles** (`app/workout-select/workout-select-content.tsx`): `buildMuscleActivations` now falls back to `ex.muscleGroups` from the DB row when no exercise library entry is found. Previously a library miss silently skipped the exercise, producing blank or wrong muscle sets.

- **Verbose session names stripped** (`lib/utils.ts`, `components/calendar-widget.tsx`, `components/stats/weekly-stats-hub.tsx`, `app/stats/stats-content.tsx`): Added `shortSessionName(name)` utility that strips `(...)` parenthetical muscle annotations from AI-generated names (e.g. "Push A (Chest/Shoulders/Triceps)" → "Push A"). Applied at all display sites: calendar legend, training load legend, stats session drawer.

- **Program activation optimistic update** (`components/config-screen.tsx`): `activateProgram` now flips `isActive` in local state immediately, fires the API in the background, and reverts only on failure. Eliminates the perceived ~1s delay that was a round-trip wait.

- **Schedule step in AI builder** (`components/workout-builder/builder-wizard.tsx`, `lib/types/builder.ts`, `app/api/generate-program/route.ts`, `components/workout-builder/builder-review.tsx`): Added Step 8 to the wizard with two modes:
  - **Rolling rotation** (`type: 'rotation', restAfterN: N`) — stepper sets rest frequency with a dynamic example that updates in real time ("S1 → S2 → S3 → REST → S4 → S1 → REST…")
  - **Fixed weekly** (`type: 'weekly', days: [0,2,4,…]`) — day-grid picker (Mon–Sun)
  - AI prompt updated: session ordering rule added ("consecutive training days must not share primary muscle groups"), ~2 rest days/week guidance, no consecutive rest days rule
  - Schedule persisted via the save payload in `builder-review.tsx`

- **Role-aware equipment prefix** (`app/api/workout-data/route.ts`): `buildDisplayName` updated to use priority lists keyed by exercise role:
  - `primary / secondary` → barbell first, then dumbbell, cable, kettlebell
  - `accessory` → cable first, then dumbbell, kettlebell, barbell
  - Machine never prefixed (machine names are self-descriptive); bodyweight excluded

- **Migration 032 — exercise library equipment variants** (`lib/data/postgres/migrations/032_exercise_equipment_variants.sql`): Splits 20+ generic exercises into equipment-specific variants. Full scope:
  - **Inserts** ~35 new named variants: `Barbell Squat`, `Barbell Deadlift`, `Dumbbell Romanian Deadlift`, `Barbell Overhead Press`, `Dumbbell Overhead Press`, `Cable Lateral Raise`, `Cable Overhead Tricep Extension`, `Barbell Bulgarian Split Squat`, `Barbell Glute Bridge`, `Machine Calf Raise`, and more
  - **Updates** `session_exercises`, `exercise_logs`, `personal_records` to use canonical names (history continuity preserved)
  - **Deletes** old generic library entries (`Squat`, `Deadlift`, `Romanian Deadlift`, `Overhead Press`, etc.)
  - **Clears** stale `exercise_gif_cache` rows for all affected names so GIFs re-fetch with the specific names

- **GIF matcher overrides** (`lib/exercise-gif-matcher.ts`): Added 37 new `MANUAL_OVERRIDES` entries mapping new specific names to the closest dataset search term (e.g. `"barbell skull crusher" → "skull crusher"`, `"cable overhead tricep extension" → "cable tricep overhead extension"`, `"dumbbell bulgarian split squat" → "dumbbell split squat"`).

- **Repository CRUD for exercise library** (`lib/data/repository.ts`, `lib/data/postgres/adapter.ts`): Added `upsertExercise`, `deleteExercise`, `renameExerciseRefs` to the interface and Postgres adapter for future admin tooling. `renameExerciseRefs` runs as a transaction updating all three reference tables atomically.

**New files:**
- `lib/data/postgres/migrations/032_exercise_equipment_variants.sql`
- `docs/superpowers/plans/2026-06-04-exercise-library-equipment-variants.md`

**Deployment:**
- Merged to `main` — Railway deploy in progress at time of writing

**Version:** 1.8.1 → 1.8.2

---

