## 2026-07-28 — Skip the "tap Complete to rest" screen; rest timer moves onto the exercise summary (v1.228.0)

Owner-reported, in the same session as the strap/day-review bug-fix batch. After finishing an
exercise's last set, the app showed a separate "All sets done! Tap Complete to move on" screen —
a rest-ring countdown identical in appearance to the between-set rest screen, with a green
"Complete →" button as the only action. The owner reported reflexively spam-tapping that button
while just trying to rest, since it looked and behaved like every other "tap when you're ready"
prompt they'd been tapping all exercise. They asked for the exercise-summary screen to appear
immediately after the last set instead, with the rest countdown moved onto it.

### Root cause of the extra screen

`handleLogCurrentSet` (`components/workout-screen.tsx`) treated the last set of an exercise
exactly like any other set: log it, set `workoutPhase: "rest"`, increment `currentSet`. Only a
separate, explicit tap on "Complete →" invoked `handleCompleteSet` — the function that actually
posts the exercise to `/api/log-exercise` and calls `commitExerciseSummary` to switch into
`exercise-summary` mode. There was no code reason the last set couldn't finalize immediately; the
manual gate existed only so the rest-after-last-set period had somewhere to live.

### What shipped

1. **Auto-finalize on the true last set.** `handleLogCurrentSet` now tracks whether logging this
   set handed off to a superset partner or resumed a buffered exercise (`handedOff`); if neither
   happened and this was the exercise's last set, it calls `handleCompleteSet()` directly, in the
   same synchronous tick. `handleCompleteSet`'s own guard (`currentSet < sets`) was patched to read
   `useWorkoutStore.getState().currentSet` instead of the closed-over `store.currentSet` — the
   closure snapshot predates the `store.setCurrentSet(...)` call moments earlier in the same
   function and would otherwise wrongly bail out. The shared `isLoggingRef` re-entrancy guard
   already resets to `false` at the end of `handleLogCurrentSet`, before the auto-finalize call, so
   `handleCompleteSet`'s own guard doesn't self-block.
2. **The rest countdown moved to the summary screen.** New leaf component `LastSetRestTimer`
   (`components/workout/last-set-rest-timer.tsx`) self-subscribes to `lastSetRestStartMs` /
   `lastSetRestSec`, ticks via the existing `useElapsedSec` hook, and renders the existing
   `RestRing` — same visual, same math (`effectiveRestSec`, progress/remaining/overtime) as the
   in-set rest ring, just relocated. Rendered at the top of `ExerciseSummaryScreen`, above the live
   HR chart.
3. **Store lifecycle fix to carry the anchor through.** `commitExerciseSummary` no longer nulls
   `lastSetRestStartMs` (it still nulls `restStartMs`, a different field). Left uncleared, that
   anchor would otherwise leak into the *next* exercise's own ready/rest screen (which reads the
   same field) — `advance()` now clears it once, at the top, before any of its three branches
   (solo-mode exit, next exercise, workout complete), since every one of those means "leave the
   summary screen."
4. **Old screen kept as a fallback, not deleted.** The rest-ring + "Complete →" branch in
   `active-workout-screen.tsx` is now unreachable through the normal flow (React batches the
   `currentSet`/`workoutPhase`/`mode` updates from one tap into a single re-render, so the
   intermediate state is never painted) — but it's left in place rather than removed, so a session
   rehydrated from before this shipped (persisted mid-transition, or any future case where the
   auto-finalize guard doesn't fire) still has a working manual escape hatch instead of a dead end.

### Side effects considered and accepted

- The beep effect (`workoutPhase !== "rest"` gate, no mode check) now fires on schedule even while
  sitting on the summary screen, since `workoutPhase` stays `"rest"` through the transition —
  unchanged code, works correctly as a side effect of the anchor surviving longer.
- The native rest-timer status-bar chip and the scheduled rest-complete push notification are
  unaffected — both are gated on `store.mode === 'active' | 'warmup'`, so they still stop the
  instant `commitExerciseSummary` flips mode to `'exercise-summary'`, same as before this change.
  Not touched or extended in this pass.
- `restTimes`'s final entry (the "how long did they wait before tapping Complete" value posted to
  the server) will now almost always be ~0 for the auto-finalize path, since there's no more wait
  before the POST fires. The real-world dwell time on the summary screen isn't lost — it's now
  captured entirely via `interExerciseRestSec` (the existing "time before the next exercise
  starts" metric) instead of being split between that and the last `restTimes` entry. This is a
  metric-attribution change, not a data loss — matches what was already explained to the owner
  earlier in the same session about how post-exercise rest is tracked.

### Verification

`tsc --noEmit`, `eslint` (0 new errors — same 4 pre-existing unrelated warnings in
`workout-screen.tsx`), full `pnpm test` (2246 passed). **Driven end-to-end against the local dev
server with a real headless-browser session** (not just read-through): logged in as the seeded
test user, started the seeded Push session, warmed up, logged all 3 sets of Barbell Bench Press.
Confirmed the exercise-summary screen (PR badge, sets list, 1RM comparison) appeared immediately
after the third set with no intermediate "tap Complete" screen ever rendered; confirmed the new
rest ring reads "RESTING — 90 of 90s" and genuinely ticks down over real wall-clock time (87s
three seconds later); confirmed tapping "Next Exercise" moves cleanly to exercise 2 with no stale
"RESTING" countdown carried over onto its ready screen. No console errors during the run.

**Not exercised:** the superset-handoff and buffered-exercise-resume paths (`handedOff = true`
branches) — the seeded local program has no superset exercises, so these were verified by code
review only, not driven through a real click sequence. Also not exercised: a persisted/rehydrated
session actually stuck in the old pre-fix "all sets logged" state (the fallback-screen safety net)
— no such stale local storage exists in this sandbox to reproduce it against.
