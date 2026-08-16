# Ring-cadence walk/run detection — confirm from the ring's gait signal, not GPS

> **IMPLEMENTED 2026-07-23 (v1.208.0).** Built in-session at the owner's request, on branch
> `feat/ring-cadence-activity-detection`. The design below shipped essentially as specified:
> `lib/health/gait-classifier.ts` (`classifyGait`, provisional Hz bands — calibration still open,
> see below), `lib/activity/gait-confirm.ts` (sustained-window accumulator + backdating), and
> `lib/activity/auto-detection-service.ts` rewired so ring cadence confirms (start session + fire
> the notification), GPS only records the route, and the old GPS-speed confirm + AD-1
> distance/elapsed gate is now strictly the ring-disconnected fallback.
> One addition beyond the original spec: a **probe-phase point buffer**
> (`probeBuffer` in `auto-detection-service.ts`) was needed to actually honour the "backdate to
> true onset" requirement — GPS points arriving before ring-cadence confirms are buffered and
> replayed into the session once confirmed, otherwise the first ~90s of route would be silently
> lost. `lib/stores/auto-detection-store.ts` gained `pendingActivityType` so the ring-confirmed
> type threads through to `endSession()` instead of only ever being derived from GPS avg speed.
> **NOT device-verified** (sandbox has no BLE/Capacitor — this entire path is inert here by
> design); needs an owner APK rebuild + the on-device smoke run below, including the **Hz-band
> calibration** this plan always flagged as the load-bearing open item. One real bug caught only
> by a dev-server smoke test (not unit tests): importing the column-index constants from
> `step-counter-pipeline.ts` dragged `onnxruntime-node` into the client bundle and 500'd every
> page — fixed by moving the constants into the pure `steps-motion-decoder.ts` module instead.

**Source:** owner directive 2026-07-23 — "use the ring's metrics (it will ALWAYS be worn) to
perfectly depict the start of a walk/run." Supersedes the GPS-speed confirmation path that produced
the garage false-positive. Branch: `feat/ring-cadence-activity-detection`.

## Goal

Make walk/run **confirmation and the "Activity detected" notification** ride on the ring's own gait
cadence — the way Oura and Garmin actually detect activity (sustained motion/cadence signature +
duration, GPS secondary) — instead of GPS speed. The ring is always worn, so its gait signal is the
reliable "is this a walk/run" signal; GPS only records the route. Result: a stationary garage
session never confirms (no sustained stride cadence), and a real walk/run confirms at its true start.

## Why this is the right approach (grounded in the vendored Oura models)

Oura's own Automatic Activity Detection model (`lib/oura-models/`,
`automatic_activity_detection_3_1_11`) classifies from `met`, `stepmotion`, `motion`, `heartrate`,
`temperature` — **`location` (GPS) is `Optional` and usually absent** (the ring has no GPS). Garmin
Move IQ is the same: wrist cadence + HR pattern, ~10-min minimum, GPS secondary. Neither uses "moved
X metres at Y speed" as the trigger — GPS drift is exactly the failure mode that fools that. The
signal both use is **cadence** (a sustained stride frequency) plus a **minimum duration**.

We already have that signal on-device, in real time, for free:

- `lib/oura-ble/gate-feed.ts` already emits a paired gait-feature **window every ~30 s** while the
  ring is worn (`0x7e`/`0x7f` → `unpack27` → 27 quantized gait columns). This feed already drives
  GPS probing today (shipped v1.131.0, Chunks 1+2 of
  `docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md`).
- `lib/oura-models/steps-motion-decoder.ts` (`runStepsMotionDecoder`, golden-pinned) dequantizes
  those **same 27 columns** into physical gait features including **`stride_frequency` (Hz)**,
  `stride_amplitude_frac`, `total_amplitude_mg`, `gait_amplitude_frac`. This is Oura's real
  dequantization — the actual cadence, not a heuristic. **No new BLE work: the frames already flow.**
- `lib/oura-ble/step-features.ts` notes column **0** (`STEP_GAIT_GATE_COLUMN`) "cleanly separates
  idle from walking, zero overlap (n=13, session 242)" — a cleaner gate than the current crude
  `col14 ≤ 20` (`WALK_CADENCE_COLUMN`), which the calibration comment admits is imperfect (hand
  activity can read low). The garage false-positive is consistent with a col14/any-motion misfire
  confirmed by GPS drift.

So the plan: replace the **confirmation** signal (GPS speed) with a **sustained real-cadence**
classifier off the decoded stride frequency, and demote GPS to route recording. This is the
deterministic, testable 90%-of-the-benefit version of what Oura's neural AAD does.

> **Domain context:** steps and walk/run detection are two derivations of the *same* ring gait
> signal — see [`docs/gait-movement-domain.md`](../../gait-movement-domain.md). The step-counting
> refinement already built the cadence/periodicity discriminator this plan needs
> (`gaitBandAutocorr`, 1.4–2.8 Hz, in `lib/oura-ble/gait-step-count.ts`); reuse it, don't fork it.

## What exists / reuse map

