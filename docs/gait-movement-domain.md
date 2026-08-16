# Gait & Movement — Domain Map + Mission

**Status:** living domain doc (2026-07-23). Orients any work on steps, walk/run detection, cadence,
distance, or movement energy. Not a task plan — the per-feature plans it links are.

## Mission

**Own the user's movement understanding on-device, derived from the ring's own gait signal —
independent of the Oura Cloud.** The ring is always worn, so it, not the phone's GPS or the Oura
Cloud, is the reliable source of "is the body moving, how, and how much." Mirror the device-primary
health-app pattern (Garmin / Apple Health / Samsung Health: the wearable computes; the cloud is
backup/sync): the phone/ring compute steps, walk/run onset, cadence, distance and movement energy
from raw BLE frames; Railway is durability/backup only. This sits under the broader
[`docs/superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md`](superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md)
(own every metric except SleepNet + step_counter; treat Oura's other models as an observe-never-feed
oracle heading for deprecation).

## The one shared signal

Everything in this domain is a derivation of **one substrate**: the ring's gait/accelerometer
stream, decoded on-device.

```
ring BLE frames
  ├─ 0x7e/0x7f gait-feature windows (~every 30 s, worn)     → pairStepFeatures/unpack27
  │     → 27 quantized gait columns
  │     → runStepsMotionDecoder (steps_motion_decoder, golden-pinned)
  │         → 11 physical gait features incl. stride_frequency (Hz), stride/gait amplitude
  └─ 0x33 / 0x47 accelerometer stream (higher rate, app-open / capture windows)
        → gaitBandAutocorr / countGaitGatedSteps (peak-count inside a sustained walking rhythm)
```

Two physical quantities fall out of this and **everything in the domain keys off them**:

- **Gait-band periodicity / cadence** — is there a sustained rhythmic locomotor signal, and at what
  frequency. `gaitBandAutocorr` scores **1.4–2.8 Hz** periodicity per window (`lib/oura-ble/gait-step-count.ts`);
  `steps_motion_decoder` gives the dequantized `stride_frequency` in Hz directly (~1.5–3 Hz walking).
- **Step events** — individual footfalls, counted only *inside* that rhythm.

## Two derivations of the same signal

Steps and walk/run detection are **not two systems — they are two questions asked of one gait
signal**:

| | **Step counting** | **Walk/run detection (activity)** |
|---|---|---|
| Question | *How many* footfalls | *Is this* locomotion, *when* did it start, *what type* |
| Core primitive | footfall peaks **inside** the walking rhythm | **sustained presence** of the walking rhythm + its cadence band |
| Shared discriminator | `gaitBandAutocorr` (1.4–2.8 Hz) rejects hand motion | **same** — a walk/run must show sustained in-band cadence |
| Shared decode | `unpack27` → `steps_motion_decoder` → `stride_frequency` | **same** frames, **same** decoder |
| Distinguishes walk vs run | (not needed for a count) | cadence **band** (stride Hz) — the count doesn't care, detection does |
| Output | daily/interval step total | a confirmed activity with type + backdated start + route |

The load-bearing consequence: **the false-positive that made "Activity detected" fire in the garage
is the same false-positive the step counter already had to solve.** `gaitBandAutocorr` exists
precisely because "the col14 gate and the naive peak counter" over-counted hand motion (handwave-0
read 114 steps naive → 0 gated; walk-30 → 31; calibrated on real captures 2026-07-13). Walk/run
**confirmation must reuse that same periodicity/cadence discriminator**, not fork a parallel one.

## Current state

### Steps (being refined now)
- **Primary daily source (D0, v1.196.0):** Oura's `step_counter` model via
  `lib/oura-ble/step-counter-pipeline.ts` (0x7e/0x7f gait + 0x47 motion → `steps_motion_decoder` →
  `step_counter`), run per local day by the rollup. ⚠ real-day totals **not yet device-verified** on
  the S25.
- **Tier-2 accurate live count:** `lib/oura-ble/gait-step-count.ts` (`countGaitGatedSteps` +
  `gaitBandAutocorr`) over the raw accel stream; **continuous daytime capture**
  (`lib/oura-ble/continuous-capture.ts`, 06–22 local) posts chunks → server count →
  `step_live_windows`. Live windows override the model for their span (`mergeStepCounterWithLive`).
