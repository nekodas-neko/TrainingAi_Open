# Oura Decoupling — Own the Interpretation, Keep Oura as a Temporary Oracle

**Date:** 2026-07-21 · **Status:** Strategy brief (brainstorm consolidation — not yet a scheduled build).
**Runtime:** S25 APK (canonical), BLE-only ring.

> This is a design/decision record, not a step-by-step plan. It captures where we landed after
> working through "can we stop being tied to the Oura ecosystem." Turn the numbered work items at
> the bottom into backlog entries + implementation plans when we're ready to build.

---

## 1. Goal

Stop depending on Oura's **cloud and proprietary models** for the *interpretation* of ring data,
while keeping the parts that are pure fact. We are **not** trying to stop using the ring hardware or
the wire protocol — that dependency is permanent and fine.

Three-layer split, one rule each:

| Layer | What | Rule |
|---|---|---|
| **Decode** (`lib/oura-ble/decode.ts`) | Raw ring bytes → physiological quantities (IBI→HR, int16→°C, gait bytes→features) | Stay Oura-faithful forever. Deterministic reverse-engineering, no judgement. Keep as-is. |
| **Interpret** (`lib/health/*`) | Quantities → meaning (scores, stages, steps, "is this relevant") | Becomes **ours**. This is what we untie from Oura. Most already exists. |
| **Reference** (`lib/oura-models/*`) | Oura's vendored ML models | Demoted from the live path to an **offline oracle** we tune/validate against, then **deprecate (~2–3 months)**. |

## 2. The strategy: Oura as temporary scaffolding

The Oura models (SleepNet, step_counter, etc.) are already vendored and run **offline on our own raw
nights** — they are an Oura-equivalent yardstick that needs no cloud and carries no firmware-update
risk. Use them to calibrate our own logic for a tuning window (~2–3 months), then delete them.

**Design implication (the reason to build it generic):** because the reference is temporary, the
architecture's job is to make its removal a one-line deletion. Therefore:

- **The reference only *observes*, never *feeds*.** Our interpretation logic must compute its answer
  with zero knowledge that a reference exists. No fallback, no blend, no "use Oura when ours is null."
  A leak means we can't cleanly pull it later.
- Deprecation = delete the reference adapters + admin panel + the 87 MB of weights + `onnxruntime`,
  leaving decode + our interpretation. Nothing in the live path notices.

**Runtime win regardless of timeline:** pulling the models out of the request path removes
`onnxruntime-node` and ~87 MB of weights from serving (they are currently in it) → lighter, faster
cold starts. The files stay in-repo as dev/admin tooling until deprecation.

## 3. Decisions — model ourselves vs. keep from Oura

| Metric | Verdict | Notes |
|---|---|---|
| HR (from IBI) | **Ours** | Trivial arithmetic |
| HRV (rMSSD) | **Ours** | Standard formula, built; validate vs a chest strap (better than Oura) |
| Resting HR | **Ours** | Lowest overnight bin |
| SpO₂ | **Ours*** | *Ring-5 calibration coeffs need confirming (`lib/oura-ble/spo2.ts`) |
| Skin temp + deviation | **Ours** | Sliding-median baseline, built (`temperature-baseline.ts`) |
| Breathing rate | **Ours** | From IBI RSA, built |
| Sleep duration / efficiency / latency | **Ours** | Movement+HR+temp envelope, built |
| Sleep **score** | **Ours** | Recovered open_health weights, built (`sleep-score.ts`) |
| Readiness / recovery | **Ours** | Recovered weights + z-scores, built (`readiness-composite.ts`) |
| Activity score | **Ours** | Steps + calories + training volume |
| Energy expenditure | **Ours** | MET×time / HR — rougher than the net, acceptable |
| Illness radar | **Ours** | Rule-based, built (`illness-radar.ts`) |
| Training load / ACWR | **Ours** | Standard sports science |
| **Steps** | **KEEP Oura `step_counter`** | Our heuristic over-counts; the model is tiny/inline and validated (see §5) |
| **Sleep STAGING (hypnogram)** | **KEEP Oura SleepNet** | No independent truth; heuristic ceilinged on REM (~8–17% vs true ~23–28%) |
| **Walk/run detection** | **Ours, from PHONE sensors** | Ring model unreachable; phone accel+GPS instead (see §6) |
| Vascular age / PWV | **Drop** | Raw PPG unvalidated; irrelevant to a training app |
| Ring-based activity-type auto-tag | **Drop** | Capture-blocked (daytime raw motion night-only, no ring location) |