| Piece | Where | Role in this plan |
|---|---|---|
| Paired gait windows (~30 s), 27 cols | `lib/oura-ble/gate-feed.ts` (`GateFeedEvent.columns`) | **input** — subscribe as today |
| Dequantize → `stride_frequency` Hz etc. | `lib/oura-models/steps-motion-decoder.ts` (`runStepsMotionDecoder`) | **new confirmation input** |
| Crude walk gate `col14 ≤ 20` | `lib/health/step-estimate.ts` (`isWalkingWindow`) | upgrade → cadence classifier |
| Cleaner idle/walk separator col0 | `lib/oura-ble/step-features.ts` (`STEP_GAIT_GATE_COLUMN`) | cross-check / fallback signal |
| GPS on/off reducer | `lib/activity/motion-gate.ts` | keep — trigger unchanged |
| Session confirm + save gates | `lib/stores/auto-detection-store.ts`, `lib/activity/detection-thresholds.ts` | keep as **save** gates |
| GPS-speed confirm + AD-1 distance notify-gate | `lib/activity/auto-detection-service.ts` | becomes **ring-disconnected fallback only** |
| Live HR (optional cross-check) | Oura BLE live-HR path | optional secondary signal |
| Native always-on port | `2026-07-11` plan Chunk 3 (deferred) | cross-ref — 24/7 background lives there |

## Design

### 1. A cadence classifier (One-Formula-One-Place)

New `lib/health/gait-classifier.ts` — pure, unit-tested, the single source of walk/run cadence
truth (imported anywhere gait state is needed; do not re-derive bands elsewhere):

```
classifyGait(features: { strideHz: number; strideAmpFrac: number; totalAmplitudeMg: number })
  → { state: 'idle' | 'walk' | 'run'; strideHz: number }
```

- `idle` unless `strideAmpFrac`/`totalAmplitudeMg` clear a minimum motion floor (rejects
  desk/lifting noise that has no locomotor rhythm).
- `walk` vs `run` from the stride-frequency band. **Do NOT hard-code the Hz thresholds from
  memory** — the exact definition of Oura's `stride_frequency` (per-step vs full gait cycle) is the
  open item flagged in `step-features.ts` (D-2, "confirm the column order/units against a counted
  walk on-device"). Start from physiological priors (walk cadence ≈ 90–130 steps/min, run ≈
  140–195 steps/min) and **finalise the bands against real decoded frames from the owner's counted
  walk + run captures** (calibration task below). Ship the bands as named constants with the
  calibration source in a comment, mirroring `step-estimate.ts`'s calibration note.

### 2. Confirm on *sustained* cadence (the Oura/Garmin "signature", not one point)

Add a small pure accumulator `lib/activity/gait-confirm.ts`:

- Feed each ~30 s window's `classifyGait` result in order.
- **Confirm** a session once there are **≥ N consecutive in-locomotion windows** (walk or run) —
  start N=3 (≈ 90 s of continuous real cadence). A lifting set cannot produce 90 s of continuous
  in-band stride frequency; a real walk crosses it naturally. N is a named, tunable constant.
- The confirmed **activity type** = majority band across the confirming windows (walk/run).
- **Backdate** session start to the **first** in-band window in the confirming run, so the recorded
  route/duration begins at the *true* onset even though confirmation lands ~90 s in. This is how the
  UX "perfectly depicts the start" while still requiring a sustained signature — the notification
  fires at +90 s but the saved activity starts at 0.

### 3. Rewire `auto-detection-service.ts`: ring confirms, GPS records

- **Trigger (arm GPS)** — unchanged: a ring walking window (existing `subscribeGateFeed`) or the
  phone significant-motion sensor fallback. GPS turns on to start capturing the route immediately.
- **Confirm (start session + fire notification)** — driven by the **gait-confirm accumulator**, not
  by GPS `speed >= MIN_MOVE_SPEED_MS`. On each gate-feed window while GPS is probing/tracking:
  decode the columns (`runStepsMotionDecoder`), `classifyGait`, push into `gait-confirm`; when it
  confirms, call `store.startSession(firstInBandWindowMs)`, `dispatchGate('sessionStarted')`, and
  fire `notifyActivityDetected()` once (keep the one-shot latch from AD-1).
- **GPS points** keep populating `store.addPoint` for the route/distance, but no longer *confirm* or
  fire the notification. The motorised-speed / stall / watchdog end logic is unchanged.
- **Walk vs run** now comes from the ring cadence band, not `RUN_SPEED_THRESHOLD_MS` — thread the
  confirmed type into the pending session (GPS avg-speed stays a secondary sanity check in
  `endSession`).
- **Ring-disconnected fallback:** if no ring gate windows are arriving (ring off/disconnected — rare
  since always worn), fall back to the **existing** GPS-speed confirm + the **AD-1 distance/elapsed
  notify-gate** (already on this branch). That path is structurally the lower-fidelity backup; the
  ring path is primary whenever windows are flowing (`triggerSource === 'ring'`).

### 4. Optional HR cross-check (secondary, not a gate)