- **Retired:** the flat-30 col14 estimate (`estimateSteps`/`isWalkingWindow`) — kept only as a walk
  gate + admin calibration cross-check, no longer a persisted total.
- **Open, blocks full trust (shared with detection):** `unpack27` column order vs
  `steps_motion_decoder`'s `data_columns`, and the exact **units of `stride_frequency`** — the D-2
  question in `lib/oura-ble/step-features.ts`, resolvable only against a counted walk on-device.

### Cadence (shipped v1.211.0, device-gated)
- **`lib/health/cadence.ts`** is the single derivation point for cadence from BOTH sources, and
  now owns the shared band-autocorrelation primitive (`bandAutocorrPeak`) that `gaitBandAutocorr`
  delegates to — so periodicity is genuinely implemented once, per rule 1 below.
- **Ring:** 🟡 **GATED OFF — octave-ambiguous, not wrong** (`RING_CADENCE_VALIDATED = false`).
  **D-2 is CLOSED: ×60 (steps/second) is correct.** Settled by the metronome capture
  (2026-07-27, set 120 bpm): ring windows at 1.952 Hz → ×60 = **117.1 spm** vs an independent
  strap reading of **117.5** — two sensors sharing no hardware or code, agreeing to 0.4 spm.
  ×120 would give 234, outside the plausibility ceiling.
  **The remaining defect is an octave lock**, the same one `bandAutocorrPeak` corrects on the
  strap path. Per-capture fits: 64 spm → 0.98 Hz (step, −8%); 114 spm → 1.02 Hz (**stride**,
  +7%); 120 spm → 1.952 Hz (step, −2%). The 64 and 114 captures sat on opposite sides of the
  split, which is what made the signal look *flat* against pace and produced an earlier, wrong
  "the ring does not track cadence" conclusion (now retracted — as is the retraction before it,
  which blamed the `unpack27` column order; a wrong column would not track cadence at all).
  Path to ungating: octave-correct the ring, then re-validate across metronome-set cadences.
- **Strap:** the Polar H10 publishes no cadence over BLE, so it is our own DSP over the PMD
  accelerometer (native Kotlin stream → magnitudes → `detectCadence`). Independent of the ring by
  construction, which is what makes it a real cross-check rather than a second opinion on the same
  signal.
- **The two validate each other.** `compareCadence` flags a ~2× split as a units/octave error
  rather than noise — the same factor-of-two that the D-2 question would produce.
- Gated on foot-based activity types (`CADENCE_ACTIVITY_TYPES`), **not** `is_distance_based`:
  `treadmill` is not distance-based yet is pure foot cadence, while `cycle`/`swim` are.

### Walk/run detection
- **AD-1 (interim, v1.201.2):** notification held behind a sustained GPS distance+elapsed gate
  (200 m / 90 s) so indoor GPS drift stops firing "Recording your walk". Stopgap — GPS-based.
  Plan: [`superpowers/plans/2026-07-22-activity-detection-notification-gate.md`](superpowers/plans/2026-07-22-activity-detection-notification-gate.md).
- **AD-2 (✅ SHIPPED v1.208.0, NOT device-verified):** confirms walk/run from the **ring's stride
  cadence** (`lib/health/gait-classifier.ts` + `lib/activity/gait-confirm.ts`'s sustained-window
  accumulator), not GPS — GPS demoted to route recording, session start backdated to the true
  onset via a probe-phase point buffer. This is the derivation that belongs to this domain. The
  Hz bands are still provisional pending the on-device calibration capture (shared with the D-2
  units question below).
  Plan: [`superpowers/plans/2026-07-23-ring-cadence-activity-detection.md`](superpowers/plans/2026-07-23-ring-cadence-activity-detection.md).
- **Trigger plumbing (shipped v1.131.0):** the ring gate feed (`lib/oura-ble/gate-feed.ts`) already
  drives GPS probing; the GPS watchdog (`lib/activity/gps-watchdog.ts`) bounds battery. 24/7
  screen-off execution is the deferred native chunk of
  [`superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md`](superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md).

