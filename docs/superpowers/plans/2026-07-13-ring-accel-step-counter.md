# Ring-only accurate step counter via chunked accelerometer capture

**Owner directive (2026-07-13):** move the day's step count off the col14 estimate and onto
the ring's real accelerometer, counted in battery-friendly chunks and back-filled — the ring
is the step source, Health Connect stays off.

**Status of the investigation feeding this plan (all validated on-device this session):**
- The col14 walk-gate estimate over-counts and is unfixable: it can't separate walking from
  rhythmic hand motion (cooking 20 real → 210). Retired by this plan.
- The realtime accelerometer stream (`0x33`, `SetRealtime(ACM)`) is the accurate signal, but
  the ring's **automatic measurements (DAYTIME_HR + SPO2 + REAL_STEPS) preempt it** — with them
  on, `startAccel` acks but zero `0x33` frames arrive; with them OFF, frames stream (confirmed
  via native command/response logging, PR #477). This is why it "worked before" (the accel
  spike predated enabling REAL_STEPS).
- A naive peak counter over `0x33` is accurate for walking but counts hand motion / standing
  still too (stand-still 0 real → 102 naive). The fix is **`countGaitGatedSteps`**
  (`lib/oura-ble/gait-step-count.ts`, shipped PR #480): count peaks only inside a sustained
  1.4–2.8 Hz walking rhythm. Validated on 4 real captures:

  | capture | real | naive | gait-gated |
  |---|---|---|---|
  | stand-still | 0 | 102 | **0** |
  | hand-wave | 0 | 114 | **0** |
  | walk-30 (steady) | 30 | 31 | **31** |
  | quick-walk-30 (brisk) | 30 | 32 | **24** |

  Non-walk → 0 (clean). Walking kept, but brisk/short walks under-count ~20% (safe direction,
  a calibration item — see Chunk 4).

## REVISION (2026-07-13, evening) — gate-triggered duty-cycling is dead; continuous day-streaming is the architecture

Chunk 1b (auto-capture triggered by the gate feed) shipped and disproved the trigger design
on-device: **the `0x7e/0x7f` gate frames only arrive on the hourly history drain** — there is
no ring-only real-time "user started walking" signal, so a walk never opens a capture window
live. Two further on-device findings replace the design:

- **Only REAL_STEPS (0x0b) blocks the `0x33` stream.** DAYTIME_HR and SPO2 keep recording
  *internally* while accel streams (proven via the HR-coverage readout: no gap during a
  streaming session). The "capture windows cost HR/SpO₂ gaps" risk above is void — only step
  *recording* is paused, and accel-derived counts replace it.
- **HR/SpO₂ are recorded on-ring and backfill on drain; raw accel is not recorded** and can
  only be caught live. So steps are the one signal that must stream.

**Revised architecture (day/night split), decided with the owner:**
- **Day window:** REAL_STEPS off; DAYTIME_HR + SPO2 stay AUTOMATIC (backfill hourly);
  `0x33` accel streams **continuously** to the phone; magnitudes post to the server, which
  runs `countGaitGatedSteps` and deletes the raw buffer after counting. Continuous beats
  duty-cycling: with no real-time trigger a duty cycle is a blind timer that misses steps by
  construction, and every start/stop is a `SetRealtime` failure point (zombie sessions seen
  on-device). If drain is pathological (>~8%/hr) the fallback is a narrower streaming window,
  not duty-cycling.
- **Night:** no streaming; ring fully stock (sleep staging, HRV, HR untouched).
- **Live-HR priority:** streaming pauses while live-HR/a workout runs (coexistence untested);
  step loss during a lift is negligible and the gait gate rejects lifting motion anyway.
- **Ops rules (all hit on-device):** drain history *before* starting a capture day; a stream
  watchdog re-arms on stall (stream is time-boxed ~5 min, and every reconnect re-enables
  REAL_STEPS via the service's `enableMeasurement`, killing the stream); feature restore at
  day end / on stop is guaranteed-path, with the service's connect-time re-enable as the
  self-heal backstop.
- **Battery gate:** the overnight idle baseline read ~20% (87→67) but is untrusted — measured
  after a heavy BLE test day with the ring's coarse/laggy gauge. The **battery-soak tester**
  (`lib/oura-ble/battery-soak.ts` + debug-screen card, v1.141.0) produces the clean daytime
  drain curve; owner charges twice daily so the bar is "survives an ~8 h stretch". The soak
  *validates* the continuous design rather than deciding it.

Chunk 1 below is superseded in shape (no gate-triggered windows): the build is a **continuous
capture loop + server-side counting pipeline** (store magnitudes → gait-count → delete raw).
**Chunk 1 (revised) SHIPPED v1.143.0** — `lib/oura-ble/continuous-capture.ts` + POST
`/api/oura-ble/accel-chunks` + `oura_accel_chunks` (migration 122) → `step_live_windows`
(source `continuous-accel`); default-OFF toggle on `/admin/oura-ble`; battery logging folded
in, so the owner's first real day replaces the standalone soak (decided with the owner —
they charge twice daily, and the pathological-drain fallback is a narrower window, which the
build supports by constant). Chunks 2–4 stand as written; Chunk 2 waits on day-one numbers
(gait totals vs Garmin) before the cutover.

## Goal / end state
- `body_metrics.steps` for the day is derived from **gait-gated accel counts**, not col14.
- Counting is **duty-cycled**: a short accel-capture window fires only when the ring's own
  motion/gate signal says the user is moving; idle time costs no extra radio/battery.
- Works with the app **closed** (native, Chunk 3) — foreground JS (Chunks 1–2) is the
  provable-in-sandbox first stage and already useful while the app is open.
- **Never runs during a workout / while live-HR is active** (shared radio) and **always
  restores** the automatic measurements after a window (even on error/disconnect).
- Coexists with auto walk-detection (shares the gate feed, sequences the REAL_STEPS toggle).

## Architecture — the three coordination points (the hard part)
The ring has ONE realtime radio and its accelerometer is shared between the automatic
ACM-intensity measurement and the realtime `0x33` stream. Every capture must:

1. **Yield to live-HR / workouts.** Live HR uses the same realtime radio; the existing step
   orchestrator already polls `LiveHrManager.isRunning()` and yields. The capture must do the
   same — **skip entirely if live-HR is running or a workout is active.** Capturing during a
   workout would also blank workout HR for the window (measurements are off) — unacceptable.
2. **Toggle REAL_STEPS in sequence with walk-detection.** REAL_STEPS being ON is what emits the
   `0x7e/0x7f` gate frames that both the col14 path and `auto-detection-service.ts` (GPS walk
   detection) trigger on. The capture turns the automatic features OFF, so it must: let the
   **gate feed detect the walk first** → then run a bounded accel-capture window → then
   **restore** the features. Detect on gate frames, refine with accel — complementary, not
   competing. During the (short) capture, walk-detection's gate trigger is paused; acceptable
   because a walk was already detected to start the capture.
3. **Motion-triggered cadence + guaranteed restore.** Capture only on a walking gate window
   (not a fixed timer). Bound each window (e.g. 30–60 s). **Always** re-enable the automatic
   features in a `finally`/on-disconnect path so a crashed capture can't leave HR/SpO₂/steps
   recording off.

## Chunks (independently landable; Chunks 1–2 JS, Chunk 3 native + APK rebuild)

### Chunk 1 — Foreground capture orchestrator (JS, app-open only)
Extend the existing `lib/oura-ble/step-orchestrator.ts` (or a sibling `accel-capture.ts`) so a
gate-triggered walking bout runs a real accel-capture window:
- On a walking gate window while idle **and** `!LiveHrManager.isRunning()`: disable
  DAYTIME_HR/SPO2/REAL_STEPS (`setFeatureMode … OFF`), `startAccel`, buffer `0x33` magnitudes.
- End the window on: idle-streak / duration cap / disconnect → `stopAccel` → **re-enable the
  features** → `countGaitGatedSteps(buffer, rate)` → POST to `/api/oura-ble/live-steps` (existing
  route + `step_live_windows` table).
- **Use `countGaitGatedSteps`, not the naive `StepPeakCounter`**, for the posted count.
- Pure decision core stays unit-tested (`step-orchestrator-core.ts` pattern); the
  feature-toggle + restore-on-error path is the new effectful surface.
- Verification: dev-DB (route + rollup) green; on-device is the real gate (no ring in sandbox).

### Chunk 2 — Make accel counts the day's step source; retire col14
- Rollup: `body_metrics.steps` for a day = sum of that day's gait-gated `step_live_windows`
  (already the Tier-2 source via `mergeStepSources`); **stop letting the col14 estimate set the
  day total** — remove it from the rollup, or demote to a clearly-flagged fallback only for
  days/spans with zero accel coverage (decide during build; leaning remove).
- Close the additive-stacking gaps flagged earlier: `body-metadata` adds `activity_logs`
  (treadmill) steps on top of `body_metrics.steps` (double-count risk if the ring also counted
  them); `mergeStepSources` adds non-overlapping live windows on top of the estimate — both must
  be reconciled once accel is the source.
- Verification: dev-DB rollup tests (walk windows → day total; no col14 contribution).

### Chunk 3 — Native background capture (Kotlin, APK rebuild) — the all-day counter
- Move the Chunk 1 loop into `OuraRingService.kt` so it runs with the app closed: gate-triggered
  window, feature-toggle, accel buffer, count (port `countGaitGatedSteps` to Kotlin **or** post
  raw windows for server-side counting), post to the ingest/live-steps path.
- Keep the JS foreground path as the in-app fast path; native is the always-on one.
- Requires `npx cap sync android && ./gradlew assembleDebug` + install; on-device soak is the
  gate. This is the piece that makes the ring a real all-day pedometer.

### Chunk 4 — Recall calibration
- The brisk-walk under-count (24/30) is edge-trim on short bouts. Options: shorter analysis
  window for faster rhythm-lock, a small empirical scale factor, or better ramp handling. Retune
  `GAIT_*` constants in `gait-step-count.ts` (One-Formula-One-Place) against more labelled
  captures (steady/brisk/slow/stairs). Owner captures via the Live step test's gated readout.

## Risks / open questions
- **Battery**: duty-cycled accel + feature-toggling has a real cost; window length/interval and
  "only when moving" are the levers. Measure on-device before trusting all-day use.
- **Measurement gaps**: every capture window is a gap in HR/SpO₂/step-history recording. Keep
  windows short; never capture during sleep/workouts; confirm the gaps don't degrade
  readiness/sleep data.
- **Restore reliability**: a capture that dies without restoring features leaves the ring not
  recording — the guaranteed-restore path (Chunk 1/3) is load-bearing and must be tested against
  mid-capture disconnect.
- **Native complexity** (Chunk 3): the port + on-device tuning is the largest unknown; Chunks
  1–2 deliver value app-open first so the native piece can be sequenced separately.
- **Walk-detection interplay**: confirm pausing REAL_STEPS for a capture window doesn't drop a
  walk-detection event that was mid-flight.

## Relationship to existing queue items
- Supersedes the col14-estimate half of **item 2** (step orchestration) — that item's
  `step_live_windows`/`mergeStepSources`/orchestrator scaffolding is reused; its col14 estimate
  is retired here.
- Shares the gate feed (`lib/oura-ble/gate-feed.ts`) with **item 1** (ring-triggered
  walk-detection) — coordination point 2 above.