The live-HR path can require HR to be elevated-but-sub-max to corroborate walk/run vs a false
cadence match. Keep it advisory (raise confidence / disambiguate), never a hard gate — HR lags onset
and the ring power-gates HR when worn-idle. Deterministic cadence stays the primary signal.

### 5. Highest-fidelity option (noted, NOT the baseline)

The ported Oura **AAD neural model** (`automatic_activity_detection_3_1_11`, ~4 M params) is the
gold-standard classifier and would give true Oura parity (it fuses met/motion/HR/temperature). It is
heavier (ONNX/WASM, needs the WASM numerical-parity + S25-perf spike that is Phase-1 step 0 of
`2026-07-21-oura-raw-on-device-phase-1.md`) and runs retrospectively over a window. **Scope it as a
later upgrade**, not this PR: the deterministic stride-frequency classifier above captures the walk/
run start-detection benefit now, is unit-testable without a device, and reuses signal we already
decode. Revisit AAD once the on-device WASM runtime lands for the rollup.

## Native vs JS (state honestly in every PR)

- The classifier + confirmation rewire is **JS/TS** — ships via Railway into the WebView, runs while
  the app is alive or recently-alive (same coverage envelope as today's ring-gate GPS trigger and
  the step orchestrator).
- **True 24/7 screen-off/app-killed** detection is **Chunk 3 of the 2026-07-11 ring-triggered plan**
  (native `OuraRingService` port). This plan does **not** own that — it makes the *confirmation
  signal* correct; the always-on execution context is the deferred native chunk. Cross-reference, do
  not duplicate. When Chunk 3 lands, port `classifyGait`/`gait-confirm` to Kotlin with a JVM parity
  test pinning the TS constants (same discipline as the gate port).

## Files (implementation)

- New: `lib/health/gait-classifier.ts` (+ `__tests__`) — `classifyGait`, cadence bands.
- New: `lib/activity/gait-confirm.ts` (+ `__tests__`) — sustained-window accumulator, backdating.
- Modify: `lib/activity/auto-detection-service.ts` — decode gate-feed windows, drive confirm from
  the ring, demote GPS-speed confirm + AD-1 notify-gate to the ring-disconnected fallback, thread
  the ring-derived activity type.
- Modify: `lib/stores/auto-detection-store.ts` — accept a caller-supplied `activityType` on
  `startSession`/pending session instead of deriving it only from GPS avg speed.
- Possibly: `lib/health/step-estimate.ts` — upgrade `isWalkingWindow` to the col0/stride-frequency
  signal (or leave the daily-steps gate as-is and keep the new classifier separate — decide during
  implementation so the steps total isn't perturbed; if touched, re-run the steps calibration test).
- Docs: `docs/module-map.md` row for the new gait classifier; `docs/oura-ble-operations.md` §1 row
  if a new failure signature is introduced.

## Calibration (device-gated — the load-bearing task)

The Hz bands and the motion floor are only as good as the frames they're tuned on. Using the
already-planned **admin device-data capture panel** (cardio-system-remaining item 2) or an ad-hoc
capture:

1. Capture decoded gait frames for: (a) a **counted walk**, (b) a **run**, (c) a **stationary
   lifting session** (the false-positive case), (d) desk/idle.
2. Confirm the units/column order of `stride_frequency` against the counted walk (closes the
   `step-features.ts` D-2 open item).
3. Set the walk/run bands and the idle motion floor so (a)/(b) confirm and (c)/(d) never do, then
   pin those exact frames as unit-test fixtures.

## Verification

- **Sandbox (unit):** `classifyGait` and `gait-confirm` fully unit-tested from decoded-column
  fixtures — idle/desk → no confirm; lifting fixture → no confirm (the key regression); sustained
  walk → confirms at N windows, type `walk`, start backdated to the first in-band window; sustained
  run → type `run`. `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- **Device (authoritative — APK-only; BLE + notifications inert in sandbox):** run
  `docs/device-smoke-checklist.md`. (1) Garage lifting session → **no** "Activity detected", no walk
  saved. (2) Real walk → confirms within ~90 s, notification fires once, saved activity's start time
  is the true onset (backdated), distance/route correct. (3) Run → classified as run. (4) Ring
  removed mid-test → falls back to the GPS-speed + AD-1 path without crashing. Ships with a
  `projectOverview.md` Known-Issues row until the on-device calibration + smoke run is done.

## Relationship to AD-1 (already on this branch)

AD-1 (the GPS-distance/elapsed notification gate, v1.201.2) is the **interim** fix and remains as the
ring-disconnected **fallback**. This plan supersedes it as the *primary* path: once ring-cadence
confirmation ships, the GPS-speed confirm + distance gate only run when no ring windows are flowing.
Do not remove AD-1 — repurpose it as the documented fallback.

## Rollback

Additive new modules + a confirmation-source swap gated on `triggerSource === 'ring'`. If the ring
path misbehaves on-device, flip the service to always use the GPS/AD-1 fallback (one branch) while
the cadence bands are re-calibrated — no data or schema involved.
