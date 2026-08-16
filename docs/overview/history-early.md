# TrainingAI — Session History (early: Sessions 1–50) + legacy architecture notes

> Historical session log, archived from `projectOverview.md`. Covers sessions ~1–50 and the original "Current Architecture / Key Files / Environment" appendix (superseded by CLAUDE.md).
> For current status, the live "What's Left To Do" list, and the document map, see `projectOverview.md`.

---

### Session 50 — Code Review Uplift: 13 Fixes (2026-06-03)

**What changed:**

- **Task 1 — Timezone bug fixes**: `phase-engine.ts` `addDays` used `toISOString().slice(0,10)` (UTC); now uses `formatInTimeZone(date, 'UTC', 'yyyy-MM-dd')`. `readiness-score/route.ts` and `morning-briefing/route.ts` used same pattern; fixed with `toAestDay(date, tz)`. `log-exercise/route.ts` had `tz` variable scoped inside phase block — moved before it.

- **Task 2 — Chronic load dynamic span**: ACWR chronic average was always dividing by 4 weeks even if less data was available. Now measures actual data span in weeks and divides accordingly, giving more accurate ACWR for new users.

- **Task 3 — Prompt injection guard in nutrition scan**: `body.text` had no type check or length cap. Added `typeof` guard + 500-char cap + control-char strip before passing to Gemini.

- **Task 4 — N+1 DB queries in sync-workout**: `countSessionsSinceStart` was called on every loop iteration. Extracted before the loop; counter incremented manually per iteration.

- **Task 5 — confirm-early-deload authorization**: Was calling `listPrograms` for ownership check. Now uses `getActiveProgram` and rejects if `programId !== activeProgram.id`.

- **Task 6 — Session lookup by UUID**: `/api/workout-data` now finds session by `id` first, falls back to name. `workout-select-content.tsx` passes `session.id` instead of `session.name` to the router.

- **Task 7 — Early-deload banner localStorage key**: UTC month key (`.toISOString().slice(0,7)`) replaced with device-timezone `formatInTimeZone(new Date(), tz, 'yyyy-MM')` so the key rolls over at local midnight.

- **Task 8 — DB batch writes**: `logSets`, `upsertBodyMetrics`, and `listPhaseSets` in adapter.ts replaced N-loop inserts/queries with single batch operations.

- **Task 9 — SyncProvider error handling**: `initSQLite` and `drainOutbox` wrapped in try/catch. Failed SQLite init aborts early; failed outbox drain logs and continues to cache warming.

- **Task 10 — Semantic section headings**: Card-level section labels (`<p>` with uppercase tracking) changed to `<h3>` in health-content and session-select-content.

- **Task 11 — Safe-area insets**: Added `env(safe-area-inset-bottom)` to scroll containers in session-select, history, stats, and health pages (was using bare `pb-*` Tailwind classes).

- **Task 12 — Meal type drag-to-reorder**: Added `reorderMealTypes` to repository interface and adapter (transaction updates sortOrder). Added `PATCH /api/nutrition/meal-types`. Wired `@dnd-kit/react` in `meal-type-manager.tsx` — grip handle is now functional.

- **Task 13 — Phase context in active workout**: Per-session `/api/workout-data` now returns `phaseStatus`. `workout-screen.tsx` reads it and passes to `ActiveWorkoutScreen`, which shows phase name + cycle in the header sub-line.

**Deployment:**
- On branch `claude/vigilant-turing-2rXPM` — awaiting user confirmation to merge to main.

**Version:** 1.8.0 → 1.8.1

---

### Session 49 — AI Workout Builder (2026-06-03)

**What changed:**

- **`app/api/generate-program/route.ts`** (new) — POST endpoint, auth-gated, rate-limited 20/hr. Accepts program name, equipment, frequency, time, muscles, goal, phase structure. Filters exercise library by equipment (case-insensitive) and muscle focus. Calculates per-session exercise count based on time budget (3.5 min/set), with graceful fallback for "no time constraint". Calls Gemini `gemini-3.1-flash-lite` with science-backed volume guidelines (hypertrophy 10–20 sets/muscle/week, strength 15–25, mixed 15–20) and split recommendations (1d=Full Body, 2d=Full Body×2, 3d=PPL, 4d=UL×2, 5d=PPL+Upper+Lower, 6d=PPL×2). Returns `GeneratedProgram` JSON.

- **`app/api/builder-chat/route.ts`** (new) — POST endpoint for AI refinement. Accepts user message, current program, chat history, equipment. Returns `{ response, program }` where program reflects user-requested changes (exercise swaps, volume adjustments, session modifications). System prompt includes volume constraints and weekly calculation guidance.

- **`components/workout-builder/builder-wizard.tsx`** (new) — 7-step form wizard:
  - Step 1: Program name
  - Step 2: Equipment (two sections: Home gym = individual items, Commercial = Full Gym standalone)
  - Step 3: Training frequency (1–7 days) via `WeightDial`
  - Step 4: Time per session (30/45/60/90 min or "No time constraint")
  - Step 5: Muscles to focus on (multi-select with "Select all / Clear all" toggle; displays `MuscleHeatmap`)
  - Step 6: Training goal (Hypertrophy / Strength / Strength+Hypertrophy)
  - Step 7: Phase structure (Linear Progression / Baselining / Phase-Based Progression)
  - Step 8: Review screen (generated program)

- **`components/workout-builder/builder-review.tsx`** (new) — review screen with:
  - Generated program display (sessions, exercises with roles)
  - Exercise swap dropdowns: filters alternatives by same main muscle + equipment, up to 8 options
  - AI chat: refine program with messages (e.g., "Make it more glute-focused")
  - Save button: constructs `Program` with UUIDs, persists via `/api/workout-templates` with `phaseMode: 'automatic'` and resolved `phaseSetId`

- **`lib/types/builder.ts`** (new) — types: `GeneratedProgram`, `GeneratedSession`, `GeneratedExercise`, `BuilderInputs`, `ChatMessage`.

- **`components/config-screen.tsx`** — added "Build" button (outlined, brand color) next to "New" button. Opens builder wizard in a Sheet. `onSaved` callback re-fetches programs list.

- **`lib/data/postgres/migrations/030_exercise_equipment.sql`** (new) — resets all equipment to `{}`, then repopulates with normalized lowercase values (barbell, dumbbell, cable, kettlebell, machine). Fixes equipment data that was stored capitalized/plural in migration 021.

- **`lib/data/postgres/migrations/031_rename_phase_sets.sql`** (new) — renames phase sets: 'Default' → 'Phase-Based Progression', 'Re-baseline' → 'Baselining'.

- **`lib/data/postgres/adapter.ts`** — line 150: default phase set seed name changed to 'Phase-Based Progression'; line 203: renamed 'Re-baseline' to 'Baselining'. `saveProgram` now persists `phaseMode` and `phaseSetId` (previously ignored).

- **`components/ui/weight-dial.tsx`** — fixed centering offset by snapping container height to an odd multiple of `ITEM_HEIGHT` so the selected item always sits at the exact center of the highlight box. Recalculates `paddingItems` from actual container height instead of the fixed `visible` prop.

**Equipment logic:**
- Home gym (Dumbbells, Barbell, Cables, Kettlebell) are individual, mix-and-match options.
- Full Gym is standalone: selecting it clears individual items; selecting individual items clears Full Gym.
- API `buildEquipmentSet` function: if `'full_gym'` in array, adds all types (barbell, dumbbell, cable, kettlebell, machine, bodyweight); otherwise adds selected + bodyweight.

**Time-to-exercises calculation:**
- Session time budget (in minutes) → subtract 10 min warmup → divide by 3.5 min/set (realistic with rest/transition) → round to nearest exercise count (assuming 3 sets/exercise avg).
- Example: 60 min session → 50 working min → ~14 sets → ~5 exercises.
- "No time constraint" mode aims for 5–9 exercises per session based on goal and frequency.

**Science-backed splits:**
- 1 day → Full Body (hit all muscles once/week)
- 2 days → Full Body × 2 (each muscle hit twice/week)
- 3 days → Push/Pull/Legs (each major muscle hit once, minor muscles via compound carry)
- 4 days → Upper/Lower/Upper/Lower (each muscle hit twice/week)
- 5 days → PPL + Upper + Lower (major muscles 1.5–2×/week)
- 6 days → PPL × 2 (each muscle hit twice/week)
- 7 days → Not recommended (overkill frequency, recovery risk)

**Final fixes this session:**
- Updated 2-day split recommendation from "Upper/Lower" to "Full Body × 2" in the AI prompt (science-backed)
- Fixed WeightDial centering offset by snapping container height to odd ITEM_HEIGHT multiples

**Testing:**
- Full wizard flow tested end-to-end (7 steps + review + AI chat + save)
- Exercise count calculations verified for 3/5/6 day frequencies at 60min time budget
- Equipment filtering confirmed working with home gym + full gym options
- AI response quality verified — correct split recommendations, volume targets, and exercise suggestions

**Deployment:**
- Merged feature branch `claude/project-review-brainstorm-SoBBa` to `main`
- Version bumped 1.7.2 → 1.8.0
- Auto-deployed to Railway; live now

**Known issues / notes:**
- Phase set lookup includes graceful fallback: exact name match → first-word partial match → default phase set → first in list
- Rate limit is 20/hr per user (includes both generate and chat endpoints)
- Gemini model: `gemini-3.1-flash-lite` with ~1,500 RPD free tier
- Equipment filter is case-insensitive as a safety net (DB values now normalized lowercase)

**Version:** 1.7.2 → 1.8.0

---

### Session 46 — Tier 3 & 4 Uplift Fixes (2026-06-02)

**What changed:**

13 fixes from the Uplift Backlog (U14-U25, U29-U30) delivering accessibility, UX, and performance improvements:

- **Accessibility (U14)**: aria-labels added to rep +/− buttons, back/refresh buttons, calendar day tiles, and metric tile cards for screen reader compatibility
- **Navigation Fix (U15)**: Food logger back-button now uses a step stack instead of libraryItemId heuristic, fixing navigation to correct previous step
- **Touch Targets (U16-U17)**: Meal-type chips, quantity buttons, and recent-items rows all set to 44-48dp minimum for easier mobile tapping
- **Fetch Race Fix (U18-U19)**: Exercise stats sheet fetches now use AbortController to cancel stale requests on exercise change; error state shows instead of blank
- **Pruning (U20)**: Rate-limit map now purges expired entries every 5 minutes instead of only on access, preventing unbounded growth on long-running servers
- **Validation (U22-U23)**: Barcode and exercise-gif routes now use Zod schemas to validate parameter length (barcode 8-15 digits, exercise name ≤100 chars)
- **Responsive UI (U24-U25)**: Rest timer ring now responsive (60vw capped at 220px), weight dial height responsive (35vh capped at 320px) for better mobile layout
- **Caching Lock (U30)**: cachedFetch now uses per-key in-flight locking to prevent concurrent network requests for the same cache key

**Build fixes:** Corrected variable naming conflicts in barcode route and typed inFlightRequests map to resolve ESLint errors.

**Note**: U21 (mobile token pruning) and U29 (prompt injection) were already implemented. U26-U28 and U31 deferred to future session.

**Version:** 1.7.1 → 1.7.2

---

### Session 45 — Security & UX Fixes (2026-06-02)

**What changed:**

- **`components/workout-screen.tsx`** — added `sessionType` to the `resetSession` effect dependency array (line 131). Fixes state bleed when switching session types: prevents weights, reps, and timers from carrying over from one session to another (U3).

- **`components/workout/set-card.tsx`** — enlarged rep +/− buttons from `w-10 h-12` (40×48px) to `w-12 h-12` (48×48px) and updated the reps display span width to match. Meets Android 48dp minimum touch target (U5).

- **`lib/stores/workout-store.ts`** — added `storedDate: string` field to `WorkoutState` (tracks YYYY-MM-DD); added `onRehydrateStorage` hydrate function that clears `todayLogged` if the stored date doesn't match today's date. Fixes pre-workout screen showing yesterday's logged exercises when app is reopened on a new day (U13).

- **`lib/stores/workout-store.ts`** — added `import { todayInTz }` and integrated it into `INITIAL_STATE` and `startWorkout` to track the current date. Ensures `storedDate` stays fresh.

**Verification:** Added comprehensive test plan for all 4 fixes (session state isolation, button sizing, Math.max guard, store date reset). Ready for testing on Galaxy S25 Ultra.

**Note:** 8 of the 12 Tier 1 & 2 security fixes were already implemented in the codebase (U1, U4, U6, U7, U8, U9, U10, U12). Only U3, U5, U11, U13 required code changes.

**Version:** 1.7.0 → 1.7.1

---

### Session 44 — Block Periodization (2026-06-02)

**What changed:**

- **`lib/data/postgres/migrations/020_block_periodization.sql`** — new `program_phases` table (id, program_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id); added columns: `phase_mode`, `started_at`, `sessions_per_cycle`, `early_deload_week_start` on `programs`; `exercise_role` on `session_exercises`; `phase_id` + `is_early_deload` on `workout_sessions`. Migration is fully idempotent (IF NOT EXISTS + DO blocks).

- **`lib/data/postgres/schema.ts`** — Drizzle schema extended to match new columns.

- **`lib/types/program.ts`** — `ProgramPhase` type added; `phaseType` union extended to `'normal' | 'peak' | 'deload' | 'accessory'`; `exerciseRole` field on `SessionExercise`.

- **`lib/data/repository.ts`** — new interface methods: `listProgramPhases`, `saveProgramPhases`, `updateProgramPhaseSettings`, `listProgressionStyles`.

- **`lib/data/postgres/adapter.ts`** — implemented above methods; added default style seeding in `upsertUser()` (Hypertrophy 65%/10r/60s, Strength 80%/5r/120s, Peak 90%/3r/180s/useFor1rm, Deload 50%/10r/60s, General 60%/12r/60s).

- **`lib/phase-engine.ts`** — pure functions: `getCurrentPhase` (maps session count → current phase + cycle + weeks remaining), `isDeloadActive` (checks phase type + early deload window), `resolveStyleForExercise` (routes primary/secondary/accessory exercises to the correct style ID). No DB calls.

- **`lib/__tests__/phase-engine.test.ts`** — 20 vitest tests, all passing.

- **`components/config/phase-editor.tsx`** — drag-to-reorder phase list; per-phase duration, type, primary/secondary style selectors; Accessory phase rendered as a fixed, non-draggable card at the bottom.

- **`app/api/program-phases/route.ts`** — GET (list phases for a program) + PUT (save phases; auto-populates 5 default phases with default styles when saving an empty array).

- **`components/config-screen.tsx`** — Phase Setup moved to its own top-level card section; style picker hidden for Block Periodization exercises (shown only in Manual mode); Manual/Block toggle locked after program creation; terminology updated (Automatic→Block Periodization, role labels).

- **`app/api/workout-data/route.ts`** — integrated phase engine: phase data + current phase resolved and returned with workout data.

- **`app/api/confirm-early-deload/route.ts`** — POST endpoint; marks `early_deload_week_start` on the active program for the current week.

- **`app/api/readiness-score/route.ts`** — added `earlyDeloadRecommended: boolean` to response based on ACWR threshold.

- **`app/api/log-exercise/route.ts`** — stamps `phase_id` and `is_early_deload` on new workout sessions.

- **`app/api/weekly-stats/route.ts`** — deload sessions excluded from volume, sets, intensity, duration aggregates; deload days marked with `isDeload: true`; amber 'D' badge added to UI.

- **`app/api/training-load/route.ts`** — deload sessions excluded from the 28-day chronic ACWR window (kept in the 7-day acute window).

- **`app/api/exercise-history/route.ts`** — `isDeload: boolean` added to each history entry.

- **`components/workout/pre-workout-screen.tsx`** — deload banner and current phase indicator shown when Block Periodization is active.

- **`app/session-select/session-select-content.tsx`** — block progress card (current phase, cycle, weeks remaining) and early deload card when recommended.

- **`app/workout-select/workout-select-content.tsx`** — phase badge on each session card.

- **`components/stats/weekly-stats-hub.tsx`** — amber 'D' marker on deload day columns.

- **`tsconfig.json`** — `**/__tests__/**` added to exclude so `pnpm tsc` doesn't conflict with vitest's type pass.

