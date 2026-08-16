# Deep-Dive Audit #2 — Performance & Component Breakup (2026-06-13)

Scope: React re-renders, bundle weight, DB query shape, and splitting over-long files per the CLAUDE.md
"break things into components" rule (orchestrator pattern: parent holds state, children are pure).
Excludes session-104 performance plan items (workout-screen shallow selector, SetCard memo, exercise-history
abort, weekly-digest self-fetch). Known-deferred items are noted, not re-derived.

---

## Performance

### Task PER-1 — Activity-tracking screens subscribe to the whole Zustand store (re-render every GPS tick) · **High**
- **Where:** `components/activity/active-activity-screen.tsx:16-21`, `pre-activity-screen.tsx:12`, `done-activity-screen.tsx:25` — all `const { … } = useActivityStore()` with **no selector**.
- **Problem:** This is the exact bug fixed for the workout flow in session 104 (P1), never applied to the activity flow. `appendPoint` (`activity-store.ts:124`) fires on every GPS sample, mutating `rawPoints`/`distanceKm`/`currentPaceSecPerKm`; the screen (and the dynamically-loaded leaflet `ActivityRouteMap`) re-renders on every sample — burning battery during exactly the long GPS workout it supports. The orchestrator `activity-screen.tsx:9` already uses a selector correctly; the child screens don't.
- **Fix:** Subscribe with `useShallow((s) => ({ …only fields used… }))` from `zustand/react/shallow` in all three screens. Actions have stable identity, so they're free to include. **Highest-value perf fix outstanding.**
- **Verify:** React DevTools Profiler — `ActiveActivityScreen` no longer re-renders on every GPS sample (only its 1s timer + relevant field changes).

### Task PER-2 — chart.js statically imported into route bundles · **Med**
- **Where:** `nutrition-content.tsx:11` (`WeeklyNutritionChart`), `chat.tsx:58` + `chat-overlay.tsx:8` + `ai-chat-overlay.tsx:8` + `weekly-ai-summary.tsx:7` (`ChartMessage`).
- **Problem / Fix:** Same as **UI plan C1/C2/C5** — wrap each consumer in `next/dynamic({ ssr: false })`. `exercise-summary-screen.tsx:12` already does this correctly; the pattern just wasn't applied consistently. **Execute via the UI plan; cross-referenced here.**

### Task PER-3 — N+1 per-login progression-style/phase seeding · **Med (known-deferred — still open)**
- **Where:** `lib/data/postgres/adapter.ts:171-198, 217-219, 247-257, 360-367` (inside `upsertUser`, runs every login).
- **Problem:** ~17 individual `SELECT … LIMIT 1` existence checks plus per-set/per-phase `INSERT`s in nested loops on every login. Session-104 P4; still unfixed.
- **Fix (deferred):** One gate query `SELECT 1 FROM progression_styles WHERE user_id=$1 LIMIT 1`, then multi-row inserts only when absent.

### Task PER-4 — Per-row `for`-loop inserts in `saveProgram`/`saveProgressionStyle` · **Low**
- **Where:** `adapter.ts:612-637` (per-session, then per-exercise `.returning()` one at a time; per-schedule-day `:663-666`), `:955-973` (per-set `.returning()`).
- **Problem:** Dozens of sequential round-trips on save for a large program. Bounded by user-defined program size and runs in a transaction (correct, just slow).
- **Fix:** Batch with multi-row `insert().values([...]).returning()`. Low priority — only if touched.

### Task PER-5 — Unmemoized derived computations in `health-content.tsx` · **Low**
- **Where:** `app/health/health-content.tsx:392-436` (0 `useMemo`; 32 `.map` / 4 `.reduce`).
- **Problem:** BMI, BF classification, weight-trend linear regression (`[...metaRecent].reverse().filter()` + 4 reduces at `:410-421`), Mifflin-St Jeor energy balance all recompute inline every render / tab switch. Arrays are bounded so absolute cost is small, but needless.
- **Fix:** Wrap in `useMemo` keyed on `metaRecent`/relevant scalars — falls out naturally of the **CB-4** calc-hook extraction below (do together).

> Already checked, not issues: mount-time fetches with stable deps (no stale-fetch race); `buildWorkoutSessions` is batched with `inArray` (not N+1); leaflet/`@zxing` already lazy-loaded; `bottom-nav`, `activity-screen`, `dynamic-background*`, `use-weather` all use per-field selectors.

---

## Component breakup

> Follow the orchestrator pattern: parent keeps state, extracted child is a pure render component taking
> props + callbacks. Do each as its own small PR; verify no behaviour change after each extraction.

