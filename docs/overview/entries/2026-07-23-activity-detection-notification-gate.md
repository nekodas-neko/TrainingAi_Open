## 2026-07-23 — Auto walk/run "Activity detected" notification gate (v1.201.2)

Owner report: the "Activity detected · Recording your walk or run" heads-up fired while training
stationary in the garage. Planned (AD-1) and implemented in the same PR
(`claude/auto-exercise-sensitivity-b53ynd`) at the owner's request.

### Root cause
The passive walk/run detector posted the ping at session **start** — on the first GPS point whose
rolling avg speed cleared `MIN_MOVE_SPEED_MS` (0.8 m/s), in `auto-detection-service.ts` `onPoint()` —
**before** any lower-bound quality gate ran. Indoor/garage GPS multipath drifts the fix 5–20 m between
readings while stationary, which reads as ~3–5 km/h and cleared that bar. The real save gates
(`detection-thresholds.ts`: 750 m / 2.5 km/h / 7 min + P80 motorised) only run in `endSession()`, so
the garage session was still correctly discarded and nothing was saved — the only defect was the
premature notification.

### What shipped
- `lib/activity/auto-detection-service.ts`: removed the fire-on-first-point `notifyActivityDetected()`.
  The ping is now held behind a per-session `activityNotified` latch and fires at most once, only after
  the live session accumulates `NOTIFY_MIN_DISTANCE_M` (200 m) over `NOTIFY_MIN_ELAPSED_SEC` (90 s) —
  above indoor drift, below the 750 m save floor so a genuine walk still pings early. Distance/elapsed
  read from fresh `useAutoDetectionStore.getState().sessionPoints` after `addPoint` (the captured
  snapshot is stale post-`set`). Latch resets in `startGps()` (so a second walk in the same run
  re-notifies) and `stopAutoDetection()`.
- Extracted the pure predicate `shouldNotifyActivity({ distanceM, elapsedSec, alreadyNotified })` so the
  gate is unit-testable without a device.
- **No change** to detection/session-start, the gate reducer (`motion-gate.ts`), the save gates, or the
  GPS watcher — what gets *saved* is identical.

### Verification (sandbox)
- New `lib/activity/__tests__/notify-gate.test.ts` (6 tests): stationary drift → no ping; distance-only
  / elapsed-only → no ping; sustained walk → fires once; boundary (200 m/90 s inclusive) → fires;
  already-notified → no re-fire.
- Lint clean on changed files; changed files tsc-clean; all `lib/activity/` + `auto-detection-store`
  suites green. Full run: 1867 pass / 138 skip, **1 pre-existing failure** (`wasm-parity.test.ts` can't
  import `onnxruntime-web` — declared in package.json but not installed in this sandbox; present on
  `main`, unrelated). tsc/build's only errors are the same missing-dep gap; CI has the full dep tree.

### NOT exercised in the sandbox (device-gated, APK-only)
- The significant-motion sensor → GPS watcher → Capacitor local-notification chain does not run in the
  web/dev sandbox (`Capacitor.isNativePlatform()` false). On-device smoke is the real merge gate — a
  Known-Issues row was added to `projectOverview.md`. Owner check: (1) stationary garage session → no
  ping; (2) real ≥200 m walk → one ping ~90 s/200 m in, walk still saves.

Plan: `docs/superpowers/plans/2026-07-22-activity-detection-notification-gate.md`.