**New files:**
- `lib/phase-engine.ts`
- `lib/__tests__/phase-engine.test.ts`
- `components/config/phase-editor.tsx`
- `app/api/program-phases/route.ts`
- `app/api/confirm-early-deload/route.ts`
- `docs/superpowers/specs/2026-06-02-program-wizard-design.md`
- `docs/superpowers/plans/2026-06-02-block-periodization-ux-simplification.md`

**Version:** 1.6.0 → 1.7.0

---

### Session 43 — App Review: Security, Functional & UI/UX Audit (2026-06-01)

**What changed:**

- **Full app review** — no code changes; documentation-only session.
- **`projectOverview.md`** — added 8 new security risks (S8–S15) to the Outstanding table, 9 new Known Issues (KI #3–14) covering functional bugs, and a new **Uplift Backlog** section under Planned/Future Work with 31 items organised into 4 priority tiers.
- **`CLAUDE.md`** — added standing rule: `.md`-only changes may be committed and pushed directly to `main` without a feature branch or confirmation.

**Key findings (not yet fixed — see Uplift Backlog):**
- Critical: TTS route has no auth check (S8)
- High: AI routes have no rate limiting (S9); `sync-workout` accepts unvalidated JSON (S10); nutrition scan has no image size limit (S11)
- High functional: Brzycki division-by-zero at 37 reps (KI #3); `resetSession` effect deps missing `sessionType` (KI #4); non-atomic PR detection race (KI #6)
- High UX: Rep +/− buttons 32 dp (below 48 dp Android minimum); 8–9 px text in week strip illegible on S25 Ultra

**No version bump** — no user-visible code changes shipped this session.

---

### Session 42 — Nutrition Polish: 7-Day Chart, Quick-Log, Calorie Progress, AI Context (2026-06-01)

**What changed:**

- **7-day nutrition chart** (`components/nutrition/weekly-nutrition-chart.tsx` — new; `app/health/health-content.tsx`):
  - Bar chart on the Health > Nutrition tab showing daily calories, protein, carbs, or fat over the last 7 days.
  - Metric toggle (Calories / Protein / Carbs / Fat). Today's calorie bar turns orange if over target.
  - 7-day average caption shown when viewing Calories and a target is set.
  - New API route `app/api/nutrition/weekly-summary/route.ts` — returns aggregated food log data per day using `formatInTimeZone` with the user's stored timezone.
  - New repository method `listFoodLogsSummary(userId, from, to)` in `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` — single Drizzle `SUM` aggregation grouped by date.

- **Recently logged items / quick-log** (`components/nutrition/capture-step.tsx`, `app/api/nutrition/recent-for-meal/route.ts` — new):
  - When the food logger is opened from a specific meal slot, the Capture step shows the 5 most recently logged items for that slot above the input tiles.
  - Tapping a recent item skips straight to the Assign step (no scan/review needed).
  - New repository method `listRecentFoodItemsForMealType(userId, mealTypeId, limit)` — fetches last 100 logs for the meal type, deduplicates by food item ID, returns up to `limit` distinct items.

- **Daily calorie progress in Assign step** (`components/nutrition/assign-step.tsx`):
  - Progress bar below the macro preview shows today's total calories (already logged + this item) vs. daily target.
  - Bar turns orange when over target, green when under. Hidden when no calorie target is set.
  - Fetches today's food logs and nutrition targets in parallel on mount.

- **Confidence percentage bar** (`components/nutrition/review-step.tsx`):
  - AI scan confidence replaced text badge (`"High confidence"`) with a coloured horizontal bar showing an approximate percentage (90% green / 60% amber / 30% orange).

- **Barcode not-found screen** (`components/nutrition/capture-step.tsx`):
  - When a scanned barcode isn't in the Open Food Facts database, instead of silently falling back to manual entry, a dedicated screen is shown: "No match found" with three options — "Scan photo instead" (camera → AI), "Enter manually", or "Back".

- **Nutrition context in AI chat** (`app/api/ai-chat/route.ts`):
  - Today's food logs and nutrition targets are now fetched in parallel with other context data and added to the training data string sent to Gemini.
  - Claude can now answer questions like "How many calories have I had today?" or "What macros am I short on?".

- **Workout cache invalidation fix** (`components/config-screen.tsx`):
  - Added `invalidateCache('workout-data')` after a successful program save so the exercise list reflects changes immediately without a manual reload. Previously the old program was served from the SQLite cache for up to 6 hours after editing.

- **Package renamed** (`package.json`):
  - `"name"` changed from `"google-sheet-super-agent"` (a Sheets-era relic) to `"trainingai"`.

**New files:**
- `app/api/nutrition/weekly-summary/route.ts`
- `app/api/nutrition/recent-for-meal/route.ts`
- `components/nutrition/weekly-nutrition-chart.tsx`

**Known issues / next steps:**
- No new known issues introduced.

---

### Session 41 — Bug Fixes: Nutrition Barcode Macros, AEST Date, Serving Size Scaling (2026-06-01)

**What changed:**

- **Barcode scan per-serving fix** (`app/api/nutrition/barcode/route.ts`):
  - Root cause: route always read `_100g` fields from Open Food Facts (per-100g values) and returned them directly as serving values. A 40g bar was showing ~2.5× the real macros (e.g. 342 kcal instead of ~137 kcal).
  - Fix: prefer `_serving` fields (already scaled by Open Food Facts); fall back to `_100g × (servingG / 100)`.
  - Serving size parser improved: now extracts grams from strings like `"1 bar (40g)"` via regex rather than raw `parseFloat` which returned `1`.

- **Food log AEST date fix** (`components/nutrition/food-logger-sheet.tsx`, `components/nutrition/saved-meals-sheet.tsx`):
  - Both components were using `new Date().toISOString().slice(0, 10)` (UTC) when writing food logs. Before 10am AEST this is yesterday's date, so logged items were filed under the wrong date and never appeared on the nutrition screen.
  - Fixed to use `todayInTz()` from `lib/date-utils.ts`.

- **Live serving size scaling** (`components/nutrition/review-step.tsx`):
  - Editing the serving size field in the Review step now recalculates all macros proportionally in real time.
  - Base per-gram values are snapshotted when the scan result loads; scaling always derives from those originals (not from the previous value), so partial typing doesn't cause drift.
  - "scales macros" hint shown next to the serving size label.

- **Timezone rule in CLAUDE.md**:
  - Added a prominent standing rule documenting the forbidden pattern (`new Date().toISOString().slice(0,10)`) and the correct replacement (`todayInTz()`), with explanation of why the bug keeps recurring.

**Known issues / next steps:**
- No new known issues introduced.

---

### Session 40 — Bug Fixes: Barcode Scanner, Nutrition Cache, Timer & Nav (2026-05-31)

**What changed:**

- **Barcode scanner — native Capacitor plugin working** (`components/nutrition/barcode-scanner.tsx`):
  - Root cause of all previous failures: dynamic `import()` of `@capacitor-community/barcode-scanner` fails in the Android WebView because the WebView can't resolve bare module specifiers at runtime. Capacitor plugins must be statically bundled by webpack.
  - Fixed with a static `import { BarcodeScanner as CapScanner } from '@capacitor-community/barcode-scanner'` at the top of the file.
  - Plugin API confirmed as v3-style (v4.0.1 kept same API): `checkPermission({ force: true })` → `hideBackground()` → `startScan()` → `showBackground()`.
  - Camera pass-through fix: overlay rendered via `createPortal(... document.body)` so no parent sheet/dialog background can block it. Before `hideBackground()`, a `<style>` tag with `body.scanner-active > *:not([data-scanner-overlay]) { visibility: hidden }` is injected to hide all page content. Removed on cancel/scan.
  - ZXing `getUserMedia` fallback retained for web/PWA.

- **Nutrition data caching** (`app/health/health-content.tsx`):
  - All three nutrition fetches (meal types, food logs, targets) now use `cachedFetch` via SQLite.
  - Meal types + targets: `TTL_LONG` (6h) — these rarely change.
  - Today's food logs: 60s TTL — short so new entries appear promptly after logging.
  - Cache key for food logs includes the date: `nutrition-food-logs-YYYY-MM-DD`.

- **Nutrition timezone fix** (`app/health/health-content.tsx`):
  - `new Date().toISOString().slice(0, 10)` (UTC) replaced with `todayInTz()` from `lib/date-utils.ts` for both the food-logs fetch date and the mood fetch date.
  - Before this fix, between midnight AEST and 10am AEST the app would show the previous day's food logs.

- **Warmup GIF fix** (`components/workout/warmup-screen.tsx`):
  - `media?.img ?? media?.gif` → `media?.gif ?? media?.img`.
  - Was always showing the static JPEG thumbnail when one existed; animated GIF only showed for exercises with no JPEG. Now shows animated GIF for all exercises that have one.

- **Session timer carry-over fix** (`components/workout-screen.tsx`):
  - On `WorkoutScreen` mount, if `store.sessionType !== sessionType` (i.e. a different workout was previously active and persisted to localStorage), the session is immediately reset via `store.resetSession()`.
  - Previously, opening Push after having been mid-Pull kept Pull's `workoutStartMs` and `mode="active"` — the Pull timer continued running in the Push screen.

- **Leave workout confirmation** (`components/shell/bottom-nav.tsx`):
  - Bottom nav now checks `useWorkoutStore` for `workoutStartMs !== null && mode !== "pre"`.
  - When a workout is active and the user taps any nav link that navigates away from `/workout*`, `e.preventDefault()` is called and a "Leave workout?" dialog appears.
  - "Stay" dismisses the dialog. "Leave" calls `resetSession()` then `router.push(pendingHref)`.

- **`beforeunload` warning** (`components/workout-screen.tsx`):
  - Added a `beforeunload` event listener that fires when `workoutStartMs !== null && mode !== "pre"`.
  - Prompts the OS/browser "Are you sure you want to leave?" on page close or refresh mid-workout.

**Known issues / next steps:**
- `@capacitor-community/keep-awake` (prevent screen sleep during workout) — optional APK bundle item, deferred.
- Drag-to-reorder meal types is UI-only (grip handles shown) — actual drag sorting not wired, deferred.
- Food item library search (re-use previously scanned items) in Step 1 — deferred.
- Hydration tracking — deferred.

---

### Session 39 — Full Nutrition Logging System (2026-05-31)

**What changed:**

- **DB migration `019_nutrition.sql`** — adds 6 new tables (`meal_types`, `food_items`, `food_logs`, `saved_meals`, `saved_meal_items`, `nutrition_targets`) and `food_region TEXT DEFAULT 'AU'` on `users`.
- **Drizzle schema** — all 6 tables added to `lib/data/postgres/schema.ts`.
- **TypeScript types** — `lib/types/nutrition.ts` with `MealType`, `FoodItem`, `FoodLog`, `FoodLogWithItem`, `SavedMeal`, `NutritionTargets`, `NutritionScanResult`.
- **Repository interface + adapter** — 15 new methods in `lib/data/repository.ts` + `lib/data/postgres/adapter.ts`.
- **10 API routes** under `app/api/nutrition/`:
  - `POST /api/nutrition/scan` — Gemini 3.1 Flash Lite vision/text → nutrition JSON
  - `GET /api/nutrition/barcode?code=` — Open Food Facts lookup
  - `GET/POST /api/nutrition/food-logs` — list by date, create
  - `PATCH/DELETE /api/nutrition/food-logs/[id]` — update quantity, delete
  - `GET/POST /api/nutrition/meal-types` — list (seeds defaults on first call), create
  - `PUT/DELETE /api/nutrition/meal-types/[id]` — update, delete (blocked if logs reference it)
  - `GET/POST/DELETE /api/nutrition/saved-meals` — saved meal templates
  - `GET/PUT /api/nutrition/targets` — macro targets
  - `GET/POST /api/nutrition/food-items` — search and create food library
- **UI components** in `components/nutrition/`:
  - `MacroRing` — SVG calorie ring + protein/carbs/fat progress bars
  - `MealCard` — expandable card per meal type with food log items
  - `FoodLoggerSheet` — 3-step wizard shell (Capture → Review → Assign)
  - `CaptureStep` — 5 input method tiles (photo, barcode, describe, saved meals, manual)
  - `BarcodeScanner` — Capacitor native + ZXing `@zxing/browser` web fallback
  - `ReviewStep` — editable nutrition form with AI confidence badge
  - `AssignStep` — meal type chips, quantity presets, live macro preview
  - `SavedMealsSheet` — quick-log saved meal templates
  - `NutritionTargetsForm` — set daily macro targets
  - `MealTypeManager` — create/edit/delete/reorder meal types
- **Health tab** — Nutrition tab is now first; dynamic MacroRing + MealCards replace hardcoded placeholder; gear icon opens settings sheet.
- **Profile** — Food region selector (AU/US/UK/NZ) stored in localStorage; localStorage calorie goal (`ta_calorie_goal_kcal`) auto-migrates to `nutrition_targets` DB on first profile load.
- **Packages added**: `@zxing/browser`, `@phosphor-icons/react`.

**Known issues / next steps:**
- ~~`@capacitor-community/barcode-scanner` not yet added to Capacitor APK build~~ ✅ Fixed session 40 — native scanner working via static import + camera pass-through.
- Picture-in-Picture workout timer (show timer + set controls as floating overlay while other apps are in use) — implemented in session 39, requires APK rebuild to activate.
- `@capacitor-community/keep-awake` (prevent screen sleep during workout) — requires APK rebuild.
- Drag-to-reorder on meal types is UI-only (grip handles shown) — actual drag sorting not wired (deferred).
- Food item library search (re-use previously scanned items) not wired to Step 1 — deferred.
- Hydration tracking deferred.

---

### Session 37 — Timezone Audit, Stats Redesign, Volume-Based Load Bars (2026-05-31)

**What changed:**

- **Timezone audit — all API routes now use GMT+10 (AEST) dates:**
  - `app/api/ai-chat/route.ts` — `fmt()` updated to accept `tz` param and use `toAestDateStr(d, tz)`; `buildBodyMetricsSummary` updated to accept `tz`; `buildWorkoutHistory` passes `tz` through; all date ranges anchored to `fromZonedTime(todayIso + "T00:00:00", tz)`. Today's date uses `todayInTz(tz)` (client-supplied `localDate` preferred).
  - `app/api/readiness-score/route.ts` — `todayIso` changed from `new Date().toISOString().slice(0,10)` to `todayInTz(tz)`; date ranges anchored to `todayMidnightUtc(tz)`.
  - `app/api/morning-briefing/route.ts` — same `todayInTz(tz)` fix; date range arithmetic anchored to local midnight.
  - `app/api/sleep-performance-correlation/route.ts` — `ws.startedAt.toISOString().slice(0,10)` replaced with `toAestDay(ws.startedAt, tz)` for workout-date lookup against sleep records. Previously pairing the wrong sleep night to a workout done after midnight UTC.
  - `app/api/weights-summary/route.ts` — `log.loggedAt.toISOString().slice(0,10)` replaced with `toAestDay(log.loggedAt, tz)` for the exercise last-used date shown in workout screen.
  - `app/api/calendar-data/route.ts` — verified fine: SQL uses `AT TIME ZONE 'Australia/Brisbane'` directly.

- **Renamed `/api/google-sheet` → `/api/ai-chat`** — no more Google Sheets naming anywhere in the codebase.

- **Renamed `GoogleSheetSignIn` → `GoogleSignIn`** in `components/google-sign-in.tsx` and `app/sign-in/page.tsx` — it was always just a Google OAuth button.

- **Stats page layout reordered** (`app/stats/stats-content.tsx`) — Calendar → This Week (training load + stats) → Weekly AI Summary pill. Previously the AI summary appeared between calendar and training load, preventing all three from fitting on screen without scrolling.

- **Weekly AI Summary redesigned as a compact pill** (`components/weekly-ai-summary.tsx`):
  - Collapsed state = single header row only (no content preview). Tap to expand/collapse.
  - Full content (text + charts) only renders when expanded.
  - Refresh button uses `e.stopPropagation()` to avoid toggling expansion.
  - Status shown inline in header: "· generating…", "· HH:MM" (last fetched), "· error".
  - Cache: once per calendar day via `localStorage` key `ta_weekly_summary_v2_YYYY-MM-DD`.

- **Weekly stats fixed to ISO week (Monday-based)** (`app/api/weekly-stats/route.ts`):
  - Window now starts at Monday 00:00 in user's timezone (not rolling 7 days).
  - Sessions filtered to `exercises.length > 0` — mirrors the calendar's `INNER JOIN exercise_logs` filter; abandoned/test sessions no longer inflate counts.
  - `totalSessions` deduplicated by `(date, sessionName)` pairs.

- **Training load bars now volume-based** (`app/api/weekly-stats/route.ts`, `components/stats/weekly-stats-hub.tsx`):
  - Bar height scales by total kg volume per day (sum of `ex.volume` across all exercises in the day's session).
  - `WeeklyStatsResponse` days now include a `volume: number` field.
  - A heavy session produces a taller bar than a lighter one; rest days remain a minimal stub.
  - Desktop: `title` attribute on each bar column shows exact volume (e.g. "12,450 kg").
  - Session colour coding retained for identity.

- **Color-coded training load bars** (`components/stats/weekly-stats-hub.tsx`):
  - Each session segment coloured by `getPaletteEntry(pos).dotClass` keyed by session position.
  - `nameToPos` map built from `sessions` prop (from active program); hash fallback for unrecognised names.
  - Legend below bars shows session name + colour dot.
  - `isToday` now matches `day.dateKey === todayKey` (not index position).

- **AI chat suggestions cleaned up** (`components/chat.tsx`):
  - Replaced hardcoded `SESSION_SUGGESTIONS` keyed by Push/Pull/Legs with `getSessionSuggestions()` returning generic data analysis prompts.

- **Compact muscle diagram** (`components/workout/exercise-stats-sheet.tsx`, `components/muscle-heatmap.tsx`):
  - `compact` prop added to `MuscleHeatmap` — hides "Front"/"Back" labels and legend.
  - Mini diagram uses `w-16 flex-none` width constraint (SVG scales via `[&_svg]:w-full [&_svg]:h-auto`).
  - Secondary muscle pills styled amber (`#f59e0b` tint), matching SVG heatmap secondary colour.

- **Hip thrust GIF overrides** (`lib/exercise-gif-matcher.ts`):
  - `DIRECT_URL_OVERRIDES` entries added for `"hip thrust"`, `"barbell hip thrust"`, `"single leg hip thrust"`, `"single leg barbell hip thrust"` → correct GIF paths in the dataset.

- **Readiness score moved to overview/home page** (`components/overview-screen.tsx`) — removed from stats.

**Build fix:**
- `buildBodyMetricsSummary` in `ai-chat/route.ts` was missing the new `tz` parameter — caused `Type error: Expected 2 arguments, but got 1` build failure. Fixed same session.

**Known issues / notes:**
- DB cache (`exercise_gif_cache`) must be cleared for hip thrust variants if previously cached with the wrong URL:
  ```sql
  DELETE FROM exercise_gif_cache WHERE lower(exercise_name) IN ('hip thrust','barbell hip thrust','single leg hip thrust','single leg barbell hip thrust');
  ```

---

### Session 36 — Exercise GIF Library & AI Chat Context Truncation (2026-05-30)

**What changed:**

- **`lib/data/postgres/migrations/018_exercise_gif_cache.sql`** — new `exercise_gif_cache` table: `exercise_name` (PK), `gif_url`, `image_url`, `fetched_at`. Shared across users, auto-applied by `ensureSchema` on cold start.

- **`app/api/exercise-gif/route.ts`** — GET, auth-gated. Checks `exercise_gif_cache` via `ilike` first. On cache miss, fetches `exercises.json` from the forked dataset (`nekodas-neko/exercises-dataset`) into a module-level in-memory Map (fetched once per server process). Fuzzy-matches incoming exercise name against dataset names using: exact → substring → Jaccard word-overlap on non-equipment core words (threshold 0.5). Caches result (including null for no-match) by our exercise name, so all future requests are pure DB hits. Returns `{ gifUrl, imageUrl }`. No API key needed.

- **`components/workout/exercise-stats-sheet.tsx`** — fetches GIF + image URL in parallel with history. Shows JPEG thumbnail immediately on open; preloads animated GIF in the background via a hidden `<img>`; swaps to GIF once loaded. `ExerciseMedia` sub-component handles the progressive load.

- **`components/workout/warmup-screen.tsx`** — fetches media for all session exercises in parallel on mount. Exercise strip shows JPEG thumbnail (fast) per exercise. Falls back to 🏋️ placeholder if no match found.

- **`app/api/google-sheet/route.ts`** — AI chat context tightened:
  - Body metrics fetch narrowed from 30 → 14 days
  - Workout history: last 15 sessions keep full per-set detail; sessions 16–50 become compact one-line summaries (name + peak weight)
  - 10,000-char hard cap on combined training data blob
  - Per-history-entry content capped at 2,000 chars before sending

**Known issues / notes:**
- Dataset is licensed non-commercial/educational only — fine for personal use
- Exercise name fuzzy matching works well for standard gym exercises; very custom names may not match (graceful null fallback)
- Dataset JSON (~200 KB) is fetched from GitHub raw on first request after each server cold start and held in memory; subsequent requests use the in-memory index

---

### Session 35 — Morning Briefing & Recovery Strip Polish (2026-05-30)

**What changed:**

- **Morning briefing** (`app/session-select/session-select-content.tsx`) — removed static card from home feed. Now auto-opens as a bottom `Sheet` on first visit each day. Dismissed with "Got it" button. Seen state stored in `localStorage` keyed by local date (`ta_morning_briefing_seen_YYYY-MM-DD`).

- **Briefing date key** — was using `new Date().toISOString().slice(0,10)` (UTC), which meant the briefing wouldn't reset until 10am AEST. Fixed to use `formatInTimeZone(new Date(), deviceTz, "yyyy-MM-dd")` so it resets at local midnight.

- **Muscle recovery marquee** (`components/workout/muscle-recovery-card.tsx`) — replaced horizontal scroll (unreliable touch-scroll on Android) and wrapping grid (too tall) with a CSS `ta-marquee` keyframe animation. Pills duplicate and cycle via `translateX(0 → -50%)`. Speed scales with muscle count (~2.5s per pill, min 8s).

- **Session-filtered pills** (`app/workout-select/workout-select-content.tsx`) — added `sessionRecoveryMuscles` memo that filters `recoveryMuscles` to only muscles in the current session's `muscleActivations`. Strip updates automatically as the user swipes between sessions. No hardcoded names — filtering is by muscle identity from the exercise library.

- **Recovery data cached** — replaced plain `fetch` with `cachedFetch` (`TTL_LONG`) and seeded from `readCacheSync` in `useLayoutEffect`. Pills appear instantly on return visits.

- **CLAUDE.md cleanup** — removed all stale Google Sheets references: stack section, columns A–N workout schema, `lib/google-sheets-client.ts` / `lib/sheet-cache.ts` / `lib/progression-styles.ts` / `lib/workout-templates.ts` from key files table, Sheets-based progression styles description, stale violations list. Replaced with accurate PostgreSQL/Drizzle data model, current key files, correct env vars including `DATABASE_URL`.

**Known issues / notes:**
- ~~`SESSION_TO_TAB` in `components/workout/utils.ts`~~ — removed; no longer present in source (verified session 104).
- Recovery API only includes muscles with library entries that have `main` muscle assignments; exercises without library data won't contribute

---

### Session 34 — Recovery Estimator, Exercise Filters, Morning Briefing (2026-05-30)

**What changed:**

- **Post-deploy bug fixes (v1.1.1):**
  - `lib/admin.ts` — `requireAdmin()` now accepts optional `isAdmin` param; bypasses DB lookup when JWT carries the flag
  - `auth.config.ts` / `auth.ts` — `isAdmin` stamped into JWT at login and propagated to `session.user.isAdmin`
  - `app/api/admin/*/route.ts` — all admin routes now pass `session.user.isAdmin` to `requireAdmin`, eliminating extra DB query per request
  - `app/api/day-log/route.ts` — calendar start time fixed: `toZonedTime` (AEST) replaces server-UTC `setHours(0,0,0,0)` for `isRealStart` check
  - `app/stats/stats-content.tsx` — weekly digest uses `<AiResponse>` (ReactMarkdown) instead of plain `<p>` so Gemini markdown renders
  - `types/next-auth.d.ts` — `isAdmin` added to Session, User, and JWT interfaces
  - Admin badge on home screen profile avatar (pending user count)
  - Mood check-in button added to recommendation card header

- **ACWR + Sleep vs Performance cards moved to Health page** (`app/health/health-content.tsx`), removed from Stats.

- **`app/api/muscle-recovery/route.ts`** (new) — GET, auth-gated. Fetches last 7 days of workout sessions + exercise library. Cross-references exercise names → muscle groups. Applies exponential recovery curve (τ=36h for heavy volume ≥3000 kg, τ=24h light). Returns sorted `MuscleRecoveryEntry[]`.

- **`components/workout/muscle-recovery-card.tsx`** (new) — Horizontal scrolling chip row. Colour-coded: green ≥80%, amber ≥50%, red <50%. Returns null when no data.

- **`app/workout-select/workout-select-content.tsx`** — `MuscleRecoveryCard` added below muscle heatmap; fetches `/api/muscle-recovery` on mount.

- **`app/api/morning-briefing/route.ts`** (new) — GET, auth-gated. Fetches sleep (2d), body metrics (7d), workout sessions (2d), readiness recommendation in parallel. Calls Gemini `gemini-3.1-flash-lite` via `generateText`. Returns `{ briefing: string, generatedAt: string }`. Prompt: 2–3 sentences, plain prose, 1–2 emojis, no markdown.

- **`app/session-select/session-select-content.tsx`** — Morning Briefing card added after Readiness card. Cached in `localStorage` by ISO date key (`ta_briefing_YYYY-MM-DD`).

- **`components/stats/exercise-library-search.tsx`** — Removed hardcoded `FILTERS = ["All", "Push", "Pull", "Legs", "Core"]`. Now accepts `sessions: ProgramSession[]` prop. Filter tabs derived from session names; filtering by exercise→session membership map built at render time.

- **`app/stats/stats-content.tsx`** — passes `sessions={sessions}` to `<ExerciseLibrarySearch>`.

**Known issues / notes:**
- Muscle recovery card requires exercise library to have muscle group metadata populated — shows empty if library has no muscle data
- Morning briefing only generated once per day (localStorage cache); manual cache clear needed to regenerate same day

---

### Session 33 — Tier 1–3 Feature Batch (2026-05-30)

**What changed:**

- **`app/api/admin/pending-count/route.ts`** (new) — returns count of inactive users for admin badge
- **`app/profile/profile-content.tsx`** — admin badge on Admin Console row; program week stat in stats strip; `/api/program-week` fetch
- **`app/api/program-week/route.ts`** (new) — returns weeks since first workout on active program
- **`lib/data/postgres/adapter.ts`** — added `getFirstWorkoutDateForProgram`, `getPersonalRecord`, `upsertPersonalRecord` methods
- **`lib/data/repository.ts`** — added signatures for new adapter methods
- **`lib/data/postgres/schema.ts`** — added `personalRecords` table
- **`lib/data/postgres/migrations/017_personal_records.sql`** (new) — `personal_records` table (auto-applied by `ensureSchema`)
- **`app/api/log-exercise/route.ts`** — accepts `workoutStartedAt` (uses real start time for session); detects and returns `isPR` for new 1RM PRs
- **`app/api/day-log/route.ts`** — uses real `startedAt` for workout duration when available
- **`components/workout-screen.tsx`** — sends `workoutStartedAt`; tracks `newPRs` and passes to DoneScreen
- **`components/workout/done-screen.tsx`** — gold trophy card listing new PRs
- **`components/workout/exercise-stats-sheet.tsx`** — all-time 1RM shown from history
- **`app/api/google-sheet/route.ts`** — truncates conversation history to 20 turns, workout history to 50 sessions
- **`app/health/health-content.tsx`** — lean mass chart (weight × (1 − BF%)) on Body tab
- **`app/api/training-load/route.ts`** (new) — ACWR from 7-day vs 28-day volume
- **`app/api/readiness-score/route.ts`** (new) — composite 0–100 score from sleep, HRV, RHR, ACWR
- **`app/api/sleep-performance-correlation/route.ts`** (new) — avg 1RM bucketed by prior-night sleep duration
- **`app/api/weekly-digest/route.ts`** (new) — Gemini-generated weekly summary (POST, cached in localStorage by month key)
- **`app/session-select/session-select-content.tsx`** — readiness score card; FALLBACK_SESSIONS removed
- **`app/stats/stats-content.tsx`** — ACWR card, sleep correlation card, weekly digest card; FALLBACK_SESSIONS removed
- **All hardcoded Push/Pull/Legs violations removed** across `utils.ts`, `weights-summary.tsx`, `ai-chat-overlay.tsx`, `config-screen.tsx`, `overview-screen.tsx`, `calendar-widget.tsx`, `history-content.tsx`, `workout-select-content.tsx`

**DB migration needed on Railway:**
```sql
-- 017_personal_records.sql (auto-applied by ensureSchema on next cold start)
CREATE TABLE IF NOT EXISTS personal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  estimated_1rm DOUBLE PRECISION NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);
```

**Known issues / notes:**
- Readiness score card requires ≥5 days of HRV or RHR baseline data — hidden until then
- Sleep correlation requires 90+ days of paired sleep + workout data with 3+ sessions per bucket
- ACWR hidden until 28-day chronic average exceeds 100 kg volume

---

### Session 32 — Fix AI chat chart gap (2026-05-30)

**What changed:**

- **`components/chart-message.tsx`** — switched from `aspectRatio: 1.8` (unreliable in flex bubble context) to `maintainAspectRatio: false` with an explicit `position: relative; height: 200px` wrapper div. This is the Chart.js-recommended pattern for charts embedded in fixed-height containers and eliminates the large gap that appeared between the chat text and the chart visual.
- **`components/chat.tsx`** — charts moved from a separate block rendered after `</Message>` into the `MessageContent` bubble (so they appear inline within the assistant message, not as a floating element below it).
- **`components/ai/response.tsx`** — `size-full` (= `width:100%; height:100%`) on the Response wrapper div changed to `w-full`. The `height:100%` was redundant in the block layout context inside the chat bubble.

All changes deployed to `main`.

---

### Session 31 — Gemini model updated to 3.1 Flash Lite (2026-05-30)

**What changed:**
- `app/api/google-sheet/route.ts` + `components/chat.tsx` — switched from `gemini-2.5-flash` to `gemini-3.1-flash-lite`. Newer generation model with ~1,500 RPD free tier vs ~250 RPD on 2.5 Flash, and meaningfully lower per-token cost. Model ID confirmed valid.
- `CLAUDE.md` — removed "unverified" note; updated to reflect confirmed model.

---

### Session 30 — Workout Select: Animated Single-Card Carousel, Fixed Muscle Diagram (2026-05-29)

**What changed:**

- **`app/workout-select/workout-select-content.tsx`** — complete rewrite. Replaced the infinite carousel strip (tripled array + MotionValue y + scroll teleporting) with a single static card. Swiping changes session via `currentIdx` state; direction state drives `AnimatePresence` slide variants on the header only.
- **Session header** slides in from the swipe direction (up = enter from top; down = enter from bottom) using `AnimatePresence mode="popLayout"` with `slideVariants`. Start button fades in/out separately.
- **Muscle diagram** stays fully mounted at all times. `AnimatePresence` removed from the heatmap section entirely — `MuscleHeatmap` is prop-driven so activated muscle colours update in place when the session changes. No fade, no disappear.
- **Layout stability** — dot indicator row given a fixed `height: 24` so the flex-1 card above never resizes when the active dot grows from 6px to 20px. Header container given `minHeight: 3.5rem` with `mode="popLayout"` so exiting content is removed from flow immediately, preventing the muscle diagram from shifting.
- **Raw touch gesture** — swipe up (next) / swipe down (prev) with 50px threshold or 0.2 px/ms flick detection. Haptic feedback on each session change via `navigator.vibrate(8)`.
- **Chart.js sparklines** (`components/ui/sparkline-chart.tsx`) — new reusable component replacing hand-rolled SVG in exercise stats sheet and exercise summary screen. Shows last value as a label above the final dot. Brand colour resolved from CSS custom property via 1×1 canvas `getImageData`.
- **`lib/health-connect-sync.ts`** — fixed Railway build failures from patched HC record types (`BodyFat`, `Nutrition`, `HeartRateVariabilitySdnn`, `OxygenSaturation`) not in the official `RecordType` union; widened `canRead` to `Set<string>` and added `as any` casts on affected `readRecords` calls.
- **`CLAUDE.md`** — added Package Management section (always use `pnpm`, not `npm`) and a note to prefer pre-made libraries (`motion`, `@use-gesture/react`, `react-chartjs-2`, `@dnd-kit`) over hand-rolling UI.

**Workout select screen is now in final form.**

---

### Session 29 — UI Fixes: Home, Stats, Workout Screens, Health Biometrics (2026-05-29)

**What changed:**

- **Home — "Day X" badge removed** (`session-select-content.tsx`): Badge showed `position + 1` (program order), not the week day — confusing. Removed.
- **Home — Sleep split-midnight merging** (`app/api/sleep-sessions/route.ts`): Samsung Health records a single night as two sessions when sleep spans midnight. API now groups by wake-up `date` and sums durations + stages before returning.
- **Home — Steps not updating** (`lib/health-connect-sync.ts`): HC aggregate returning 0 early in the day was overwriting real step counts via COALESCE. Now skips writing steps when the aggregate value is zero.
- **Stats — AVG DURATION** (`app/api/weekly-stats/route.ts`): `startedAt` is midnight AEST, not actual workout start — caused ~548 min averages. Now computed from first→last exercise `loggedAt` timestamps.
- **Workout — ExerciseStatsSheet padding** (`components/workout/exercise-stats-sheet.tsx`): Exercise name was flush against the border (`px-1`). Fixed to `px-4`.
- **Workout — Rep targets weight**: Shows next recommended weight (progression style × 1RM), not last logged weight. Reverted an incorrect earlier fix.
- **Workout — Warmup screen scroll** (`components/workout/warmup-screen.tsx`): Reduced `py-5 space-y-5` → `py-3 space-y-3` to eliminate slight scroll on S25 Ultra.
- **Workout — Ready screen scroll** (`components/workout/active-workout-screen.tsx`): Reduced `gap-5` → `gap-3`, removed `justify-center`, tightened card padding — eliminates scroll.
- **Health — Clickable biometric cards**: Body Weight, Body Fat, Steps, Sleep cards now all open a detail sheet (`components/health-metric-sheet.tsx`) with a trendline + full reading history.
- **Health — New biometric pills**: 3-up row added for Resting HR (red), HRV (orange), SpO₂ (cyan). All tappable with detail sheets.
- **SpO₂ full pipeline**: Migration `016_spo2.sql`, schema, types, adapter, HC sync (`OxygenSaturation` permission + overnight mean), sync-health route, body-metadata API — all wired end to end.
- **`listBodyMetrics` fix** (`lib/data/postgres/adapter.ts`): Was silently dropping `restingHeartRate`, `hrvMs` from SELECT return. Now included.

**Known bugs noted (not yet fixed):**
- Timer bleed: starting a new session while one is in progress carries over the running timer — Zustand store not reset on fresh session start.
- Mood check-in should move from pre-workout screen to warmup screen.

**DB migration needed on Railway:** `016_spo2.sql`
```sql
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS spo2_pct DOUBLE PRECISION;
```

---

### Session 28 — Bug Fixes: day-log index, useFor1rm default, chat deps (2026-05-28)

**What changed:**

- **`app/api/day-log/route.ts`**: Fixed index mismatch in workout duration calculation. The filtered `times[]` array was being indexed against the unfiltered `ws.exercises[]` array, causing `timeToComplete` from the wrong exercise to be applied when some exercises had no `loggedAt`. Fixed by pairing `loggedAt` time and `timeToComplete` together before filtering.
- **`app/api/log-exercise/route.ts`**: `useFor1rm` defaulted to `false` on the server but `true` on the client. For exercises without a progression style, sets were being stored with `useFor1rm: false` even though the 1RM calculation correctly used them. Aligned server default to `true`.
- **`components/chat.tsx`**: `CHAT_KEY` is a module-level constant but was included in 7 `useEffect`/`useCallback` dependency arrays, causing exhaustive-deps lint warnings. Removed from all dep arrays.

**Infrastructure note:**
- Migration `015_set_timing.sql` confirmed applied to Railway production DB.

---

### Session 27 — Workout Flow Rework + State Persistence (2026-05-28)

**Goal:** Rework the exercise flow into one continuous session with a visible timer, fix the mid-workout state loss bug (Railway redeploy / Android WebView eviction), and capture per-set epoch timestamps for HR correlation.

**What changed:**

- **Zustand persist store** (`lib/stores/workout-store.ts`): All workout state (mode, timestamps, set counts, weights, etc.) now lives in a single Zustand store persisted to `localStorage` under `ta_workout_state`. A page reload mid-session restores exactly where the user was, including `workoutStartMs`, so session duration is always accurate.
- **`components/workout-screen.tsx`**: Replaced ~20 `useState` + 5 `useRef` values with store reads/writes. Two derived intervals drive `sessionElapsedSec` (from `workoutStartMs`, runs from warmup onwards) and `exerciseElapsedSec` (from `exerciseStartMs`, only during active sets).
- **Session timer in header**: `sessionElapsedSec` passed to all child screens — warmup, ready screen, active sets, exercise summary. Displays as a `MM:SS` readout in brand colour.
- **Warmup weights moved to ready screen** (`components/workout/active-workout-screen.tsx`): The 50%/60%/70% warmup strip now appears on the per-exercise ready screen (before "Begin Exercise"), not during active sets. Hidden in solo re-do mode.
- **Exercise pills → stats sheet** (`components/workout/pre-workout-screen.tsx`, `components/workout/exercise-stats-sheet.tsx`): Tapping any exercise pill on the pre-workout list now opens a read-only stats bottom sheet instead of launching a solo workout. Sheet shows: last performance, 1RM rep targets table (reps needed to fall below / match / beat current 1RM at working weight, via Epley), 1RM sparkline, and muscle map. The re-do button on done exercises remains.
- **Per-set epoch timestamps**: `setStartMsArray` and `setEndMsArray` tracked in store; sent to `/api/log-exercise` as `setStartTimes` / `setEndTimes`. Inter-exercise rest (`interExerciseRestSec`) computed from `lastExerciseEndMs` → `exerciseStartMs` and sent on each log call.
- **DB migration** `lib/data/postgres/migrations/015_set_timing.sql`: Adds `set_start_ms BIGINT` and `set_end_ms BIGINT` to `set_logs`; `inter_exercise_rest_sec INTEGER` to `exercise_logs`. **Must be applied to Railway Postgres manually** (safe to run with `IF NOT EXISTS`).
- **`lib/data/postgres/schema.ts`** + **`lib/types/log.ts`** + **`lib/data/postgres/adapter.ts`**: Schema, types, and adapter updated to write new columns.

**Bug fixed:** Mid-workout page reload (Railway auto-deploy or Android WebView eviction) previously reset all React state, causing: (a) duration counting only from the restart point; (b) brand colour reverting to green. Both are now fixed — Zustand rehydrates the full state from `localStorage` on mount.

**Known issue — DB migration:** The migration has NOT been applied to Railway yet. Run `015_set_timing.sql` against the production database. App functions normally without it (new columns just won't be written).

---

### Session 26 — HRV + Resting Heart Rate Sync from Health Connect (2026-05-27)

**Goal:** Start collecting HRV and resting heart rate baseline data from Health Connect immediately so there is 30–90 days of data available when a future energy score feature is implemented.

**What changed:**
- Migration `014_hrv_resting_hr.sql`: adds `resting_heart_rate INTEGER` and `hrv_ms DOUBLE PRECISION` to `body_metrics` table
- `lib/data/postgres/schema.ts` + `lib/types/body.ts`: both columns added to Drizzle schema and `BodyMetrics` interface
- `lib/data/postgres/adapter.ts`: `upsertBodyMetrics` now inserts and COALESCEs both new fields alongside existing ones
- `lib/health-connect-sync.ts`:
  - Added `'HeartRate'` and `'HeartRateVariabilitySdnn'` to `requestPermissions` (manifest permissions were already declared in Session 22)
  - Resting heart rate: reads all HeartRate records in sync window; for each, if the local hour is 0–7 (midnight–8am), tracks the minimum BPM per date and stores as `restingHeartRate`
  - HRV: reads all HeartRateVariabilitySdnn records; same midnight–8am overnight window; takes the mean SDNN per date and stores as `hrvMs`
- `app/api/sync-health/route.ts`: passes `restingHeartRate` and `hrvMs` from payload through to `upsertBodyMetrics`

**Why overnight window (midnight–8am):** Resting heart rate and HRV are most reliable when the body is still — overlapping with deep sleep. This matches Samsung's Galaxy Watch approach of capturing overnight biometrics for the morning "energy score" readout.

**Nothing visible in the UI yet** — data accumulates silently in `body_metrics`. The energy score feature (which uses 30–90 day rolling baselines of sleep quality, HRV, resting HR, and recent training load) is planned as a future feature once sufficient baseline data exists.

---

### Session 25 — Bug Fixes: Streak, Recommendation, Steps, Mood, Warmup Screen (2026-05-27)

**Streak showing "—" when rest day yesterday + not yet trained today (`app/session-select/session-select-content.tsx`):**
- Root cause: streak loop started at `ago=0` (today), so an untrained today + rest yesterday = 2 consecutive rest days → streak broke immediately at any point before training.
- Fix: today counted only if already trained; loop walks back from yesterday (`ago=1`). Streak stays visible until end of day.

**Recommendation showing the already-done session instead of next in rotation (`lib/data/postgres/adapter.ts`):**
- Root cause: `recentWsWithName` query had no exercise-log filter — orphaned workout sessions (screen opened but no sets logged) were counted as "session done", skewing the most-overdue sort.
- Fix: added `EXISTS (SELECT 1 FROM exercise_logs WHERE ...)` subquery, matching the same guard used by `getCalendarData`. Only sessions with at least one logged exercise now influence the recommendation.

**Steps widget/tile showing yesterday's count in the morning (`app/session-select/session-select-content.tsx`, `app/health/health-content.tsx`):**
- Root cause: fallback `metaRecent.find(r => r.steps != null)?.steps` silently surfaced yesterday's steps when today had no row yet. Weight/body-fat fallback is correct (persistent metrics); steps/calories/distance reset daily.
- Fix: removed fallback for daily-reset metrics (`steps`, `calories`, `distanceKm`) in both the home screen widget + metric tile and the health page. Shows "—" until today's Health Connect sync writes a row.

**Mood sheet pre-filling with yesterday's values in the morning (`components/workout/pre-workout-screen.tsx`):**
- Root cause: mood fetch used `new Date().toISOString().slice(0, 10)` (UTC date) — before 10am AEST this is yesterday's date, returning yesterday's mood log and pre-filling the sheet.
- Fix: changed to `localDateString()` (device local date), matching the same approach used in `session-select-content.tsx`.

**Warmup screen with session timer (`components/workout/warmup-screen.tsx`, `components/workout-screen.tsx`, `components/workout/types.ts`, `components/workout/pre-workout-screen.tsx`):**
- Added `"warmup"` mode to `WorkoutMode` between `"pre"` and `"active"`.
- "Start Workout" button now sets `workoutStartRef.current = Date.now()` immediately (before any exercise is loaded) and transitions to the warmup screen instead of jumping straight to exercise 1.
- Warmup screen shows: elapsed session timer (counts up from press of Start Workout), heatmap of all session target muscles, primary muscle focus chips, and 3 general warmup cues.
- "Begin Exercises" calls `launchExercise(0, false)` — the lazy-init guard in `launchExercise` leaves `workoutStartRef` untouched since it's already set, preserving the pre-warmup timestamp.
- Back from warmup resets `workoutStartRef` to null and returns to pre-workout list.
- Lays groundwork for storing actual workout `startedAt` (pre-warmup time) in `workout_sessions` — the server-side wiring (`log-exercise/route.ts` accepting `workoutStartedAt`, `day-log/route.ts` using `session.startedAt` for duration) is not yet implemented.

**Known bugs identified but not yet fixed (documented for next session):**
- `app/api/day-log/route.ts:83` — index mismatch when computing workout end time: `times` is filtered by `e.loggedAt` but `ws.exercises[i]` uses the filtered index on the unfiltered array. Gives wrong `timeToComplete` for sessions where some exercises have no `loggedAt`.
- `workout-screen.tsx:328` vs `log-exercise/route.ts:134` — `useFor1rm` defaults to `true` on client, `false` on server. Affects stored `set_logs` rows for exercises without a progression style.

---

### Session 24 — Home Section Drag-to-Reorder, Body Fat Card, Workout Screen Mockups (2026-05-27)

**Home screen drag-to-reorder (Task D):**
- All 5 home screen sections (Recommendation, Streak + This Week, Week Strip, Card Widgets, Metric Tiles) are individually draggable using `@dnd-kit/react@0.4.0`
- Long-press (300ms delay via `PointerActivationConstraints.Delay`) activates drag — avoids conflicting with vertical scroll
- Edit mode toggle: grid icon in header shows/hides grip handles on each section
- Order persisted in `localStorage` under `ta_home_section_order`; missing keys appended to end on load
- New `components/home-sortable-section.tsx` wraps each section with `useSortable` from `@dnd-kit/react/sortable`
- `@dnd-kit/dom@0.4.0` added as explicit direct dependency (was transitive-only, caused TypeScript build error)
- Activation constraint wrapped in array to match `ActivationConstraints<E>[]` type

**Body fat trend card on Health > Body tab (Task E):**
- Purple (`#bf5fff`) accent card added after the weight sparkline
- Shows latest BF%, delta from oldest reading (chip coloured red/green), and SVG area chart with gradient fill
- Only renders when 2+ BF readings exist; single reading shows value without chart/delta
- `bodyFat` field already existed in `BodyMetaRow` — no API changes needed

**Week strip interactivity + exercise history drill-down (Task A carry-over):**
- Week strip day boxes converted to buttons; tap fetches `/api/day-log` and opens a Sheet overlay showing exercises, body metrics, and workout duration
- Exercise rows in the day overlay are tappable — opens `ExerciseHistorySheet` showing 1RM progression chart for that exercise

**Streak fix:**
- Streak counter was showing 6 instead of 8 for a 3on/1off/3on pattern
- Root cause: loop only incremented `count` for training days, skipping rest days inside the streak window
- Fix: `count += 1 + consecutiveRest` when a training day is found, folding preceding rest days in

**Active workout screen mockups:**
- `/workout-mockup` page (no auth) shows three redesigned screen states in a phone frame with tab switcher
- **Ready:** gradient hero header, set targets card with weight bars showing % of 1RM, 1RM trend chart, muscle chips
- **Active Set:** progress dots, current set as full hero card with large +/− weight/rep controls, done sets collapse to compact green chips, upcoming sets dimmed
- **Rest Timer:** full-screen circular countdown as hero (tap to skip), next set weight/reps/intensity preview card, ghost-style "Start early" CTA
- Design notes saved to `design-mockups/active-workout-screens.md`

---

### Session 23 — Mood Tracker, Sleep/Steps/Mood Home Widgets, Health Page Colors, Profile Uplift (2026-05-27)

**Mood tracker:**
- New `mood_logs` table (`lib/data/postgres/migrations/013_mood_logs.sql`) with energy_level, sleep_quality, body_state[], sore_muscles[], UNIQUE(user_id, log_date)
- `lib/types/mood.ts` — `EnergyLevel`, `SleepQuality`, `BodyState`, `MoodLog` types
- `getMoodLog`, `saveMoodLog` (upsert), `countWorkoutSessions` added to repository interface + Postgres adapter
- `/api/mood` GET/POST — daily check-in upsert, auth-gated
- `components/mood-checkin-sheet.tsx` — bottom sheet with energy emoji picker (5 options), sleep quality chips, body state multi-select, sore muscles picker with overlap warning when sore muscles match session's trained muscles
- Pre-workout screen (`components/workout/pre-workout-screen.tsx`) — banner shows mood prompt (not logged) or compact summary (logged); opens check-in sheet

**Home screen widgets (3 new, toggleable via Profile → Home Widgets):**
- **Sleep** 🌙 — last night's duration vs goal + colored stage bar (Deep/REM/Light/Awake in indigo/purple/violet/amber)
- **Steps** 👣 — today's steps vs goal with progress bar + 7-day bar chart
- **Mood** 💭 — today's energy/sore summary or prompt to log; taps to open check-in sheet
- All three added to `CARD_WIDGET_DEFS` in both `session-select-content.tsx` and `profile-content.tsx`
- Sleep data fetched via `cachedFetch` from `/api/sleep-sessions`; steps/sleep goals loaded from localStorage (`ta_steps_goal`, `ta_sleep_goal_hours`)

**Health page colors (`app/health/health-content.tsx`):**
- Green gradient + glow blob for Body Weight, cyan for Steps, purple for Sleep, orange for Nutrition macro card

**Profile uplift (`app/profile/profile-content.tsx`):**
- Stats strip after hero: Workouts (live from DB via `countWorkoutSessions`), Weight Goal, Member Since
- Goals section: Weight Goal, Daily Steps Goal (localStorage), Sleep Goal (localStorage)
- `workoutCount` now live — added to `/api/user/profile` GET response alongside user data

---

### Session 22 — Local SQLite: Offline-First Workout Logging + Instant Page Loads (2026-05-27)

**Goal:** APK works fully offline for workout logging; all data-heavy pages load instantly from local cache on second open.

**Native plugin (`@capacitor-community/sqlite@8.1.0`):**
- Added to `package.json`, `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`
- APK rebuilt and deployed — native SQLite layer baked in, all subsequent JS changes are over-the-air

**Health Connect permissions (`android/app/src/main/AndroidManifest.xml`):**
- Added all future-proofing READ permissions: Steps, Distance, CaloriesBurned, Heart Rate, HRV, SpO2, Sleep, Weight, BodyFat, Nutrition, Hydration, VO2Max, and background/history reads
- Declaring ≠ granting — user prompted at runtime when each feature is first used

**PostgreSQL (`lib/data/postgres/migrations/012_updated_at.sql`):**
- Added `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` to `workout_sessions`, `exercise_logs`, `set_logs`
- Idempotent (`IF NOT EXISTS` guards)

**PostgreSQL adapter (`lib/data/postgres/adapter.ts`, `lib/data/repository.ts`):**
- `ensureWorkoutSession(userId, sessionId, programSessionId, sessionName, startedAt)` — upserts with `ON CONFLICT DO NOTHING` so client-generated UUIDs merge cleanly
- `logExerciseWithId(log)` — idempotent exercise insert for sync replay

**`/api/sync-workout` (`app/api/sync-workout/route.ts`):**
- POST endpoint accepting `SyncItem[]` batches from the outbox drain
- For each item: `ensureWorkoutSession` → `logExerciseWithId` → `logSets`
- Auth-gated; returns `{ synced: N }`

**SQLite service layer:**
- `lib/sqlite/sqlite-service.ts` — lazy plugin import, `_initPromise` singleton, `isSQLiteAvailable()` guard (native only), `runSQL` / `querySQL`
- `lib/sqlite/migrations.ts` — v1: `workout_sessions`, `exercise_logs`, `set_logs`, `sync_outbox`, `sync_meta`; v2: `api_cache` (key, data TEXT, cached_at, expires_at)
- `lib/sqlite/outbox.ts` — `writeLocalWorkout(payload, synced)`, `addToOutbox(payload)`, `drainOutbox()` (POSTs to `/api/sync-workout`, deletes on success, leaves intact on failure)
- `lib/sqlite/cache.ts` — `getCached<T>(key)`, `setCached<T>(key, data, ttlSeconds)`, `invalidateCache(keyPrefix)`, `cachedFetch<T>(key, url, ttl, onData)` helper (stale-while-revalidate: calls `onData` with cached value immediately, then again with fresh API data)

**Offline-first workout logging (`components/workout-screen.tsx`):**
- `workoutSessionIdRef` now pre-seeded with `crypto.randomUUID()` at component mount (was `null` until first API response)
- `handleCompleteSet` computes `estimated1rm`, `target80`, `volume`, `avgReps`, `intensityPct` client-side before touching the network
- Calls `writeLocalWorkout(payload, false)` first — local SQLite write always succeeds offline
- Tries API; on success: `writeLocalWorkout(payload, true)` to mark synced; on failure: `addToOutbox(payload)` — outbox drains on next app open
- UI state updates (summary screen, log count, session log) happen regardless of network outcome — no error toast for offline logging

**SyncProvider + cache warming (`components/sync-provider.tsx`, `app/layout.tsx`):**
- `<SyncProvider />` mounts once in layout alongside other side-effect components
- On mount: `initSQLite(MIGRATIONS)` → `drainOutbox()` → warm 9 API caches sequentially
- Cache keys and TTLs: `body-metadata` / `sleep-sessions` / `weekly-stats` / `weights-summary` (30 min); `next-session` (5 min); `workout-data:meta` / `progression-styles` / `workout-templates` / `exercise-library` (6 h)
- TTL constants exported (`TTL_SHORT`, `TTL_MEDIUM`, `TTL_LONG`) so pages use the same values

**Stale-while-revalidate on all data-heavy pages:**
- `components/overview-screen.tsx` — `weights-summary`, `body-metadata`, `workout-data:meta`
- `app/health/health-content.tsx` — `body-metadata` + `sleep-sessions` (parallel)
- `app/session-select/session-select-content.tsx` — `body-metadata`, `workout-data:meta`, `next-session`
- `app/history/history-content.tsx` — `workout-data:meta`
- `components/config-screen.tsx` — `progression-styles`, `workout-templates`, `exercise-library` (parallel)
- `components/chat.tsx` — `weights-summary`
- Pattern: spinner suppressed if cache hit; API refreshes silently in background; PWA is unaffected (all cache functions are no-ops when `isSQLiteAvailable()` returns false)

---

### Session 21 — UI Fixes: Calendar/Home Widgets, Safe Area, Muscle Heatmap, Workout Compactness (2026-05-26)

**Safe area padding (`app/globals.css`, 7 files):**
- Added `pt-safe` utility: `padding-top: max(1rem, env(safe-area-inset-top, 0px))` — clears Android status bar while guaranteeing at least 16px minimum. Previously only `pb-safe` was defined.
- Applied `pt-safe` to all screen headers: `stats`, `profile`, `history`, `workout-select`, `health`, `overview-screen`, `config-screen`, `active-workout-screen`. Fixed a class-ordering conflict where `pt-safe pt-4` was a no-op (later class wins in Tailwind v4) — removed redundant `pt-4` from all affected headers.

**Session recommendation fix (`lib/data/postgres/adapter.ts` — `getNextSession`):**
- **Timezone bug**: replaced `Date.now() - i*86400000` with `todayMidnightUtc(tz)` — date arithmetic is now relative to local midnight in the user's timezone, not UTC-now. Fixes "yesterday" being the wrong day near AEST midnight.
- **Stale FK bug**: the `perSession` JOIN used `workout_sessions.session_id` FK which becomes stale after program edits/renames. Replaced with a name-based in-memory lookup: fetch 30 recent sessions by `sessionName` column, build `sessionLastDone` map via case-insensitive name match, sort sessions by last-done ascending for "most overdue" recommendation.
- **Rest-day logic**: rewrote consecutive-day detection to also collect which session types were done in the streak. In default rotation mode, a rest day is suggested once all session types in the program are covered (full cycle complete) — not just after a fixed N-day count. Uses `todayMidnightUtc` throughout.

**Home screen widgets (`app/session-select/session-select-content.tsx`):**
- Added **Weight Trend** card widget: inline SVG sparkline of body weight over last 7 or 30 days (configurable). Taps through to `/health`.
- Added **Nutrition Donut** card widget: macro donut (protein/carbs/fat) from `react-muscle-highlighter` style SVG circles, plus a calorie progress bar against a configurable daily or weekly goal. Shows consumed/goal kcal when a goal is set.
- Both widgets read `BodyMetaRow[]` from `/api/body-metadata` (already fetched for metric tiles).
- Settings stored in `localStorage`: `ta_ss_widgets` (metric tiles), `ta_ss_cards` (card widgets), `ta_calorie_goal_kcal`, `ta_calorie_goal_type` (daily/weekly), `ta_weight_lookback` (7/30).

**Widget picker moved to Profile (`app/profile/profile-content.tsx`):**
- Removed the widget picker Sheet from the home screen entirely (it was referencing undeclared `widgetPickerOpen`/`widgetsExpanded` state — was also a build error).
- Added **Home Widgets** section to Profile page (between Workout Settings and About) with:
  - Card widget toggles (Weight Trend, Nutrition — tap to enable/disable)
  - Metric tile toggles (all 7 tiles — tap to show/hide)
  - Calorie goal input + Daily / Weekly mode selector
  - Weight sparkline lookback selector (7d / 30d)
- All settings write to the same localStorage keys the home screen reads.

**Muscle heatmap overflow + horizontal scroll (`components/muscle-heatmap.tsx`, `app/workout-select/workout-select-content.tsx`):**
- `react-muscle-highlighter` Body SVGs render with a fixed intrinsic width; without containment they overflow the card and cause a horizontal scrollbar on the page.
- Fixed by adding `min-w-0 overflow-hidden [&_svg]:w-full [&_svg]:h-auto` to each grid column div — forces SVGs to scale to column width rather than overflow.
- Reduced grid gap from `gap-8` to `gap-4` to give more width to each diagram column.
- Added `overflow-hidden` to each session card in workout-select to clip any residual overflow past the rounded border.
- Added `body { overflow-x: hidden }` globally in `globals.css` as a safety net.

**Active workout compactness (`components/workout/active-workout-screen.tsx`, `components/workout/set-card.tsx`):**
- Rest timer redesigned from a tall vertical card (~168px: 80px SVG circle stacked above text) to a compact horizontal row (~84px): 60px ring on the left, elapsed/remaining text + progress bar on the right.
- Set cards tightened: done and upcoming cards `p-3` → `p-2.5`; active card `p-4 gap-3` → `p-3 gap-2`. Eliminates vertical scroll during rest with 3–5 sets.

---

### Session 20 — Native Android APK + Health Connect (2026-05-26)

**Capacitor setup:**
- Added `@capacitor/core`, `@capacitor/android`, `@capacitor/browser`, `@capacitor/app` — WebView loads Railway URL so all UI/API changes auto-deploy without APK rebuilds
- `capacitor.config.ts` — `server.url` points to Railway; `android.backgroundColor` set to app dark background
- `android/` project added to repo; `minSdkVersion` bumped to 26 (required by Health Connect)
- App icon generated via `@capacitor/assets` — all mipmap densities + adaptive icon + splash screens

**Health Connect native sync (`lib/health-connect-sync.ts`):**
- `@devmaxime/capacitor-health-connect` v1.1.0 — patched via `pnpm patch` to add `BodyFat` and `Nutrition` record types (Kotlin converters + TypeScript types)
- Syncs: Steps, Distance, TotalCaloriesBurned, Weight, BodyFat, Nutrition macros (protein/carbs/fat), ActivitySession, SleepSession with stage breakdown
- Cold sync: 30 days on first install; hot sync: 7 days on subsequent opens (tracked via `ta_hc_last_sync` localStorage key)
- Returns sync summary `{ metrics, sessions, sleep }` — toasted on screen for debugging (remove when stable)
- `components/health-connect-provider.tsx` — calls sync on app mount, Capacitor-only

**`/api/sync-health` route:**
- Accepts batched HC payload; upserts body metrics, deduplicates exercise sessions, saves sleep sessions
- `lib/data/postgres/migrations/011_sleep_sessions.sql` — new table with `UNIQUE(user_id, sleep_start)`
- `lib/data/postgres/schema.ts` + `lib/types/body.ts` + `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` — full sleep session CRUD

**Google OAuth fix for WebView:**
- Google blocks OAuth in Android WebViews — fixed with Chrome Custom Tab + deep link token exchange
- Flow: tap sign-in → `Browser.open(/mobile-signin)` → OAuth in Chrome Custom Tab → `/auth-mobile-bridge` creates one-time token → `trainingai://auth-complete?token=X` deep link → `MobileAuthHandler` exchanges token → session cookie set in WebView → reload
- New files: `app/mobile-signin/page.tsx`, `app/auth-mobile-bridge/page.tsx`, `app/auth-mobile-bridge/redirect-client.tsx`, `app/api/auth/exchange-mobile-token/route.ts`, `lib/mobile-auth-tokens.ts`, `components/mobile-auth-handler.tsx`
- `android/app/src/main/AndroidManifest.xml` — `trainingai://` intent filter added

**Android back button (`components/mobile-auth-handler.tsx`):**
- Back from any screen navigates through history; back from `/` minimizes app (doesn't close) — same behaviour as Messenger/Instagram

**Health tab wired to real data (`app/health/health-content.tsx`):**
- Body tab: steps reads from `metaToday` with fallback to most recent day
- Nutrition tab: calories, protein, carbs, fat with live donut chart showing macro % split (was fully hardcoded placeholders before)
- Sleep card: last night's total duration + Deep/REM/Light breakdown chips (was "Coming soon")
- `/api/sleep-sessions` route added to serve last 30 days of sleep data

**Build fixes:**
- `pnpm-workspace.yaml` deleted — `patchedDependencies` moved to `package.json` under `pnpm` key
- `packageManager: "pnpm@10.33.0"` pinned to match Railway build environment
- `android/capacitor.settings.gradle` — manually added missing `capacitor-app` and `capacitor-browser` project declarations (cap sync omitted them)

### Session 19 — Performance: Remove Composio, Timezone Fix, Stats Caching (2026-05-26)

**Removed dead packages:**
- `@composio/core` and `@composio/vercel` removed from `package.json` and `pnpm-lock.yaml` — had zero imports in the codebase, were pure dead weight inflating install time

**Timezone overhaul — `lib/date-utils.ts` + `date-fns-tz`:**
- All hardcoded `+10h` AEST offsets replaced with proper `date-fns-tz` calls using IANA timezone strings (`'Australia/Brisbane'`)
- `lib/date-utils.ts` fully rewritten: `aestMidnight`, `toAestDateStr`, `toAestDay`, `todayInTz`, `todayDayOfWeek`, `fmtAest` — all accept an optional `tz` param defaulting to `'Australia/Brisbane'`
- Affected routes: `body-metadata`, `exercise-history`, `weekly-stats`, `next-session`, `health-connect/webhook`, `health-connect/ingest`

**Per-user timezone stored in DB + JWT:**
- Migration `lib/data/postgres/migrations/010_user_timezone.sql` adds `timezone TEXT NOT NULL DEFAULT 'Australia/Brisbane'` to `users` table
- `lib/data/postgres/schema.ts` and `lib/types/user.ts` updated to include `timezone` field
- `auth.config.ts` + `auth.ts`: timezone stamped into JWT at sign-in, available as `session.user.timezone` in all API routes
- `lib/data/repository.ts`: `getNextSession` and `updateUserProfile` signatures extended to accept/persist timezone
- `lib/data/postgres/adapter.ts`: `getNextSession` and `updateUserProfile` use per-user timezone from JWT

**Profile timezone setting:**
- Profile page now shows current timezone with an **Auto-detect** button
- Auto-detect reads `Intl.DateTimeFormat().resolvedOptions().timeZone` from the device
- Timezone saved to DB via `PATCH /api/user/profile`; persists across sign-ins via JWT

**Client-side timezone (session-select, workout-select):**
- `aestDateString()` helpers now use `Intl.DateTimeFormat().resolvedOptions().timeZone` (device timezone) instead of hardcoded `+10h`
- `formatInTimeZone` from `date-fns-tz` used for all date label generation

**Stats page sessionStorage caching:**
- Weekly stats: served from `ta_weekly_stats_v1` sessionStorage key immediately (5-min TTL), refreshed in background
- Meta (program sessions): reads `ta_meta_v1` written by home screen, always refreshes in background
- Removed redundant calendar fetch from stats page — `CalendarWidget` handles its own caching

**Build fix:**
- `auth.ts` `upsertUser` call for new OAuth users was missing the now-required `timezone` field — fixed with `'Australia/Brisbane'` default
- `pnpm-lock.yaml` regenerated after package removals to fix `ERR_PNPM_OUTDATED_LOCKFILE` CI failure

---

### Session 18 — Round 3 Redesign: Nav Overhaul, Per-Set Weights, Stats/History Merge, Profile Settings (2026-05-26)

**Bottom nav reorder + raised Workout button:**
- Tab order changed to Home | Stats | Workout | Health | Profile
- Workout tab renders as a raised `-top-4` rounded-square pill floating above the nav bar (Hevy/Strong style FAB pattern)
- Nav container needs `overflow-visible` for the raised button to clear the border

**Muscle heatmap spacing fix (`components/muscle-heatmap.tsx`):**
- Front/back body diagram grid gap increased from `gap-3` to `gap-8` — diagrams were overlapping

**SVG border animation fix (`app/globals.css`, `components/workout/set-card.tsx`):**
- Old keyframe used `strokeDashoffset: 0 → -340` which only completed ~38% of the full rotation before restarting
- Fixed with `pathLength="1000"` SVG attribute to normalise stroke length; keyframe now `1000 → 0`; `strokeDasharray="970 30"` traces a near-complete rect border over 3s

**Per-set weight dials (`components/workout/set-card.tsx`, `components/workout-screen.tsx`, `components/workout/active-workout-screen.tsx`):**
- Replaced single global `weight` state with `perSetWeights: number[]` (one dial per set)
- Initialised from progression style percentages or `target80` when exercise loads
- Each SetCard now owns a `WeightDial` (pill mode) for its own weight — logged sets show their recorded weight
- Global WeightDial removed from ActiveWorkoutScreen header
- `handleLogCurrentSet` uses `perSetWeights[currentSet] ?? 60` for the logged weight

**Ready screen 1RM sparkline (active-workout-screen.tsx):**
- Replaced warmup weight strip on ready screen with a small 1RM history line chart
- Fetches `/api/exercise-history?exercise=NAME` for the last 8 sessions
- Warmup weights (50/60/70%) moved to active screen — shown as a horizontal strip above set cards when `timerStarted`

**Rest timer enlarged (components/workout/timer-ring.tsx):**
- Rest circle radius increased from ~28 to 36; SVG frame 80×80
- Centred vertically with `flex-col items-center`

**Home screen recommendation fix (`app/session-select/session-select-content.tsx`):**
- Now reads `calendarDays[aestDateString(0)]` as ground truth for what was trained today
- If trained today, shows green "Trained Today" card with actual session name — ignores API recommendation
- Streak algorithm changed: allows up to 2 consecutive rest days (MAX_REST_GAP=2) before breaking the streak, correctly counting 7-day streaks across a rest day

**Server-side recommendation fix (`lib/data/postgres/adapter.ts`):**
- `getNextSession`: moved "already trained today" check to top of function — was previously evaluated after rotation/rest-day logic, causing "Pull" to show even when "Push" was logged that morning

**Workout-select muscle map (`app/workout-select/workout-select-content.tsx`):**
- Session cards now show a `MuscleHeatmap` aggregated from all exercises in that session (via exercise library cross-reference)
- Fetches `/api/exercise-library` in parallel; `buildMuscleActivations()` merges muscle groups per session
- React key bug fixed: `key={ex.id}` and `{ex.exerciseName}` (was `key={ex.name}` which was wrong — `SessionExercise` has `exerciseName` not `name`)

**Profile page redesign (`app/profile/profile-content.tsx`):**
- Consolidated all settings into Profile: Account section (avatar, display name, email, password change), App Preferences (ThemeColorPicker), Workout Settings (placeholder), About, Admin Console link (if admin), Sign Out

**Pre-workout exercise pill visibility (`components/workout/pre-workout-screen.tsx`):**
- Exercise rows now have a subtle brand-tinted background with a visible border for undone exercises — pills were too dark against the muted background

**Stats + History merged (`app/stats/stats-content.tsx`, `app/history/page.tsx`, `app/nutrition/page.tsx`):**
- `/stats` now includes both the exercise history calendar and weekly stats hub
- `/history` and `/nutrition` redirect to `/stats` and `/health` respectively

**Health page (`app/health/page.tsx`, `app/health/health-content.tsx`):**
- New `/health` route with Body / Nutrition tabs
- Body tab: bodyweight sparkline, body fat %, steps
- Nutrition tab: macro totals, calorie goal vs actual

**New API routes:**
- `/api/exercise-history` — returns last N logs for a named exercise (for sparkline)
- `/api/weekly-stats` — returns per-week volume/session counts for stats hub

---

### Session 17 — Performance: Batch DB Queries + Design Mockups (2026-05-25)

**Performance fix — N+1 query elimination (`lib/data/postgres/adapter.ts`, `app/api/workout-data/route.ts`):**
- `workout-data` was running 2 DB round trips per exercise (one for the log, one for its sets). A 10-exercise session = 20 queries per tab load; 3 sessions loading in parallel on home screen = ~60 queries at startup.
- Added `getLastExerciseLogsBatch(userId, exerciseNames[])` to the adapter: single `DISTINCT ON` query fetches latest log for all exercises at once, then one `IN` query for all their set_logs. Total: 2 queries regardless of exercise count.
- Updated `workout-data/route.ts` to use the batch method instead of `Promise.all(N × getLastExerciseLog)`.
- Added `private, max-age=30, stale-while-revalidate=60` HTTP cache headers to workout-data responses — navigating back to pre-workout reuses cached response.

**Bug fix — `logged_at` string→Date coercion:**
- `db.execute(sql\`...\`)` with raw SQL returns timestamps as strings, not `Date` objects (unlike `db.select()` which auto-coerces). Caused `TypeError: d.getTime is not a function` in `toAestDateStr`. Fixed by wrapping with `new Date(r.logged_at)` in both `getLastExerciseLogsBatch` and `getExerciseSummary`.

**New DB index migration (`lib/data/postgres/migrations/009_perf_indexes.sql`):**
- Replaces `idx_el_name_date` with `idx_el_name_date_ws` — a covering index on `(exercise_name, logged_at DESC, workout_session_id)` that avoids a second heap fetch for the JOIN to `workout_sessions` in the DISTINCT ON query.

**Design reference (`design-mockups/nav-patterns.html`):**
- Standalone HTML mockup showing 3 bottom-nav patterns for a potential home screen redesign:
  - Pattern A: 5-Tab Classic (MyFitnessPal style)
  - Pattern B: 4-Tab + Central FAB (Hevy/Strong style) — recommended for TrainingAI
  - Pattern C: Floating Pill Nav (WHOOP/Garmin style)
- Each includes annotated phone mockups, pros/cons, and a recommendation section.

### Session 16 — Dark-First Theme Overhaul + UI Polish (2026-05-25)

**Dark-first theme system (`app/globals.css`, `lib/brand-themes.ts`):**
- `.dark` background pushed to near-black `oklch(0.05 0 0)`; cards `oklch(0.09 0 0)`; borders at 7% opacity white
- 6 selectable electric accent themes: Green (#00ff87), Blue (#00d4ff), Purple (#bf5fff), Orange (#ff6a1a), Pink (#ff3d9a), Cyan (#00e5ff)
- 3 new CSS custom properties per theme: `--brand-card-bg`, `--brand-card-border`, `--brand-glow` — with separate light/dark values
- `data-brand` attribute on `<html>` for theme switching; pre-paint script in `app/layout.tsx` prevents flash

**Muscle heatmap (`components/muscle-heatmap.tsx`):**
- Replaced `react-muscle-highlighter` (which had SSR compat issues) with a self-contained hand-coded SVG heatmap — accurate anatomical paths for all major muscle groups (front + back views)
- Dynamic `next/dynamic` import with `ssr: false` applied; reverted to custom implementation after library compatibility issues

**Done screen (`components/workout/done-screen.tsx`):**
- Confetti celebration fires on mount via `import("canvas-confetti")` dynamic import inside `useEffect`
- Heading: "Workout complete!" → "You crushed it! 💪"; checkmark circle h-20→h-24 with brand glow `boxShadow`
- Checkmark circle uses `--brand-card-bg`, `--brand-card-border`, `--brand-glow` CSS vars for theme-aware glow ring

**Timer ring (`components/workout/timer-ring.tsx`):**
- Track ring uses `var(--brand-card-bg)` instead of hardcoded muted colour
- Glow layer added behind active segment (blur 6px, strokeWidth 16, 22% opacity brand colour)

**Active workout screen (`components/workout/active-workout-screen.tsx`):**
- Header icon buttons `p-1.5` → `p-2.5` (meets 44px touch target)
- 1RM badge uses brand CSS vars instead of hardcoded green
- Footer safe-area inset `max(0.75rem…)` → `max(1rem…)`

**Pre-workout screen (`components/workout/pre-workout-screen.tsx`):**
- Back/refresh/re-log buttons `p-1.5` → `p-2.5`
- Exercise row padding `py-2.5` → `py-3`
- Muscle pills: `bg-brand/15` → `bg-brand/20`; border/text opacity bumped for readability

**Set card (`components/workout/set-card.tsx`):**
- Inactive set opacity `opacity-30` → `opacity-50`
- Lap time font `text-[10px]` → `text-xs`

**Session select (`app/session-select/session-select-content.tsx`):**
- Recommended session card uses brand CSS vars for consistent theme-aware highlight

**Dynamic imports fix:**
- `canvas-confetti` moved from static import to `import()` inside `useEffect` (browser-only)
- `react-muscle-highlighter` wrapped in `next/dynamic` with `ssr: false` (later replaced by custom SVG, but pattern retained)

**`@finegym/fitness-calc` removed** — package was in package.json but added no benefit over existing 1RM logic; removed cleanly.

---

### Session 15 — Design & Fitness Libraries + Agent Skills (2026-05-25)

No code changed — this session was purely additive installs. All changes are in `package.json`, `pnpm-lock.yaml`, `.claude/`, and `.agents/`.

**To fully revert this session:** `pnpm remove react-muscle-highlighter zustand motion @dnd-kit/react date-fns date-fns-tz canvas-confetti @finegym/fitness-calc && pnpm remove -D @types/canvas-confetti`, then delete `.claude/commands/`, `.claude/skills/`, `.agents/skills/`, and `skills-lock.json`.

#### npm Libraries Added

| Package | Version | Why | Revoke |
|---|---|---|---|
| `react-muscle-highlighter` | 1.2.0 | Replaces hand-coded SVG in `muscle-heatmap.tsx` — proper anatomical front/back body diagram with named muscle highlighting (addresses known issue #3) | `pnpm remove react-muscle-highlighter` |
| `zustand` | 5.0.13 | State management with `persist` middleware — will fix workout state being lost on page refresh (known issue #5) | `pnpm remove zustand` |
| `motion` | 12.40.0 | Framer Motion rebranded — mobile gesture support and declarative animations for Samsung S25 Ultra touch UX | `pnpm remove motion` |
| `@dnd-kit/react` | 0.4.0 | Drag-to-reorder exercises in the program config UI (modern replacement for legacy `@dnd-kit/core`+`sortable`) | `pnpm remove @dnd-kit/react` |
| `date-fns` | 4.3.0 | Replaces hand-rolled date helpers — AEST timezone bugs have occurred twice; this handles it correctly | `pnpm remove date-fns` |
| `date-fns-tz` | 3.2.0 | Timezone-aware date ops, companion to `date-fns` | `pnpm remove date-fns-tz` |
| `canvas-confetti` | 1.9.4 | Celebration animation on workout complete screen | `pnpm remove canvas-confetti` |
| `@finegym/fitness-calc` | 1.0.1 | Zero-dep TypeScript fitness math — replaces hand-rolled 1RM in `utils.ts`, adds TDEE, BMR, macros, heart rate zones, body fat. Note: low community traction (MIT licensed, forkable) | `pnpm remove @finegym/fitness-calc` |
| `@types/canvas-confetti` | 1.9.0 | TypeScript types for canvas-confetti (dev dep) | `pnpm remove -D @types/canvas-confetti` |

#### Agent Skills Added

**Superpowers (no TDD) — copied to `.claude/commands/`:**

| File | Why | Revoke |
|---|---|---|
| `systematic-debugging.md` | 4-phase root cause investigation before any fix — addresses recurring hard-to-diagnose bugs (AEST, cache, auth) | Delete `.claude/commands/systematic-debugging.md` |
| `writing-plans.md` | Structured implementation plans with bite-sized tasks for complex work | Delete `.claude/commands/writing-plans.md` |
| `executing-plans.md` | Batch execution with human checkpoints — pairs with writing-plans | Delete `.claude/commands/executing-plans.md` |
| `brainstorming.md` | Design refinement via questions before building (e.g. muscle map approach decisions) | Delete `.claude/commands/brainstorming.md` |
| `verification-before-completion.md` | Confirms fixes actually work before closing a task | Delete `.claude/commands/verification-before-completion.md` |

Source: `https://github.com/obra/superpowers` — `test-driven-development` skill deliberately excluded (no test suite exists).

**Installed via `npx skills` — in `.agents/skills/` and `.claude/skills/`:**

| Skill | Why | Revoke |
|---|---|---|
| `mobile-app-ui-design` (ceorkm) | Mobile-first design principles: 8-point grid, thumb-zone placement, 60/30/10 colour rule, peak-end emotional design — activates automatically on UI work | `npx skills remove ceorkm/mobile-app-ui-design` or delete `.agents/skills/mobile-app-ui-design` + `.claude/skills/mobile-app-ui-design` |
| `mobile-app-design-standards` (awesome-skills) | WCAG 2.1 accessibility, 44pt minimum touch targets, iOS/Android conventions — includes audit scripts in `.agents/skills/mobile-app-design-standards/scripts/` | `npx skills remove awesome-skills/mobile-app-design` or delete `.agents/skills/mobile-app-design-standards` + `.claude/skills/mobile-app-design-standards` |

**Still to install manually (requires Claude Code CLI):**
- `frontend-design@anthropic-agent-skills` — run `/plugin install frontend-design@anthropic-agent-skills` in Claude Code. Pushes against generic AI aesthetics; enforces intentional design direction before writing UI code.

---

### Session 14 — Muscle Heatmap, Exercise Library Features

**Muscle heatmap (`components/muscle-heatmap.tsx`):**
- Replaced all ellipse-based muscle zones with proper SVG `path` shapes per muscle group (chest as two fan-shaped pecs, abs as 6 stacked blocks, quads/hamstrings as teardrop masses, traps as diamond, lats as fan, glutes as rounded mass, etc.)
- Added anatomy definition line layers (`FRONT_LINES` / `BACK_LINES`) — thin strokes tracing muscle borders (sternum, pec edges, ab grid, oblique borders, spine groove, lat edges, glute crease, hamstring/quad grooves) giving the body an anatomy-diagram look
- **Note: muscle map still needs further work** — see Known Issues #3

**Muscle heatmap placement:**
- Removed from program config editor (was showing incorrect primary/secondary aggregation across exercises)
- Removed full-session overview heatmap from pre-workout screen
- Added to solo exercise log ready screen (before timer starts) — this is the correct iteration surface

**Primary/secondary muscle data:**
- `WorkoutExercise` type extended with `mainMuscles?: string[]` and `secondaryMuscles?: string[]`
- `workout-data` API now cross-references the exercise library to populate these fields at request time (no migration needed)
- Pre-workout exercise list: muscle pills now show two styles — solid filled for primary, outline for secondary

### Session 13 — Security Hardening & Cleanup

**Railway env var cleanup:**
- Removed dead variables: `COMPOSIO_API_KEY`, `GOOGLE_SHEETS_AUTH_CONFIG_ID`, `APP_PASSWORD`
- `DATABASE_PUBLIC_URL` kept as informational reference (not read by code)

**Dead code removed:**
- `lib/session.ts` + `lib/session-edge.ts` — pre-Auth.js custom JWT utilities, no longer imported anywhere
- `app/api/next-session/route.ts` migrated from `getSession()` to `auth()` (was the last reference)

**Auth hardening:**
- `AUTH_SECRET` fallback to `SESSION_SECRET` removed from `auth.config.ts`
- `isActive` stamped into JWT and session object; middleware now redirects `isActive===false` users to `/pending` without a DB round-trip (fixes S2)
- `is_admin` DB column added via migration `006_admin_flag.sql`; `requireAdmin()` and `isAdminUser()` check the column instead of hardcoded email (fixes S3)

**Rate limiting (`lib/rate-limit.ts`):**
- `/api/auth/register`: 5 attempts per IP per 15 minutes
- Credentials `authorize`: 20 attempts per email per 15 minutes (fixes S4)

**Avatar moved to localStorage:**
- No longer written to Postgres; stored in `localStorage` under key `ta_avatar`
- Existing DB avatars migrate to localStorage automatically on first `/profile` visit
- No size limit (fixes S5)

**Health Connect ingest fix:**
- `/api/health-connect/ingest` no longer accepts `userId` from request body — uses `WEBHOOK_USER_ID` env var only (same as webhook route). Previously any caller with the secret could write to any account.

**Input bounds:**
- AI chat prompt capped at 4000 chars; history entries at 8000 chars; max 50 turns (`lib/validators/chat.ts`)
- Calendar API `year`/`month` params validated (2000–2100, 1–12)

**Bug fix:**
- Hydration error on session-select: `daysSinceRest()` reads `sessionStorage` (client-only); moved to `useEffect` with state to prevent server/client HTML mismatch

**Config/docs:**
- `app/manifest.ts`: removed Sheets-era `NEXT_PUBLIC_GOOGLE_SHEET_ID` conditional from `start_url`
- `.env.example` rewritten to match current Auth.js + Postgres stack

---

### Session 11 — Auth.js, Email/Password Auth, Admin Console, User Profiles

**Auth.js (NextAuth v5) migration:**
- Replaced custom JWT session (`lib/session.ts`) with Auth.js v5 beta.31
- Edge-safe split: `auth.config.ts` (Google provider, no Node.js imports) used by middleware; `auth.ts` (full Node.js, Credentials + bcrypt) used by API routes
- `app/api/auth/[...nextauth]/route.ts` — Auth.js catch-all handler
- `types/next-auth.d.ts` — session type augmentations (`user.id`, `refreshToken`)
- All API routes updated from `getSession()` → `auth()`, `session.userId` → `session.user.id`
- `app/actions.ts` — `signOut` server action added

**Email/password authentication:**
- `bcryptjs` (pure JS) for password hashing, cost factor 12
- `/register` page + `app/api/auth/register/route.ts` — validates email/password, hashes, calls `createEmailUser`
- Email sign-in form on `/sign-in` page (`app/sign-in/email-sign-in.tsx`)
- Wrong password → `/sign-in?error=CredentialsSignin` toast; inactive user → redirect to `/pending`

**Invite system:**
- `invited_emails` table (migration 005); admin manages list from `/admin` Invites tab
- Invited emails auto-activate on first sign-in (both OAuth and email/password)
- Non-invited users land on `/pending` with styled waiting page (Meteors + card layout)

**Google OAuth account linking:**
- If a user registers with email/password first, then signs in with Google using the same email, their `oauthSub` is written into the existing row rather than creating a duplicate account
- Both auth methods then work on the same user record

**Admin console (`/admin`):**
- Lists all users with pending/active status; activate/deactivate buttons
- Delete button for pending users (clears all their data via cascade)
- Back button (ArrowLeft + router.back())
- Invite list management — add/remove emails
- Protected by `requireAdmin()` in `lib/admin.ts` (hard-coded email check)

**User profiles (`/profile`):**
- Avatar upload: circular preview, file input, base64 data URL stored in DB, 200 KB client-side limit
- Display name, height (cm), date of birth, weight goal (kg)
- Password change section: current password verification (skipped for OAuth-only accounts setting a password for the first time), new + confirm fields, bcrypt(12) on save

**Database changes (migration 005):**
- `users.oauth_sub` made nullable (email/password accounts have no OAuth sub)
- New columns on `users`: `display_name`, `height_cm`, `date_of_birth`, `weight_goal_kg`, `avatar`, `password_hash`
- New `invited_emails` table

**New repository methods:** `listUsers`, `activateUser`, `deactivateUser`, `deleteUser`, `getUserById`, `getUserByEmail`, `updateUserProfile`, `updateUserPassword`, `linkOAuthAccount`, `createEmailUser`, `listInvites`, `addInvite`, `removeInvite`, `isInvited`

### Session 12 — Auth Fixes & PWA

**Build fixes:**
- `useSearchParams()` in `EmailSignIn` wrapped in `<Suspense>` boundary (required by Next.js for static page generation)
- `ensureSchema()` guarded by `DATABASE_URL` presence — prevents ENOTFOUND errors when Railway build container has no DB access

**Auth.js production fixes:**
- `trustHost: true` added to `auth.config.ts` — fixes `UntrustedHost` error causing middleware to fail open (unauthenticated users reaching home screen)
- `AUTH_URL=https://trainingai-production.up.railway.app` added to Railway env vars — fixes redirect URI being constructed as `https://localhost:8080/api/auth/callback/google` due to Railway's internal proxy rewriting the Host header
- `pnpm-lock.yaml` updated to include `bcryptjs`, `next-auth`, `@types/bcryptjs`

**PWA fix:**
- Added 192×192 `any`-purpose icon to manifest — Chrome requires this size to show the install prompt (previously only had 512×512 + 180×180 maskable)
- Bumped service worker cache version to `ta-v4`

**Google Cloud Console:**
- OAuth consent screen published (moved from Testing → Production) so any Google account can sign in
- Correct redirect URI (`https://trainingai-production.up.railway.app/api/auth/callback/google`) confirmed on the active RailwayOauth client

---

### Session 1 — Foundation
- Replaced Composio auth with Google OAuth2; refresh token stored in session JWT cookie
- Sliding session expiry — 7-day rolling window, refreshed on every page load
- Sheet ID persisted in `localStorage` — not re-prompted after session expiry
- Replaced all Composio + Gemini data-fetch roundtrips with direct `googleapis` calls
- New workout data schema: per-set CSV weights/reps/times across columns A–N
- Per-set weight tracking; weight dial auto-advances to next set's progression target
- 1RM calculated as max Epley+Brzycki across `useFor1rm`-flagged sets
- Named progression styles (JSON in `progression_styles` sheet tab)
- Named workout programs / templates (`workout_templates` sheet tab)
- In-app config screen: full CRUD for styles and programs
- AI chat upgraded to Gemini 2.5 Flash with Chart.js inline rendering
- Health Connect webhook + Tasker ingest endpoints
- Google Calendar event created on session complete
- Calendar day overlay: edit/delete workout entries
- Calendar sync toggle in config

### Session 2 — UI Polish & Bug Fixes
- W1–W6, P1–P3, N1–N2 workout UX polish (bounce start, SVG border animation, rest gauge, etc.)
- B1–B5 bug fixes (stale closure, weight dial, 1RM formula, animation colours)

### Session 3 — Component Refactoring
- Split `components/workout-screen.tsx` into focused sub-components under `components/workout/`
- Created `CLAUDE.md` for persistent session context

### Session 4 — Docs Consolidation
- Deleted stale MD files; consolidated living context into `projectOverview.md`

### Session 5 — New Features & Bug Fixes
- Style IDs (stable UUIDs), muscle group tags, pre-workout card redesign
- Cache invalidation fix after config saves
- Mobile UI fixes (settings sheet scroll, Switch component sizing)

### Session 10 — 7 Bug Fixes + Session Icons

**UI fixes:**
- Sign-in toast copy: "Google Sheets Connected" → "Signed in"
- Mobile body-metric log sheet: Save button moved above input so mobile keyboard can't obscure it
- Workout header badge: changed from `target80` ("Target X kg") to `estimated1rm` ("1RM ~X kg")

**AEST date fix (root cause: UTC → AEST conversion):**
- `app/api/workout-data/route.ts`: `lastDate` was using `.toISOString().slice(0,10)` (UTC) — off by 1 day for exercises logged before 10am AEST. Added `toAestDateStr(d: Date)` helper to `lib/date-utils.ts`; route now uses it.
- Home carousel now correctly shows "Today" for sessions trained in the morning AEST.

**In-progress session indicator:**
- `sessionProgressToday()` reads the `ta_wc_*` sessionStorage cache, counts exercises where `lastDate === todayAest`, returns `{done, total}`.
- Carousel card shows amber "● In Progress" badge + "1/6 exercises" when partially done (not complete).

**Calendar rest days:**
- Past/today days with no training now show a tiny "rest" label. Future days remain blank. Only shown when data is loaded (`data !== null`).

**Session emoji icons (Issue 7):**
- Migration `004_session_icon.sql`: adds nullable `icon TEXT` column to `program_sessions` (idempotent).
- `lib/data/postgres/schema.ts`: `icon: text('icon')` added to `programSessions`.
- `lib/types/program.ts`: `icon?: string` added to `ProgramSession`.
- Adapter: reads `icon` in `listPrograms`, writes `icon` in `saveProgram`.
- Config screen: emoji picker button added to session header row; curated grid of 20 fitness emojis; selection saved to DB.
- Home carousel: `sess.icon || palette.emoji` — user icon takes precedence over palette default.

**Critical infra fix — `ensureSchema()` never ran:**
- `getRepository()` was synchronous and skipped `ensureSchema()`, so migration 004 never applied — every call to `listPrograms()` failed with `column "icon" does not exist`.
- Fixed `lib/data/index.ts`: `ready = ensureSchema()` now starts eagerly at module load; `getRepository()` is now async and awaits it. All 10 API route files updated to `await getRepository()`.
- Also updated `CLAUDE.md`: merge/push to `main` now requires explicit user confirmation (was missing from instructions).

---

### Session 9 — Auth Fix, Schedule Config, Bug Fixes

**Auth fix (UUID migration):**
- Migration 002 changed `users.id` from TEXT (OAuth sub) to UUID, but PostgreSQL dropped the `DEFAULT gen_random_uuid()` on the renamed column — causing `null value in column "id"` on login
- Fix: `ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()` run in Railway DB browser; migration SQL patched to include this after the rename

**Schedule config UI + server-side recommendation:**
- Config screen: schedule editor added to program sheet — **Auto** / **Rotation** (rest after N days, 1–14) / **Weekly** (day toggles M–S). Saved to DB via `saveProgram`; `null` schedule clears any existing schedule row
- `/api/next-session`: new GET endpoint calling `repo.getNextSession(userId)`
- `getNextSession` fixes: AEST timezone for day boundaries and day-of-week; rename-aware last-session lookup via `program_sessions` FK join; clean consecutive-day counting going back from yesterday
- Home screen: replaced stale sessionStorage client-side heuristic with fetch to `/api/next-session`

**Calendar / data fixes:**
- Calendar dots: `getCalendarData` now INNER JOINs `exercise_logs` so sessions with no logged exercises don't produce ghost dots
- Calendar cache key unified — `invalidateCalendarCache()` in `utils.ts` was using old `ta_calendar_*` key instead of `ta_calendar_v2_*`, so dots never refreshed after logging
- Calendar dot colours after session rename: `getCalendarData` now uses `COALESCE(program_sessions.name, workout_sessions.session_name)` so renaming a session keeps dot colour stable
- `daysSinceRest()` cache key fixed to `ta_calendar_v2_*`

**Data corrections:**
- Deleted orphan `workout_sessions` row (Legs, 2026-05-22T14:00Z) that had no exercise logs
- Legs exercise_logs and workout_sessions `started_at` adjusted by `-10 hours` — seed script had stored AEST times as UTC, causing times to display 10h late

### Session 8 — Manual Data Seed + Dynamic Session Colors

**Manual data entry:**
- Added `scripts/seed-legs.sql` — one-off PL/pgSQL script that inserted 4 missing Legs workout sessions (2026-05-05, 05-08, 05-14, 05-20) with all exercise logs and set data from the original Sheets export
- Script ends with `SELECT 'done'` (no trailing semicolon) to absorb the `LIMIT N` that Railway's query editor appends — required for `DO $$...$$` blocks to parse correctly

**Dynamic session colors (calendar dots + overview tabs):**
- Root cause of invisible calendar dots: `SESSION_COLORS` used lowercase keys (`"push"`) but DB stores capitalised names (`"Push"`) → lookup returned `undefined` → transparent dots
- Fixed by replacing all hardcoded `SESSION_COLORS`/`SESSION_LABELS`/`TAB_ORDER` with position-based palette lookup via `getPaletteEntry(session.position)`
- Colors are now assigned by **position index** not name — renaming a session keeps its color; any number of sessions (1 "Full Body" or 5 "Upper Power" etc.) get unique palette slots automatically
- `lib/session-palette.ts` — added `dotClass` field (solid `bg-*-500`) for calendar dot rendering alongside existing `bgClass`/`textClass`/`borderClass`
- `components/calendar-widget.tsx` — fetches active program on mount; builds `name→position` map; `stableIndex()` hash fallback for sessions not in the active program (e.g. old ad-hoc entries); legend is now dynamic from program sessions; `FALLBACK_SESSIONS` (Push/Pull/Legs at positions 0–2) prevent blank legend during load
- `components/overview-screen.tsx` — replaced hardcoded `TAB_ORDER`/`SESSION_TO_TAB`/`TAB_SESSION` with `activeSessions` fetched from `/api/workout-data?tab=meta`; section headers colored with `palette.textClass`; `fetchPreview` passes session name directly (route does case-insensitive match)

### Session 7 — Sheets Removal, Bug Fixes + Drizzle ORM

**Drizzle ORM:**
- Installed `drizzle-orm` + `drizzle-kit`
- `lib/data/postgres/schema.ts` — all 11 tables defined with full types; `date` columns use `mode:'string'` for direct `"YYYY-MM-DD"` return; single source of truth for schema going forward
- `lib/data/postgres/client.ts` — exports `getDb()` (Drizzle instance) alongside existing `getPool()` + `ensureSchema()`
- `lib/data/postgres/adapter.ts` — all 18 `WorkoutRepository` methods rewritten with Drizzle typed query builder; `getDayLog`/`getWorkoutSessionsFrom` share `buildWorkoutSessions()` helper; `getExerciseSummary` uses `db.execute(sql\`...\`)` for Postgres `DISTINCT ON`; `upsertBodyMetrics` uses COALESCE via `sql` tag
- `drizzle.config.ts` — for future `npx drizzle-kit generate` migrations
- **For schema changes going forward:** edit `schema.ts` → `npx drizzle-kit generate` → new `.sql` appears in `migrations/` → deployed automatically

**Bug fix (edit save crash):** `saveProgram` and `saveProgressionStyle` now UPDATE by id when editing an existing record, and INSERT+conflict only when creating new — the previous `INSERT ... ON CONFLICT (user_id, name)` didn't cover the primary key conflict when an id was provided.

### Session 7 — Sheets Removal + Bug Fixes

**Removed all Google Sheets code and migration endpoints:**
- Deleted: `lib/google-sheets-client.ts`, `lib/sheet-cache.ts`, `lib/body-meta-writer.ts`, `lib/exercise-session-writer.ts`, `lib/progression-styles.ts`, `lib/workout-templates.ts`
- Deleted: `app/api/admin/migrate/route.ts`, `app/sheet-url/page.tsx`, `scripts/update-muscle-groups.ts`

**Ported remaining Sheets-dependent routes to Postgres:**
- `app/api/google-sheet/route.ts` (AI chat) — now builds context from `getWorkoutSessionsFrom` (90d), `listBodyMetrics` (30d), and `getActiveProgram`; uses `gemini-2.5-flash`; body weight logging writes to `body_metrics`
- `app/api/health-connect/ingest/route.ts` — uses `upsertBodyMetrics` via Postgres adapter
- `app/api/health-connect/webhook/route.ts` — uses `upsertBodyMetrics` (batch) and `saveCardioSession`; requires `WEBHOOK_USER_ID` env var

**Bug fixes from Session 6 migration:**
- `log-exercise/route.ts`: date parsing crash fixed — `localDatetimeString()` returns `"YYYY/MM/DD HH:mm"`, sliced to 10 chars before parse
- `workout-screen.tsx`: added `styleId` in log body; added `workoutSessionId` tracking to avoid N+1 getDayLog queries
- `workout-data/route.ts`: style resolution fallback via `lastLog.styleName` when `styleId` is null
- `config-screen.tsx`: fully rewritten to use `Program` / `ProgressionStyle` types from `@/lib/types` — correct ID-based CRUD, `ProgramSession[]` → editable Record conversion, `setNumber` included in style saves, `null → undefined` for body metrics

**Repository interface:**
- Added `getWorkoutSessionsFrom(userId, from: Date)` to `WorkoutRepository` interface and `PostgresWorkoutRepository`

**New env var required:**
- `WEBHOOK_USER_ID` — identifies which Postgres user receives Health Connect webhook data (previously used `WEBHOOK_SHEET_ID` for static Sheets writes)

---

### Session 6 — PostgreSQL Migration + Flat URL Routing

**Full data layer migration from Google Sheets → PostgreSQL (Railway)**

Schema (`lib/data/postgres/migrations/001_initial.sql`):
- `users` (id = Google OAuth sub, `is_active` approval gate)
- `progression_styles` + `style_sets`
- `programs` + `program_sessions` + `session_exercises`
- `schedules` (rotation with `rest_after_n`, or weekly with `schedule_days`)
- `workout_sessions` + `exercise_logs` + `set_logs`
- `body_metrics` (one row per user per day — weight, body fat, calories, macros, steps, distance)
- `cardio_sessions` (date, title, start/end time, duration, calories burned)

Infrastructure:
- `lib/data/postgres/client.ts` — pool singleton, `ensureSchema()` runs migration once per process
- `lib/data/postgres/adapter.ts` — `PostgresWorkoutRepository` implements full `WorkoutRepository` interface
- `lib/data/index.ts` — `getRepository()` / `getRepositoryAsync()` factory
- `lib/types/` — typed interfaces for all entities including `BodyMetrics`, `CardioSession`, `NextSessionRecommendation`

Auth redesign:
- Anyone can OAuth; user row created with `is_active = false`
- Admin manually flips `is_active = true` in Railway DB browser
- Inactive users redirected to `/pending` page
- No more `ALLOWED_EMAILS` / invite list

Data migration:
- `/api/admin/migrate?tab=...&sheetId=...` — per-tab endpoint (GET = dry run, POST = write)
- Tabs: `styles`, `templates`, `push`, `pull`, `legs`, `body`, `cardio`
- Successfully migrated: 5 styles · 15 style_sets · 2 programs · 6 sessions · 34 exercises · 10 workout_sessions · 60 exercise_logs · 180 set_logs · 22 body_metrics · 3 cardio_sessions

Flat URL routing:
- Removed Google Sheets ID from all URLs
- New flat routes: `/workout?session=...`, `/overview`, `/config`, `/chat`
- Old `/sheet/[id]/*` routes redirect to flat equivalents (bookmark-safe)
- `app/page.tsx` → redirects to `/session-select`
- Removed `ChatOverlay` from layout (was sheet-URL-dependent)

API routes ported to Postgres:
- `/api/body-metadata` — reads/writes `body_metrics` table
- `/api/log-exercise-session` — writes `cardio_sessions` table
- `/api/day-log` — body metadata now from `body_metrics` (was Sheets)
- All workout logging routes were already using Postgres adapter from session 6 start

---

## Current Architecture

**Data layer**: PostgreSQL on Railway. Google Sheets is completely removed.

**Auth flow**: OAuth → upsert user with `is_active=false` → redirect to `/pending` if inactive → admin activates in DB → full access.

**Keep Google OAuth for**: Calendar API only (`/api/log-calendar-event`). Refresh token stored in session JWT cookie.

**URL structure**:
- `/` → `/session-select` (home)
- `/workout?session=Push` (workout screen)
- `/overview` (overview dashboard)
- `/config` (progression styles + programs)
- `/chat` (AI chat)
- `/pending` (awaiting activation)
- `/sign-in` (OAuth entry)

---

## Known Issues

### Medium Priority
1. 1RM not updated mid-session — per-set weight targets are fixed at session-start 1RM. This is **expected behaviour**, not a bug.
2. New user timezone defaults to `'Australia/Brisbane'` for OAuth sign-up — auto-detect button on Profile fixes this quickly.
3. **Brzycki division-by-zero** — `app/api/log-exercise/route.ts` ~L14: at exactly `reps === 37` the Brzycki denominator is 0 → `Infinity` stored as 1RM. Change `>= 37` to `> 37`.
4. ~~**`resetSession` effect has empty deps**~~ ✅ Fixed session 45 (U3).
5. ~~**`Math.max` on empty arrays**~~ ✅ Fixed session 45 (U11).
6. ~~**PR detection is non-atomic**~~ ✅ Fixed session 45 (U10).
7. ~~**Food logger double-submit**~~ ✅ Fixed session 45 (U12).
8. ~~**Workout-store rehydrates stale `todayLogged`**~~ ✅ Fixed session 45 (U13).
9. ~~**Exercise stats sheet race condition**~~ ✅ Fixed session 46 (U18).

### Low Priority
10. ~~AI chat context window has no truncation~~ ✅ Fixed session 36.
11. Stats page and session-select use device timezone (client-side) while API routes use JWT-stored timezone — low impact for single-user use.
12. ~~**`cachedFetch` stale-while-revalidate race**~~ ✅ Fixed session 46 (U30).
13. **SyncProvider swallows init errors** — `components/sync-provider.tsx`: no error handling around `initSQLite()` or `drainOutbox()`; silent failure leaves the outbox undrained. (U31 — pending)
14. **Drag-to-reorder meal types is UI-only** — `components/nutrition/meal-type-manager.tsx`: grip handles shown but sort is not wired. Remove handles or wire `@dnd-kit` sort. (U28 — pending)

---

## Planned / Future Work

### Rule: No Hardcoded Session Names or Training Structure
Everything must be dynamic and user-driven. No `"Push"`, `"Pull"`, `"Legs"` hardcoded anywhere. See CLAUDE.md for the full rule and known violations list.

**Known violations to clean up (do not extend — fix when touching the file):**

✅ All previously listed violations have been resolved — verified session 38. No remaining hardcoded Push/Pull/Legs references in components.

---

### Incomplete / In Progress

- ~~**Workout start time in DB**~~ ✅ Done — `log-exercise/route.ts` accepts and uses `workoutStartedAt`; `day-log/route.ts` uses `ws.startedAt` with proper timezone handling. Verified session 38.
- ~~**AI chat context truncation**~~ ✅ Done session 36

---

### Uplift Backlog (session 42 review — prioritised by effort × need)

Work through tiers in order. Tier 1 is under 30 minutes total and eliminates the critical security gap plus the worst data bugs.

#### Tier 1 — Fix immediately (minutes each)

| # | What | Status |
|---|------|--------|
| ~~U1~~ | ~~Add `auth()` to TTS route~~ | ✅ Fixed session 45 |
| ~~U2~~ | ~~Fix Brzycki division-by-zero~~ | ✅ Fixed session 44 |
| ~~U3~~ | ~~Add `sessionType` to `resetSession` deps~~ | ✅ Fixed session 45 |
| ~~U4~~ | ~~Fix HTTPS cookie detection~~ | ✅ Fixed session 45 |
| ~~U5~~ | ~~Rep +/− buttons: `h-8` → `h-12`~~ | ✅ Fixed session 44 |
| ~~U6~~ | ~~Replace `text-[8px]`/`text-[9px]` with `text-xs`~~ | ✅ Fixed session 44 |

#### Tier 2 — This week (30–90 min each)

| # | What | Status |
|---|------|--------|
| ~~U7~~ | ~~Rate-limit all AI routes~~ | ✅ Fixed session 45 |
| ~~U8~~ | ~~Add Zod schema to `sync-workout`~~ | ✅ Fixed session 45 |
| ~~U9~~ | ~~Gate nutrition scan image size~~ | ✅ Fixed session 45 |
| ~~U10~~ | ~~Make PR detection atomic~~ | ✅ Fixed session 45 |
| ~~U11~~ | ~~Guard `Math.max` on empty arrays~~ | ✅ Fixed session 45 |
| ~~U12~~ | ~~Add `saving` state to food logger~~ | ✅ Fixed session 45 |
| ~~U13~~ | ~~Fix workout-store date check on rehydration~~ | ✅ Fixed session 45 |

#### Tier 3 — Next sprint (1–3 hours each)

| # | What | Status |
|---|------|--------|
| ~~U14~~ | ~~Add `aria-label` to all icon-only buttons~~ | ✅ Fixed session 46 |
| ~~U15~~ | ~~Fix food logger back-navigation~~ | ✅ Fixed session 46 |
| ~~U16~~ | ~~Meal-type chips + quantity buttons to 44 dp min~~ | ✅ Fixed session 46 |
| ~~U17~~ | ~~Recent-items row height in capture step~~ | ✅ Fixed session 46 |
| ~~U18~~ | ~~AbortController in exercise stats sheet~~ | ✅ Fixed session 46 |
| ~~U19~~ | ~~Error state in exercise stats sheet~~ | ✅ Fixed session 46 |
| ~~U20~~ | ~~Prune expired entries in `rate-limit.ts`~~ | ✅ Fixed session 46 |
| ~~U21~~ | ~~Prune expired mobile auth tokens~~ | ✅ Already implemented |
| ~~U22~~ | ~~Barcode format validation~~ | ✅ Fixed session 46 |
| ~~U23~~ | ~~Cap `exercise-gif` name param~~ | ✅ Fixed session 46 |

#### Tier 4 — Polish (larger, UX improvement)

| # | What | Status |
|---|------|--------|
| ~~U24~~ | ~~Enlarge rest timer ring~~ | ✅ Fixed session 46 |
| ~~U25~~ | ~~Make weight dial height responsive~~ | ✅ Fixed session 46 |
| U26 | Standardise safe-area padding across all screen headers/footers | Pending |
| U27 | Replace `<div>` section headers with `<h2>`/`<h3>` | Pending |
| U28 | Wire drag-to-reorder for meal types (`nutrition/meal-type-manager.tsx`) | Pending |
| ~~U29~~ | ~~Prompt injection separation in AI chat~~ | ✅ Already implemented |
| ~~U30~~ | ~~`cachedFetch` per-key in-flight lock~~ | ✅ Fixed session 46 |
| U31 | SyncProvider error handling (`components/sync-provider.tsx`) | Pending |

---

### Quick Wins (low effort, high value)

- **Muscle recovery estimator** — based on muscles trained and session volume, estimate % recovered per muscle group. Show on workout select screen alongside the heatmap.

---

### Data Analysis & Insights (all data already exists)

- **Muscle recovery estimator** — based on muscles trained and session volume, estimate % recovered per muscle group. Show on workout select screen alongside the heatmap.
- **Body composition trend** ✅ (done session 33 — lean mass chart on Health > Body tab)

---

### Completed (session 33)
- **Admin notification badge** ✅
- **PR (personal record) tracker** ✅
- **Program week tracker** ✅
- **Workout start time in DB** ✅
- **Lean mass trend** ✅
- **Acute:Chronic Workload Ratio** ✅
- **Readiness / Energy Score** ✅
- **Sleep ↔ performance correlation** ✅
- **Weekly AI digest** ✅
- **Hardcoded Push/Pull/Legs cleanup** ✅

---

### AI Features

- **AI morning briefing** — daily home screen card generated from a Gemini prompt ingesting last night's sleep, yesterday's training, 7-day HRV trend, and resting HR. Recommends train/rest, which session, intensity modifier. Cached once per day.
- **Nutrition photo scanning** — camera capture → Gemini Vision → estimated food name + calories/macros → editable confirmation sheet → save to `body_metrics`. Manual entry fallback.
- **Periodization planning** — AI generates a 12-week block plan (hypertrophy → strength → deload) based on current 1RMs and goals.
- **Voice logging** — Web Speech API mic button in workout header. "3 sets of 80kg bench" parses and pre-fills weight/reps.

---

### New Data Sources

- **Progress photos** — periodic timestamped photos stored in object storage (Cloudflare R2 or similar), shown as a timeline. Pairs with medical records storage.
- **Hydration tracking** — manual log + daily goal, correlates with performance metrics.
- **Supplement / medication log** — daily checklist, correlate with HRV/performance over time.
- **Injury log** — record affected muscle group, severity, date. Workout recommendations avoid those muscles during recovery window.

---

### Social & Sharing

- **Workout sharing between users** — export a program/session as a shareable JSON payload stored in a `shared_programs` DB table with a UUID slug. Generate a share link any logged-in user can visit to import it into their own library.

---

### Native Android Features

- **Active workout overlay (persistent notification)** — Android Foreground Service with a persistent notification showing the rest timer countdown, updated every second via Capacitor plugin bridge. Allows leaving the app mid-rest and still seeing the timer. Requires native Kotlin code + new Capacitor plugin. **Complexity: High.**
- **Android home screen widget** — native Kotlin `AppWidget` showing recommended workout, today's steps, last sleep. Calls a lightweight API endpoint on a 15-min refresh schedule. **Complexity: Very High — pure native.**

---

### Infrastructure

- **Medical records upload + AI analysis** — upload PDFs/images → store in Cloudflare R2 → record metadata + URL in `medical_records` DB table → Gemini Vision/PDF analysis on demand. Needs object storage setup.
- **Exercise GIF library** ✅ Done session 36 — forked dataset, lazy DB cache, shows in stats sheet + warmup screen

---

### Completed Infrastructure
- **Capacitor Android APK** ✅
- **Health Connect native SDK** ✅ (Steps, Weight, BodyFat, Nutrition, HRV, RHR, SpO₂, Sleep, Exercise sessions)
- **Google OAuth in APK** ✅
- **Local-first SQLite offline logging** ✅
- **Schedule UI + server-side recommendation** ✅

---

## Key Files

### Data Layer
| File | Role |
|------|------|
| `lib/data/repository.ts` | `WorkoutRepository` interface |
| `lib/data/postgres/adapter.ts` | Full Postgres implementation |
| `lib/data/postgres/client.ts` | Pool singleton + `ensureSchema()` |
| `lib/data/postgres/migrations/001_initial.sql` | Full schema (idempotent) |
| `lib/data/index.ts` | `getRepository()` async factory — awaits `ensureSchema()` on first call |
| `lib/types/` | All entity interfaces (user, program, progression, log, body) |

### Workout Flow
| File | Role |
|------|------|
| `components/workout-screen.tsx` | Orchestrator — all state, refs, callbacks |
| `components/workout/pre-workout-screen.tsx` | Pre-workout exercise list |
| `components/workout/active-workout-screen.tsx` | Active workout UI |
| `components/workout/exercise-summary-screen.tsx` | Per-exercise summary card |
| `components/workout/done-screen.tsx` | Workout complete screen |
| `components/workout/timer-ring.tsx` | SVG ring timer |
| `components/workout/set-card.tsx` | Individual set card |

### Home Screen & UI
| File | Role |
|------|------|
| `app/session-select/session-select-content.tsx` | Home screen — recommendation carousel, body widgets, calendar |
| `components/overview-screen.tsx` | Overview dashboard |
| `components/calendar-widget.tsx` | Month calendar with day overlay |
| `components/ai-chat-overlay.tsx` | Floating Gemini chat (sheetId now optional) |
| `components/config-screen.tsx` | Progression styles + program CRUD |
| `components/ui/weight-dial.tsx` | Scroll-wheel weight/rep picker |

### API Routes
| File | Role |
|------|------|
| `app/api/workout-data/route.ts` | Reads exercise list + active program from Postgres |
| `app/api/log-exercise/route.ts` | Logs exercise + sets to Postgres |
| `app/api/log-calendar-event/route.ts` | Creates Google Calendar event on session complete |
| `app/api/workout-entry/route.ts` | PATCH/DELETE individual exercise logs |
| `app/api/progression-styles/route.ts` | CRUD for progression styles |
| `app/api/workout-templates/route.ts` | CRUD for programs |
| `app/api/calendar-data/route.ts` | Reads calendar training data from Postgres |
| `app/api/day-log/route.ts` | Reads all exercises + body metrics for a given day |
| `app/api/body-metadata/route.ts` | Reads/writes body_metrics from Postgres |
| `app/api/ai-chat/route.ts` | Gemini AI chat — builds context from Postgres (renamed from google-sheet in session 37) |
| `app/api/health-connect/webhook/route.ts` | HC Webhook — writes body_metrics + cardio_sessions |
| `app/api/health-connect/ingest/route.ts` | Tasker ingest — writes body_metrics |

### SQLite (APK only)
| File | Role |
|------|------|
| `lib/sqlite/sqlite-service.ts` | Plugin init, `isSQLiteAvailable()`, `runSQL`, `querySQL` |
| `lib/sqlite/migrations.ts` | Schema v1 (workout tables + outbox) + v2 (api_cache) |
| `lib/sqlite/outbox.ts` | `writeLocalWorkout`, `addToOutbox`, `drainOutbox` |
| `lib/sqlite/cache.ts` | `getCached`, `setCached`, `invalidateCache`, `cachedFetch` helper |
| `components/sync-provider.tsx` | Mounts in layout — inits SQLite, drains outbox, warms 9 caches |
| `app/api/sync-workout/route.ts` | POST endpoint that processes batched outbox payloads into Postgres |

### Lib / Infrastructure
| File | Role |
|------|------|
| `lib/session.ts` | JWT session cookie (contains Google refresh token) |
| `lib/session-palette.ts` | Session color/emoji palette by index |
| `app/globals.css` | `border-run` keyframe (W2 SVG animation) |
| `middleware.ts` | Route protection; redirects unauthenticated users to /sign-in |
| `app/pending/page.tsx` | "Account pending activation" page |

---

## Environment Variables (Railway)

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | JWT signing |
| `DATABASE_URL` | Railway Postgres connection string |
| `DATABASE_SSL` | Set `true` for SSL (required on Railway) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | OAuth |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini |
| `HEALTH_CONNECT_INGEST_SECRET` | Tasker/webhook auth |
| `WEBHOOK_USER_ID` | Postgres user ID for stateless HC webhook writes |

