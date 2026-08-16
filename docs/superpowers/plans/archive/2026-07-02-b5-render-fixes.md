# B5 — Render fixes (plan 2 of 3)

> Source: `docs/planned_upgrades.md` § B5 "Render storms" (audit 2026-07-02). One PR. Line refs verified against `main` @ post-#98 — re-grep anchors before editing.
>
> Goal: the workout screen stops re-rendering ~1,000 lines every second, and the home screen's card grid stops re-rendering on every one of its ~54 state updates. Pure render-path work — zero behaviour change, so verification is "everything looks and works identical, but profiled renders shrink".

## Task 1 — Extract the two 1 Hz timers into leaf tickers

`components/workout-screen.tsx:159` (`sessionElapsedSec`) and `:180` (`exerciseElapsedSec`) hold `setInterval` state in the orchestrator; every tick re-renders the whole tree. The correct pattern already exists in `components/pip-view.tsx:37-41` and `components/activity/active-activity-screen.tsx:29-41` (leaf owns its own interval).

1. Create `components/workout/elapsed-timer.tsx`: a leaf that takes `startMs` (or a `MutableRefObject`) + a render prop/format variant, owns its own 1 Hz interval, and renders only the text/SVG it displays. Variants needed: plain `mm:ss` text, the header session-donut, the warmup segment progress, and the rest-ring — check each display site and prefer one component with small props over four copies (grep the current `sessionElapsedSec`/`exerciseElapsedSec` prop drilling into `ActiveWorkoutScreen`, `WarmupScreen`, `ExerciseSummaryScreen` to enumerate the sites).
2. Delete both `useState`+`setInterval` pairs from the orchestrator; pass the start-ms values/refs down instead (most already exist as refs, e.g. `lapStartRef`/`restStartRef`).
3. Move the rest-beep effect (currently keyed off the orchestrator tick, `workout-screen.tsx` ~`:322-333` pre-move) to a `setTimeout` scheduled at `restStartMs + currentRestSec` (or a tick inside the rest-ring leaf) — do not leave any per-second effect in the orchestrator.
4. After extraction, `React.memo(ActiveWorkoutScreen)` — its props must now all be stable (verify with the React DevTools profiler; any remaining per-second prop means a missed site).

**Verify:** `pnpm dev` → run a workout: session/exercise/rest timers all tick, rest beep fires at zero, overtime shows red. React DevTools profiler during an active set: only the timer leaves render at 1 Hz.

## Task 2 — Fix the three memo-defeating inline props

1. `components/workout/active-workout-screen.tsx:590` — `onRpeChange={onRpeChange ? (value) => onRpeChange(currentSet, value) : undefined}` recreates per render, defeating `SetCard`'s memo (the only memo in the workout tree). Replace with `useCallback` keyed on `[onRpeChange, currentSet]`.
2. `app/session-select/session-select-content.tsx:1243` and `:1300` — inline `onColorChange` arrows into `HomeCardWidget` (memoized, defeated). Hoist to `useCallback`s using functional `setCardColors` updates.
3. `:1320` — `hrData={… ? { readings: ouraHrReadings, workoutSessions: ouraWorkoutSessions } : null}` builds a fresh object per render. `useMemo` on `[ouraHrReadings, ouraWorkoutSessions]`.

**Verify:** profiler on home: changing one unrelated state (e.g. mood save) no longer re-renders the 8 `HomeCardWidget`s; RPE slider drag re-renders only the active `SetCard`.

## Task 3 — Memoize the home cards

`React.memo` the five cards rendered under the fetch-heavy home parent: `RecommendationCard`, `StreakCard`, `WeekStripCard`, `MetricTilesCard`, `HomeDayTimeline` (see `components/home/` and `app/session-select/` imports for exact paths). For each, check its call site for inline props first (Task 2 pattern) — memo without stable props is dead code per the CLAUDE.md rule. Do **not** attempt the per-section data-hook split of `session-select-content.tsx` here — that's G3's structural work; this PR is call-site-level only.

**Verify:** profiler: during home's mount fetch-cascade (~15–25 setState waves), each card renders once with its own data arrival, not on every wave.

## Task 4 — Stable ids for style-editor set rows

`components/config/style-editor-sheet.tsx:66-67` keys the editable `styleSets` rows by index; deleting a middle row makes the rows below inherit stale input state. Give each row a stable client id at creation (`crypto.randomUUID()` when adding a row / when hydrating from the DB use the DB id), key on it, and strip it before save if the API doesn't accept it.

**Verify:** `pnpm dev` → edit a progression style with 4 sets, type a distinctive pct into set 3, delete set 2 → the values below stay with their rows.

## Task 5 — Hoist the per-render cache read

`components/workout-screen.tsx` (~`:168` pre-Task-1) calls `readCacheSync('achievements:…')` in the component body — i.e. a `sessionStorage.getItem` + `JSON.parse` every render, which is every second until Task 1 lands. Move to a lazy `useRef` init or one-time `useEffect` (per the CLAUDE.md rule: cache reads never live in a timer-rendered body). Grep the codebase for other `readCacheSync(` calls in component bodies (not effects/initial-seed blocks) and fix any in the same pattern.

**Verify:** grep shows no `readCacheSync` in render paths of timer-bearing components; workout screen behaviour unchanged.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; full manual pass of the workout flow (pre → warmup → sets → rest → summary → done) and home on `pnpm dev` — this PR touches the hottest screen in the app, so exercise every mode transition.
- Not exercisable in sandbox (declare in PR): real WebView frame timing on the S25 — profiler evidence is from desktop Chrome.
- Version: patch bump + `lib/changelog.ts` entry ("workout screen render performance").
- On ship: tick the five B5 render bullets in `docs/planned_upgrades.md`.
