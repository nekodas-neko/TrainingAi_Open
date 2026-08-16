# 2026-07-20 — W5: deload correctness (wiring/caching-perf audit §4)

**Branch:** `fix/deload-correctness-batch` · **Version:** 1.184.3 (early deload now changes prescribed load)

Fifth audit-batch item — two server-only correctness fixes on the deload paths.

## What landed

1. **Confirming an early deload actually reduces load now.** `isDeloadActive()` was true during the
   7-day `earlyDeloadWeekStart` window, but the phase feeding `resolveStyleForExercise` was still the
   *natural* (e.g. accumulation) phase, so full-load styles kept being prescribed — the home card's
   "Take deload week now" copy promised a reduction the code didn't deliver. New
   `deloadAwareStylePhase(currentPhase, allPhases, isDeloadActive)` (`lib/phase-engine.ts`) swaps in
   the program's `phaseType==='deload'` phase for style resolution during the window, wired into
   `buildWorkoutExercises`. Gated so: real deload phases are untouched (they already resolve their
   own style), normal sessions are unaffected, and it falls back to the natural phase when the
   program has no deload phase (no reduction possible). Passed `isDeloadActive` through the ctx at
   both `workout-data` build sites.
2. **Emergency deload can't self-trigger on the just-completed session.** `complete-workout` fires
   `/prescribe` immediately after marking a session complete, and `aggregateSignals` computed
   `hoursSinceLastSession` from the most recent completed session — which is that very session, so
   the gap was ≈ 0 by construction and could satisfy the `<36h` emergency condition. `aggregateSignals`
   now accepts an `excludeSessionId` (threaded `complete-workout` → `prescribe` request body →
   `aggregateSignals`) that's excluded from the `hoursSinceLastSession` lookup **only** — the session
   stays in `last5` for the RPE-delta and prescription-guard logic, which legitimately want it.

## Verification

- tsc + lint clean (0 errors). 5 new `deloadAwareStylePhase` unit tests (asserting the deload style
  is actually resolved during an early deload); phase-engine / emergency-deload / reevaluate / workout
  suites green (135 across those). Production build green. Server/JS only — no device gate.
- Note: fix 2's exclusion is a self-evident one-line predicate; no `aggregateSignals` repo-mock
  harness exists in the repo, so it's covered by types + the phase-engine helper test rather than a
  new full-mock integration test.
