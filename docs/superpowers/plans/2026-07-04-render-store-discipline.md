# Render + store discipline — hot-path re-renders, count-up, gesture leak, store persistence

> Source: post-update review 2026-07-04 (render/Zustand pass). Perf + state-leak
> fixes; zero behaviour change except the count-up animation feel. Anchors verified
> against `main`; **re-grep before editing**. Ships as **one PR** (patch,
> merge-gate-exempt). The workout-screen tasks (1, 2) are the highest-regression-risk
> in the app — do them carefully and last, and keep the 1Hz self-tick extraction
> (its own separately-queued item) out of scope here.

## Task 1 — Narrow the orchestrator's hot-path store subscription

**Root cause:** `components/workout-screen.tsx:69-135` — the 1,077-line orchestrator
subscribes to the whole store surface in one `useShallow` pick, including hot-path
fields `perSetWeights`, `rpeValues`, `currentSet`, `workoutPhase`, `lapTimes`,
`restTimes`. Every weight-dial detent (`updatePerSetWeight`) / RPE tap creates a new
array → re-renders the full orchestrator **plus** the un-memoized 749-line
`ActiveWorkoutScreen`. (SetCard's memo holds; #160's fixes are intact.)

**Fix:** move the hot-path fields out of the orchestrator's broad pick — read
`perSetWeights[i]`/`rpeValues[i]` in the leaf that renders each set (SetCard already
gets its value via props/callback; confirm it reads its own narrow selector rather
than receiving the whole array), and read `workoutPhase`/`currentSet` where they're
actually branched on. The orchestrator keeps only the fields it genuinely
orchestrates on. Per the rule: hot-path fields are read by the leaf via its own
selector, never threaded through the orchestrator's `useShallow`.

**Verify:** React DevTools Profiler on `pnpm dev` — a weight-dial detent re-renders
only the active SetCard (and any live readout leaf), not the whole orchestrator +
ActiveWorkoutScreen tree.

## Task 2 — Memoize the 1Hz-ticked heavy leaves in ActiveWorkoutScreen

**Root cause:** `active-workout-screen.tsx:83-84` — two `useElapsedSec` hooks tick
the whole 749-line component at 1Hz while a workout runs (the deeper self-tick
extraction is a separate queued item; this task only stops the *heavy* children from
re-rendering with it). At 1Hz today: `Live1rmReadout` (`:672-679`) recomputes 1RM
from freshly-built `Array.from(...)`/`reps.slice(...)` props, and `MuscleHeatmap`
(`:455-461`) re-renders the full-body SVG from a new inline `assignments` array — on
the compositor-sensitive Samsung WebView.

**Fix:** wrap `Live1rmReadout` and `MuscleHeatmap` in `React.memo` and stabilise
their call-site props (`useMemo` the `assignments` array and the sliced/`Array.from`
inputs so identity is stable across ticks). Per the rule: memo only works with
stable props — an inline array/object literal defeats it.

**Verify:** Profiler — during a running set, `MuscleHeatmap`/`Live1rmReadout` do not
re-render every second (only when their actual inputs change).

## Task 3 — Fix `useCountUp` (final-value flash + animate-from-zero)

**Root cause:** `lib/hooks/use-count-up.ts:13-33` — initial state is
`useState(target)` but the animate branch interpolates `target * eased` from ~0. When
`target` is non-null at mount (cache-seeded — e.g. `weekly-stats-hub.tsx:16-17`), the
paint order is **final value → 0 → count up**; and a target *change* (75→78)
re-animates from 0, not from 75.
**Fix:** track a "from" value (previous displayed value, initial = target on first
mount so there's no flash) and interpolate `from + (target − from) * eased`. First
render's state must equal the first animation frame.

## Task 4 — Leaf-scope the DoneScreen count-up

**Root cause:** `components/workout/done-screen.tsx:137` runs `useCountUp` at rAF
(~60fps for 600ms) at the top of the whole DoneScreen, re-rendering the entire done
tree (stats, share-text IIFE, PR list) every frame, concurrent with the mount
confetti burst.
**Fix:** move the count-up into a small leaf component that renders just the volume
number (mirror `ScoreDisplay` in `health-score-detail.tsx:37` and `readiness-card.tsx:27`,
which are already leaf-scoped). Per the rule: rAF/animation hooks are timers — call
them in the leaf that displays the number, never at the top of a screen.

**Verify:** Profiler — the done-screen count-up re-renders only the volume leaf, not
the whole tree; the confetti burst is unaffected.

## Task 5 — TabSwipeNavigator: direction-lock + exclude scrollable ancestors

**Root cause:** `components/shell/tab-swipe-navigator.tsx:33-53` — the document-level
edge-swipe excludes only `[data-swipe-carousel]` (`:35`) and decides direction only
at touchend (`:49`). So (a) a diagonal scroll from the screen edge (dy=50, dx=80)
scrolls *and* switches tabs, and (b) Home's edge-adjacent `overflow-x-auto` metric
tiles (`metric-tiles-card.tsx:51`) can scroll *and* navigate on finger-up. It never
captures/preventDefaults (passive), so it can't swallow scrolling — the worst mode is
already avoided; this is about spurious tab switches.
**Fix:** before treating a gesture as a tab swipe, (a) direction-lock during the
gesture (bail once `|dy| > |dx|` mid-move, not only at end), and (b) exclude
scrollable ancestors via `e.target.closest('[data-swipe-carousel], .overflow-x-auto,
[data-hscroll]')`. Per the sessions-150/152 rule: global gesture recognizers must
exclude scrollers and direction-lock before acting.

**Verify (device + code):** on Home, horizontally scrubbing the metric tiles near the
edge does not switch tabs; a diagonal edge scroll scrolls without navigating; a clean
horizontal edge swipe still switches tabs.

## Task 6 — `activity-store` transient-state policy

**Root cause:** `lib/stores/activity-store.ts:96-170` — `persist()` with **no
`partialize` and no `onRehydrateStorage`**; `mode` (`'done'`), `isPaused`,
`draftSummary`, `startMs` survive reload indefinitely with no date-keyed reset
(contrast `workout-store.ts:232-249`). A killed app in `mode:'done'` restores a stale
done screen with an old `draftSummary` days later.
**Fix:** add `onRehydrateStorage` that resets the transient mode/flags/draft (and
date-keys any daily state), or `partialize` them out of persistence — cite
`workout-store` as the reference. Decide explicitly whether an in-progress (unsaved)
activity should crash-recover; if yes, keep `startMs`/elapsed but still reset
`mode:'done'`/`draftSummary`. Also note `auto-detection-store.ts:170-175` persists
`isDetecting` (an in-flight flag; currently write-only/no reader — latent) — reset it
in the same pass.

**Verify:** enter an activity, reach the done screen, kill + reopen the app → it does
not restore the stale done screen.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; add a `useCountUp` test (mount with
  a non-null target → no zero frame; target change → animates from previous).
- `pnpm dev` + React DevTools Profiler for Tasks 1/2/4; the full workout flow
  (pre → active set with RPE/dial interaction → log → rest → done) must show no
  regression.
- **Not exercisable in sandbox:** real touch-gesture feel (Task 5), 1Hz SVG repaint
  cost on Samsung WebView (Task 2), native-SQLite-backed store — declare and run the
  device smoke checklist.
- Patch bump + changelog; merge-gate-exempt. Remove this backlog entry in the same
  PR.