**Summary:** we model essentially everything ourselves except the **sleep hypnogram** (SleepNet) and
the **step count** (`step_counter`) — the two metrics where our own logic is provably worse and the
Oura model is cheap to keep. Those two graduate from "temporary oracle" to "kept model."

## 4. The comparison harness (thin, generic, reference-pluggable)

Admin-console tool, not a live-path dependency.

- **Reference source** = "given a day's raw data, produce the comparison value" (SleepNet stages,
  `step_counter`, later a Polar H10 HR stream, later nothing). Pluggable adapter.
- **Comparator** per metric = `{ metric, ours, reference, delta, withinTolerance }` for a day.
- **Registry**: adding a metric = registering `(ourComputeFn, referenceFn, toleranceBand)`.
- **Panel**: recompute both paths over a window, highlight out-of-band days, run on a cadence /
  on-demand, flag divergences for tuning.

**Tune toward a tripwire, not toward sameness.** Set a per-metric tolerance band; flag only the days
we diverge past it (those signal a bug/bad constant in *our* logic). Do **not** optimize to minimize
the gap — that just builds a worse clone of Oura and inherits its quirks. Near-term bar: "same
ballpark as Oura **and** physiologically sane" (cross-check against published norms, e.g. adult REM
~20–25%, deep ~13–23%). Longer-term north star (optional, keeps the door open): does the score
*predict something we own* — session RPE, soreness, morning feel. Log raw inputs now so that's
possible later.

**Circular-validation caveat:** the vendored models are Oura's *opinion*, not truth. They catch
gross wrongness but can't tell us Oura was right. The references that break the circle and outlive the
guardrail are **non-Oura**: a chest strap (Polar H10) for cardiac truth, manual step counts, a one-off
PSG night for sleep. Wire at least the chest strap so we aren't permanently anchored to Oura's errors.

## 5. Steps — diagnosis and fix

**Why the daily number is too high.** The daily total is `estimateSteps()`
(`lib/health/step-estimate.ts`): the ring emits a paired gait-feature window (`0x7e/0x7f`) every ~30 s;
`unpack27` yields 27 columns; **column 14 ≤ 20 ⇒ "walking"**, and each walking window credits a **flat
30 steps**. Three soft spots:

1. **Calibrated on a handful of the owner's counted walks** (2026-07-10). The code itself flags the
   `21–43` col14 band as untested. Full-day wear has motion types never sampled (driving, lifts,
   cooking, fidgeting) — any reading col14 ≤ 20 credits a phantom 30 steps.
2. **Flat 30/window is lossy both ways** — 5 real steps and 60 real steps both score 30; over ~2,880
   daily windows small false-positive rates inflate fast.
3. **The accurate path barely runs.** `countGaitGatedSteps` (`lib/oura-ble/gait-step-count.ts`) gates
   on periodicity (autocorrelation 1.4–2.8 steps/s → walk-30→31, handwave→0) but only during
   power-hungry, 5-min-boxed live-accel (`0x33`) bursts with a 5-min cooldown and radio-asleep-when-idle.
   `mergeStepSources` overrides the flat estimate only for those spans; the rest of the day stays the
   rough guess.

**Fix (80% built).** Oura's real pipeline is vendored:
- `steps_motion_decoder_2_0_0` (`lib/oura-models/steps-motion-decoder.ts`) — dequantizes the 27-col
  frames → gait features. Ported + golden-verified, but **not yet wired** into the decode path.
- `step_counter_1_3_0` — Oura's actual counter, fully inline (no big weights), built on the decoder.

