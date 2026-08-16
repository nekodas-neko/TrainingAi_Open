# 2026-08-05 — Workout tab card shows "trained today" immediately, not after a tab revisit

**Domain:** workouts — v1.266.7, JS-only (no APK rebuild)

## The report

Owner: after finishing a workout, navigating back to the Workout tab's "Choose a session to
start" card list, the just-finished session's card didn't instantly reflect completion — it
looked the same as before the workout.

## Root cause (Q-89)

Not the usual missed-cache-invalidation-key bug class (CLAUDE.md's 12+ prior incidents) — every
relevant cache key genuinely is invalidated correctly by `invalidateWorkoutSummaries()`. The
defect is a stale `useMemo` local to `WorkoutSelectContent`
(`app/workout-select/workout-select-content.tsx`):

```ts
const lastTrained = useMemo(() => getLastTrainedLabel(currentSession), [currentSession]);
```

`getLastTrainedLabel` does a raw `readCacheSync('workout-card:<id>')` read *inside* the memo
callback rather than taking the card data as an argument. The post-completion refresh
(`workout-data:all`'s batch fetch) repopulates that cache entry correctly, but only calls
`forceUpdate((n) => n + 1)` afterward — a re-render, but `currentSession`'s object reference is
unchanged, so the memo skips recomputation and keeps returning whatever the cache held at the
moment `sessions` was first set (pre-completion). Only an unrelated remount (e.g. a tab revisit
bumping `tabEpoch`) ever picked up the fresh state.

## The fix

Captured the `forceUpdate` counter's value (previously discarded — `const [, forceUpdate] =
useState(0)`) and added it to the memo's dependency array, so it recomputes exactly when the
batch fetch that repopulates its cache source completes. `eslint-disable-next-line
react-hooks/exhaustive-deps` on that line, matching the established pattern elsewhere in this
codebase for a dependency the linter can't infer from the callback body (the callback reads
external cache state, not a variable in scope).

**Sibling-surface check:** the file's three other `useMemo`s (`muscleActivations`,
`sessionRecoveryMuscles`, `currentSessionPhase`) all derive from real React state
(`library`/`recoveryMuscles`/`perSessionPhaseStatus`/`phaseStatus`, each set via its own
`setState` call) rather than a raw synchronous cache read inside the memo body — `lastTrained` was
the only one with this staleness risk.

## Verification

Typecheck and lint clean (one pre-existing, unrelated warning — `hasSeeded` unused —
confirmed to predate this diff). Full suite: 400 files / 3,175 tests green, no regressions.

**Not exercised:** this is a client-side React re-render timing fix with no server API surface,
and this project has no component-level test infrastructure (`@testing-library/react`/Playwright)
to drive an automated repro. Verified by tracing the exact code path the plan diagnosed — the fix
is a single dependency-array addition whose correctness follows directly from React's
documented `useMemo` semantics — rather than an interactive dev-server click-through. No
on-device/native surface involved either way.