### Task CB-1 — Split `lib/data/postgres/adapter.ts` (2407 lines) by domain · **High**
- The single largest file: one class holding Users / Programs / ProgressionStyles / PhaseSets / Workout-history / BodyMetrics / Activity / Health / Nutrition / Social.
- **Mostly mechanical** — the only shared dependency to thread is the `db` getter (`:23`); every private mapper (`rowToUser:26`, `rowToPhase:691`, `buildWorkoutSessions:1201`, `rowToActivityLog:1625`, `rowToMealType:1982`, `rowToFoodItem:1991`, `rowToFoodLog:2005`, `computeLogMacros:2013`, `rowToFriendship:2300`, `generateUniqueFriendCode:47`) is domain-local with no cross-domain use.
- **Shape:** keep the single `WorkoutRepository` interface + a thin `PostgresWorkoutRepository` facade that delegates to per-domain modules (`lib/data/postgres/{users,programs,progression,workout-history,body-metrics,activity,health,nutrition,social}.ts`), each a class taking `{ getDb }`. Move each domain's mappers into its module.
- **Do in slices**, starting with the cleanest/newest: **Nutrition** (`2029-2317`) and **Social** (`2319-2407`).

### Task CB-2 — Split `components/config-screen.tsx` (1639 lines) · **High**
Target `components/config/`: `ProgramEditorSheet` (`1155-1576`, ~420 lines — the biggest block), `StyleEditorSheet` (`1048-1153`), `ProgressionSetsSection` (`919-979`), `PhaseSetsSection` (`981-1037`), `ProgramListCard` (`836-898`), `PreferencesSection` (`781-795`). Hooks: `useStyleEditor` (`~82-241`) and `useProgramEditor` (`~89-493`) → `hooks/` (own the CRUD + toast + cache-invalidate).

### Task CB-3 — Split `app/session-select/session-select-content.tsx` (1602 lines) · **High**
Target `app/session-select/components/`: the dashboard is a stack of independent widget cards — `RecommendationCard` (`940-1054`), `StreakCard` (`1057-1118`), `WeekStripCard` (`1120-1172`), `WeightSparklineCard` (`1173-1193`), `NutritionDonutCard` (`1195-1248`), `SleepWidgetCard` (`1250-1280`), `StepsWidgetCard` (`1282-1311`), `MoodWidgetCard` (`1313-1335`), `MetricTilesRow` (`1337-1383`), `ReadinessScoreCard` (`871-893`), `ApkBanner` (`909-930`), `MorningBriefingSheet` (`1432-1458`), `WeekDayDetailSheet` (`1475-1566`). Hooks: `useSessionSelectPreferences` (localStorage loaders `101-227`), `useSectionOrder` (drag/hide/persist `378-709`).

### Task CB-4 — Split `app/health/health-content.tsx` (1342 lines) · **High**
Target `app/health/components/`: `BodyWeightCard` (`466-501`), `BodyFatCard` (`503-572`), `LeanMassCard` (`574-609`), `MetricsQuickGrid` (`611-683`), `WaterIntakeCard` (`685-717`), `EnergyAndBmiGrid` (`720-763`), `TrendAndBalanceGrid` (`765-823`), `BiometricsGrid` (`825-887`), `TrainingLoadCard` (`889-916`), `SleepPerformanceCard` (`918-951`), `DayDetailSheet` (`1178-1332`). Calc hooks (pure, memoized — see PER-5): `useWeightTrend` (`409-421`), `useBmiClassification` (`396-407`), `useEnergyBalance` (`423-436`).

### Task CB-5 — Split `components/workout-builder/builder-wizard.tsx` (777 lines) · **Med**
Already a step machine — extract each step to `components/workout-builder/steps/`: `GoalSpectrum` (`127-250`), `EquipmentSelectionStep` (`394-431`), `ProgressionModeStep` (`528-571`), `PhaseStructureStep` (`573-596`), `ProgramLengthStep` (`598-644`), `ScheduleSelectionStep` (`646-747`), `WizardHeader` (`356-373`), `WizardFooter` (`750-774`). Wizard keeps `inputs` state; steps take `inputs` + `onChange`.

### Task CB-6 — Split `components/more/profile-tab.tsx` (775 lines) · **Med**
Target `components/more/profile/`: `ProfileHeroSection` (`249-366`), `ProfileStatsStrip` (`368-412`), `ProfileAchievementsSection` (`417-475`), `ProfileSeasonBadges` (`477-497`), `ProfileGoalsSection` (`499-649` — medium-risk, reads/writes 8 localStorage setters; pass as props), `ProfileAppearanceSection` (`651-678`), `ProfileAboutSection` (`682-727`), `ProfileAdminSection` (`729-752`). Hook `useAvatarUpload` (`resizeToDataUrl:63-80` + `handleAvatarChange:205-222`). Move `formatVolume`/`formatDistance` (`82-93`) → `lib/format.ts`. (The sign-out cache-wipe from Caching plan Task 1 lands here too.)

### Task CB-7 — `components/chat.tsx` (802 lines) · **Low**
Lower priority; if touched, extract `getSessionSuggestions` (`63+`) and the weight-dial/weights-summary sub-UI.

---

## Verification & commit
- After each breakup: `pnpm exec tsc --noEmit && pnpm lint && pnpm test` + a Playwright smoke of the affected screen to confirm zero behaviour change.
- PER-1 is user-perceptible (smoother/longer-lasting GPS tracking) → patch bump + changelog line. Breakup tasks are internal refactors (no version bump unless bundled with a user-visible change).
