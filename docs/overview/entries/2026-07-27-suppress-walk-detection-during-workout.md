## 2026-07-27 — Fix: false "Activity detected" walk/run popup during a workout

Owner report (with screenshots): the passive walk/run detector's "Activity detected" notification
fired at 7:48am, one minute after "Tracking your walk or run" started at 7:47am — while the owner
was mid-workout, resting between Sumo Deadlift sets (visible in the same notification shade).

### Root cause
AD-2 (ring-cadence walk/run confirmation, merged in PR #777 since the last session) confirms a walk
from the ring's decoded stride-frequency signal after ~90 s of sustained in-band cadence
(`lib/activity/gait-confirm.ts`, `CONFIRM_WINDOW_COUNT = 3`). The classifier's Hz bands
(`lib/health/gait-classifier.ts`) are explicitly marked in the code as **provisional — not yet
confirmed on-device** (physiological priors, pending a real counted-walk/run capture per the AD-2
plan's calibration task). Incidental ring/hand motion during a rest period between sets — pacing,
adjusting the bar, shaking out — sustained a cadence reading in the walk band for the required ~90 s
window and confirmed a phantom walk.

### Fix
Rather than further guess at Hz thresholds without real calibration data, added a much stronger,
zero-guesswork signal the app already has: whether a workout is actually in progress
(`useWorkoutStore().mode`). `lib/activity/auto-detection-service.ts`'s `dispatchGate()` now drops
any `motionTrigger` event (the only event that can arm GPS probing, from either the phone sensor or
the ring gate) while `isWorkoutInProgress(mode)` — true for `warmup`/`active`/`exercise-summary`,
false for `pre`/`done`. Since the AD-2 gait-confirm block is itself gated on `gate.state !== 'idle'`,
which now never leaves `'idle'` during a workout, this one guard suppresses both the ring-cadence
path and the phone-sensor fallback in a single place.

Scope note: an already-probing/tracking walk from *before* the workout started is left alone rather
than torn down (narrow edge case, not what was reported).

### Tests
- New `isWorkoutInProgress` pure predicate (`lib/activity/auto-detection-service.ts`), unit-tested in
  `lib/activity/__tests__/notify-gate.test.ts` (5 new cases covering all `WorkoutMode` values,
  including the exact reported `'active'` scenario).
- `pnpm lint` clean on changed files; no new tsc errors; `lib/activity/` + `lib/stores/__tests__/`
  suites green (98 tests). No device-only path in the fix itself (the guard is pure state-reading
  logic) — the underlying AD-2 gait-confirm/BLE path it suppresses remains APK-only and still needs
  its own on-device cadence-band calibration (unchanged, tracked in the AD-2 plan).

### Also flagged, not fixed this pass
A second screenshot showed a saved "Walk Detected" review card (25 min / 1.14 km) whose route map
had one long straight segment jumping from a tight point cluster to a single distant point —
consistent with an unfiltered single-point GPS outlier (multipath/cold-fix jump) surviving into the
route, since `simplifyRoute`'s Douglas-Peucker (`lib/activity/route-encoding.ts`) preserves the
points *furthest* from the simplified line — exactly what an outlier looks like — rather than
rejecting them. No fix applied: this needs a shared point-level speed-outlier filter across
`activity-metrics.ts`'s distance/route math (used by both auto-detection and the manual GPS-logging
flow), which is a larger, shared-code change better scoped as its own follow-up once confirmed
worth prioritizing.
