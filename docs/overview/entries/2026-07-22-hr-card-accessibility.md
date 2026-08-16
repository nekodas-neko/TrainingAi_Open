## 2026-07-22 — "Heart & Recovery" card made reachable (v1.200.1)

**Branch:** `claude/hr-workout-data-recording-ij3kwh` (fresh from `main` after the per-set-HR feature
merged in #749). Follow-up bug fix: the card shipped in v1.199.0 but was **effectively unreachable**.

### Problem
The `ExerciseHistorySheet` (which hosts the new "Heart & Recovery" trend card) was only opened from
`session-select` and `/stats`. The owner reported those paths don't surface it in the live app — the
training calendar lives on **Health → Training**, and tapping an exercise there did nothing.

### Fix
Wired the calendar day-overlay's exercise rows to open the history sheet:
- `components/health/day-overlay-sheet.tsx` — new `onExerciseTap(exerciseName)` prop; the exercise name
  is now a real `<button>` (kept separate from the Edit/Delete sibling buttons per the WebView
  nested-control rule) with a `ChevronRightIcon` affordance.
- `app/health/health-content.tsx` — `historyExercise` state + `onExerciseTap={setHistoryExercise}` +
  renders `<ExerciseHistorySheet exerciseName={historyExercise} userId={userId} …>`. Mirrors the proven
  `session-select` → `WeekDaySheet` → `ExerciseHistorySheet` pattern.

### Verification
- `tsc` clean, `eslint` clean (one pre-existing unrelated warning).
- **Playwright (Chromium) in dev**, logged in as the seeded user: tapping "Barbell Bench Press" in the
  Health → Training calendar day-overlay **opens its history sheet** (screenshot confirms the sheet slides
  up). Both `/api/workout/exercise-hr-trend` (coveredSets 3) and `/api/exercise-history` (9 entries)
  return **200 with data**.
- **NOT confirmed:** the sheet's content *paint* in the dev harness — the nested bottom-sheet showed
  persistent loading skeletons behind the successful 200s. Believed a turbopack dev-compile/timing
  artifact (same `ExerciseHistorySheet` ships elsewhere; server returned the data). The card's actual
  on-device paint + safe-area + Samsung-WebView sparkline rendering remain the device-gated check
  (`docs/device-smoke-checklist.md`). Known-Issues row updated in `projectOverview.md`.

Note: the earlier navigation guidance (Workout tab / streak card) was wrong — the calendar is on
Health → Training; that's now the wired entry point.