Wire the decoder → build `step_counter` → **adopt it as primary** (steps is a "keep the model" case,
not tune-then-delete). Keep the periodicity-gated live counter for real-time display; retire the flat
30/window estimate. Because raw `0x7e/0x7f` frames are archived in `body_hex`, `step_counter`
**backfills the entire step history** via the redecode lever (`/api/oura-ble/samples/redecode`) — no
re-walking, no re-sync. Data isn't the constraint (daytime `0x7e/0x7f` ~80% coverage); the wiring is.

## 6. GPS + activity start

**Backfill truth: phone GPS cannot be backfilled.** The phone stores no location for any moment GPS
wasn't actively running. So a retrospective ring trigger (arrives on sync cadence, minutes late)
**cannot** start GPS for a walk that already happened. GPS is a **live-capture-only** feature.

**Capture (all native → APK rebuild, device-only verification):**
- `@capacitor/geolocation` `watchPosition` — foreground only.
- Background: native foreground service (same pattern as `OuraRingService.kt`) typed `location`,
  `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION`; or `@capacitor-community/background-geolocation`.
- **Real-time trigger:** Android **Activity Recognition API** (Play Services `ActivityRecognitionClient`,
  `ACTIVITY_RECOGNITION` perm) detects walk/run on-phone at near-zero battery and fires a transition →
  start GPS. Avoids always-on GPS drain. This trigger is on the **phone**, not the ring.
- Offline-first: live GPS sessions need a local table + outbox domain.

**Division of labour:**

| | Trigger | Backfillable? |
|---|---|---|
| Ring-derived (HR, steps, MET, "active 3–4pm") | ring, retrospective | ✅ yes — raw hex archived |
| GPS route / distance / pace | phone, **live only** (AR API or manual) | ❌ no — gone if not captured live |

**Ring's role in activity detection.** The ring streams daytime MET (`0x50` ~68%), cadence
(`0x7e/0x7f` ~80%), HR (`0x80` ~70%) — enough to **detect an active episode retrospectively** and even
coarse walk-vs-run (cadence discriminates: walk ~100–130 spm, run ~155–185+). Oura's full
activity-*type* model is blocked (needs daytime raw motion `0x72`, night-only, + ring location, absent).
The ring is the **biometric + fallback-detection** source; the phone is the **GPS route** source,
fused after the fact.

**Investigate first:** tags `0x51`/`0x52` (`activity_summary`) and `0x54` (`recovery_summary`) are
stored raw but **undecoded** — the ring may already segment activities on-device. Decode a sample
before building any detection heuristic; if the segmentation is there, the trigger is a field read, not
an inference.

**Unifying principle:** anything the *ring* measures backfills freely (raw bytes in `body_hex`,
re-decode anytime); anything *phone GPS* measures is live-or-never.

## 7. Open forks / risks

- **Sleep REM ceiling.** If we ever tried to drop SleepNet, the heuristic can't reach REM parity and
  there's no independent truth without PSG. Decision: **keep SleepNet** — do not schedule a tune-to-drop
  for staging.
- **Deprecation deadline may not hold** for any metric still diverging at T+3mo. Steps and sleep are
  already "keep the model," so the risk is small; carry the fork explicitly per metric.
- **Native work needs an owner APK rebuild** (GPS/AR, any Kotlin) and is only verifiable on-device.
- **Circular validation** — mitigate by wiring one real-truth reference (chest strap) rather than only
  Oura models.

## 8. Work items (turn into backlog entries when ready)

1. **Wire `steps_motion_decoder` + build `step_counter`; adopt as primary daily steps; backfill via
   redecode.** Highest-value, verifiable, fixes the live over-count. (§5)
2. **Decode `0x51/0x52/0x54`** to see what activity segmentation the ring already emits. (§6)
3. **Comparison harness** (generic, admin console) — start with sleep + steps references. (§4)
4. **Chest-strap (Polar H10) as a non-Oura truth reference** for cardiac metrics. (§4)
5. **Live GPS activity sessions** — phone AR trigger + foreground-service GPS + offline-first table;
   fuse ring biometrics. (§6)
6. **Move `onnxruntime`/model inference off the request path** into the offline oracle/admin harness. (§2)
