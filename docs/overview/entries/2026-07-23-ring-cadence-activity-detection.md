## 2026-07-23 — AD-2: ring-cadence walk/run detection (v1.208.0)

**Branch:** `feat/ring-cadence-activity-detection` — owner directive ("use the ring's metrics —
it's ALWAYS worn — to perfectly depict the start of a walk/run") after a stationary garage
lifting session false-positived an "Activity detected" notification via the interim GPS-distance
gate (AD-1). Implemented from the same-day plan:
[`docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md`](../../superpowers/plans/2026-07-23-ring-cadence-activity-detection.md).

### What shipped

Walk/run **confirmation** (session start + the notification) now comes from the ring's real
stride cadence instead of GPS speed — the same approach Oura's own AAD model and Garmin Move IQ
use (sustained cadence signature + duration, GPS secondary):

- **`lib/health/gait-classifier.ts`** — `classifyGait`, the single source of gait-state truth.
  Classifies a decoded gait window (`stride_frequency` Hz + amplitude features from
  `runStepsMotionDecoder`) into idle/walk/run. Bands are **provisional** (physiological priors —
  walk ≈ 90-130 spm, run ≈ 140-195 spm — not yet confirmed against a counted walk/run capture,
  the same open D-2 calibration item the step-counter work shares). The real false-positive
  defense is sustained-window confirmation, not a precisely-tuned single-window threshold.
- **`lib/activity/gait-confirm.ts`** — `pushGaitWindow`, a pure reducer (mirrors
  `motion-gate.ts`'s style) requiring 3 consecutive in-locomotion windows (~90s) before
  confirming, majority-voting the activity type, and backdating the confirmed start to the
  *first* window in the streak — not the confirm instant.
- **`lib/activity/auto-detection-service.ts`** rewired: the ring gate-feed still *arms* GPS
  probing on a walking window (unchanged), but **confirmation** now decodes every gate-feed
  window via `runStepsMotionDecoder` + `classifyGait` and feeds `gait-confirm` while probing/
  tracking. GPS-speed confirm + the AD-1 distance/elapsed notify-gate are now strictly the
  **ring-disconnected fallback** (`triggerSource === 'sensor'`).
- **Backdating required a new probe-phase point buffer** (`probeBuffer`) — not in the original
  spec's exact mechanics, but necessary to actually honour "the saved activity begins at true
  onset": GPS points arriving during the ~90s before ring-cadence confirms are buffered and
  replayed into the session once confirmed, so the route isn't clipped to the confirm instant.
- **`lib/stores/auto-detection-store.ts`** gained `pendingActivityType` (threaded through
  `startSession`/`endSession`) so the ring-confirmed walk/run type wins over the GPS-avg-speed
  guess, which now only applies in the fallback path.
- Exported `TOTAL_AMPLITUDE_MG_COLUMN`/`STRIDE_FREQUENCY_COLUMN`/`STRIDE_AMPLITUDE_FRAC_COLUMN`
  from `lib/oura-models/steps-motion-decoder.ts` (the module that owns the decoder's output
  shape) rather than duplicating the column-order knowledge.

### A real bug the dev-server smoke test caught (not unit tests)

Originally imported the column constants from `lib/oura-ble/step-counter-pipeline.ts`, which
also imports `runStepCounter`/`onnxruntime-node` for the heavier step-count model. Since
`auto-detection-service.ts` is a `'use client'` module mounted at the root layout, this dragged
`onnxruntime-node`'s native binding into the client bundle and **500'd every page**. Unit tests
didn't catch it (they don't bundle for the browser); the dev-server Playwright smoke test did.
Fixed by moving the constants into `steps-motion-decoder.ts` (pure TS, no ONNX dependency) and
importing from there instead.

### Verification

- `tsc --noEmit` clean (2 pre-existing, unrelated `onnxruntime-web` errors only); `eslint` clean.
- New unit tests: `gait-classifier.test.ts` (7 tests — band membership, degenerate/non-finite
  rejection, no gap at the walk/run boundary) and `gait-confirm.test.ts` (5 tests — no premature
  confirm, backdated start, run-majority voting, idle resets the streak, confirms once per
  session). Full suite: 617 tests passing (1 pre-existing, unrelated `wasm-parity` failure —
  missing optional `onnxruntime-web` package in this sandbox).
- `check-push-mutations.js` / `check-reconcile.js` both pass (unaffected — this isn't a
  local-store/sync domain).
- **Live dev-server pass**: confirmed the client-bundle bug reproduces and then is fixed (no more
  500s / onnxruntime errors on any page after the fix); confirmed real authenticated traffic
  still works end-to-end against the seeded dev DB.
- **NOT device-verified** — this entire path is BLE/Capacitor-gated and inert in the sandbox by
  design (no ring, no `getOuraBle()`). Needs an owner APK rebuild + the on-device smoke run
  (`docs/device-smoke-checklist.md`), including the Hz-band calibration this plan always flagged
  as the load-bearing open item: capture a counted walk, run, and stationary-lifting session,
  confirm (1) the garage session never confirms, (2) a real walk confirms within ~90s with the
  route correctly backdated, (3) a run classifies as run, (4) removing the ring mid-walk falls
  back to the GPS/AD-1 path without crashing.

### Next

The Hz bands need real on-device calibration before this can be called fully trusted — tracked
as a Known-Issues row in `projectOverview.md`. 24/7 screen-off execution remains the deferred
native chunk of the 2026-07-11 ring-triggered plan; this session only fixed the confirmation
signal in the JS/WebView (app-alive) path, as scoped.