## The unifying rules (so the two threads don't drift apart)

1. **One gait discriminator, one place.** The periodicity/cadence test (`gaitBandAutocorr` +
   decoded `stride_frequency`) is the single source of "is this a walking rhythm and at what
   cadence." AD-2's walk/run classifier is built **on top of** the step primitives — it reads the
   same decoded features and reuses the same band logic; it does not re-implement periodicity
   detection. (One-Formula-One-Place, per CLAUDE.md.)
2. **One calibration capture serves both.** A counted-walk / run / lifting-session capture on the
   S25 tunes the step gate **and** the walk/run cadence bands. The admin device-capture panel
   (cardio-system-remaining item 2) is the vehicle. **Prefer a metronome-referenced capture over a
   counted one** — hand counts run progressively low with pace, which is exactly what makes the
   strap's residual scale drift (1.00/1.04/1.08 at 64/96/114 spm) unresolvable from the 2026-07-27
   data.
3. **Steps refinement is upstream of detection.** D-2 is **CLOSED — `stride_frequency` is a step
   rate, ×60 to spm** (see the Cadence section above for the metronome evidence). AD-2's Hz bands
   can now be read in real units. What still gates step_counter trust is the **octave lock**: a
   window that locks onto the stride reports half, which is a factor-of-two error in *any* unit.
   Correct the octave before trusting a single window's absolute value.
4. **The ring is the truth; GPS/Cloud are secondary.** Steps never come from GPS; walk/run
   *presence/type* comes from the ring, GPS only draws the route. The Oura Cloud is frozen at the
   2026-07-07 re-key and feeds nothing here.

## Where each piece lives (index)

| Concern | Module |
|---|---|
| Gait-feature pairing + unpack | `lib/oura-ble/step-features.ts` (`pairStepFeatures`, `unpack27`) |
| Dequantize → physical gait features (`stride_frequency` Hz) | `lib/oura-models/steps-motion-decoder.ts` (`runStepsMotionDecoder`) |
| Gait-band periodicity + gated peak count | `lib/oura-ble/gait-step-count.ts` (`gaitBandAutocorr`, `countGaitGatedSteps`) |
| Step_counter model + real-data pipeline | `lib/oura-models/inference/step-counter.ts`, `lib/oura-ble/step-counter-pipeline.ts` |
| Step estimate + merges | `lib/health/step-estimate.ts` (`estimateSteps`, `mergeStepCounterWithLive`) |
| Continuous daytime accel capture | `lib/oura-ble/continuous-capture.ts` |
| Shared ring gate feed (steps + detection) | `lib/oura-ble/gate-feed.ts` (`subscribeGateFeed`) |
| Walk/run detection service + GPS | `lib/activity/auto-detection-service.ts`, `gps-watchdog.ts`, `motion-gate.ts` |
| Gait cadence classifier + confirm (AD-2, shipped, Hz bands provisional) | `lib/health/gait-classifier.ts`, `lib/activity/gait-confirm.ts` |
| **Cadence (spm) — both sources, shared autocorr primitive** | `lib/health/cadence.ts`, live fusion `lib/activity/cadence-tracker.ts`, console `/admin/cadence` |
| Oura's gold-standard classifier (future) | `lib/oura-models/` `automatic_activity_detection_3_1_11` (heavy; WASM-spike-gated) |

## Related plans

- Steps: [`2026-07-15-oura-movement-steps-activity-energy.md`](superpowers/plans/2026-07-15-oura-movement-steps-activity-energy.md),
  [`2026-07-09-oura-ble-own-step-counter.md`](superpowers/plans/2026-07-09-oura-ble-own-step-counter.md)
- Detection: AD-1 / AD-2 (above), 2026-07-11 ring-triggered walk detection
- Umbrella: [`2026-07-21-oura-ondevice-hybrid-master-plan.md`](superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md),
  [`2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`](superpowers/plans/2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md)
- Protocol / BLE ops: [`docs/oura-ble-operations.md`](oura-ble-operations.md), the `oura-native-ble`
  + `oura-models` skills
