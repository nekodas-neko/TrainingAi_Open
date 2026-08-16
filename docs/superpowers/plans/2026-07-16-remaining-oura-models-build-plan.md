# Remaining Oura models — build plans (the orphaned ⭐ set)

Covers every relevant model surfaced by the 2026-07-16 inventory (`docs/oura-models-inventory.md`) that
isn't yet wired. Each section is a self-contained mini-plan: inputs (from the vendored spec), the key
logic (read from `scripts/oura-models/_source/<model>/`), BLE-data availability, the integration surface,
the feasibility gate, and build steps. Source + specs are already preserved, so any of these can be built
without the original `.pt`.

**Shared feasibility gate (steps/stress/activity) — ANSWERED on-device 2026-07-16.** The
`/admin/oura-ble` "Daytime signal coverage" probe (last 7 days, worn-idle) shows the ring **does**
stream the daytime signals — with one exception:

| Signal | Daytime share | Verdict |
|---|---|---|
| Steps `0x7e/0x7f` (stepmotion) | **80%** (~10.6k/wk) | ✅ dense all-day |
| Heart rate — IBI `0x80` | **70%** (~13k) | ✅ real daytime HR |
| MET `0x50` | **68%** | ✅ present |
| Skin temp `0x46` | continuous 24h | ✅ present |
| Raw motion `0x72` | **2%** | ❌ sleep-only |
| HRV `0x5d` | **7%** | ❌ night-only (impute daytime — this is why `dhrv_imputation` exists) |

So the daytime stack = **stepmotion ✅, HR ✅, skin-temp ✅, MET ✅**; **raw motion (`0x72`) and
location are absent daytime.** Consequences: steps / awake-HR / daytime-stress-refinement are
**feasible**; activity-detection stays blocked (wants daytime `0x72` motion + location); still build
defensively (graceful when a signal is absent), same as the energy Phase-A / Body-Battery-stress features.

---

## 1. Steps — real step count (replaces the heuristic)

**Models:** `steps_motion_decoder_2_0_0`, `step_counter_1_3_0` (`AppStepCounterModel` →
`StepCounterWithEligibilityModel`). **Neural** — needs a weights export (`export-onnx.py`).

- **Inputs:** decoder `(timestamps, data)` → step-motion features; counter `(stepmotion, motion)` +
  `output_sampling_interval_ms` → steps, then `resample_steps` to the output grid.
- **BLE:** we already decode `0x7e/0x7f` step frames (`lib/health/step-estimate.ts`) — the decoder likely
  formalises exactly that; confirm its `data` layout matches our `unpack27` frames.
- **Surface:** replace/augment `step-estimate.ts` → `body_metrics.steps`. Today's value is a calibrated
  heuristic; this is Oura's own counter.
- **Build:** (1) export both cores to ONNX + golden-verify; (2) port the decoder feature assembly, pinned
  to a golden; (3) run counter per window, resample; (4) A/B against the heuristic on real days before
  switching. **Gate:** need dense daytime step-motion (likely present while walking — the best-case
  daytime signal).

## 2. Training Stress Score (`OTS`)

**Model:** `training_stress_score_0_2_1` (`OTS`). Validated model → a training-load score.

- **Inputs:** `start_timestamp, mets, age, biological_sex, rhr, no_ots, tz_change, readiness, vo2max`.
- **BLE/DB:** age/sex (profile), rhr (`body_metrics`), readiness (`oura_daily` — **Cloud, frozen since
  re-key** ⚠), MET (`0x50`), **vo2max** (`oura_daily.vo2_max` — Cloud, frozen ⚠). `no_ots`/`tz_change`
  are flags.
- **Feasibility caveat:** depends on `readiness` + `vo2max`, both Cloud-frozen. Either derive readiness
  from our own contributors (illness/HRV/temp we now compute) or gate the score on their availability.
- **Surface:** a "Training Stress" number on the workout done screen / health, next to the calorie
  estimate — genuinely gym-relevant.
- **Build:** export core → ONNX + golden; assemble inputs; **resolve the readiness/vo2max dependency
  first** (this is the real blocker, not the model).

## 3. Daytime stress + proper baselines (upgrades the shipped Body-Battery feature)

**Models:** `daily_medians_1_1_0`, `daily_short_term_baselines_1_1_0` (`StressBaselines`),
`stress_daytime_sensing_1_1_0` (`DaytimeStressSensing`). **Rule-based** (formulas, small) — portable +
golden-testable in-sandbox, no weights export.

- **The real stress rule** (read from source — this is what the Body-Battery feature currently
  *approximates* with `dhrv − day-median`):
  - `intensity = dhrv_value − dhrv_baseline`
  - `neutral_zone_half_width(night_hrv_baseline)` = `2` if `<40`, `3` if `<75`, else `4`
  - `recovery_threshold = +half_width`, `stress_threshold = −half_width`
  - `stress_saturation` / `recovery_saturation` (functions of `night_hrv_baseline`), then `scale_output`
    maps intensity through the thresholds/saturations to a scaled stress level.
- **Baselines:** `daily_medians` (hrv / hr_min / skin_temp / met per day) → `daily_short_term_baselines`
  (`dhrv_medians, skin_temp_medians, hr_min_medians, sleep durations, hrvs` → the dhrv/temp/hr baselines).
  This is the correct source for the `dhrv_baseline` the Body-Battery feature currently proxies with a
  raw overnight-HRV mean.
- **Surface:** swap the hand-rolled baseline + `relStress` in `app/api/body-battery/route.ts` for
  `daily_short_term_baselines` + `DaytimeStressSensing`'s scaled level; expose the scaled stress on the
  card (indicator already added).
- **Build order:** port `daily_medians` → `daily_short_term_baselines` → `DaytimeStressSensing` (each
  golden-tested vs its `.pt`), then rewire the battery route. **Highest-leverage build** — makes the
  just-shipped feature correct instead of approximate. Gate: same daytime signal.

## 4. Cumulative stress & resilience

- **`cumulative_stress_1_2_2`** — inputs `got_ups, lowest_heart_rate, sleep_phase_30_sec, hrv_items,
  average_hrv, resting_hr_average, temperature_avg, average_met_minutes` → a multi-day cumulative-stress
  load. Inputs are mostly nightly aggregates we already store (`sleep_sessions`, `body_metrics`).
- **`stress_resilience_2_2_1`** — inputs `sleep_start/end, sleep_score, hrv_balance, recovery_index,
  resting_heart_rate, …` → a resilience level. Depends on readiness **contributors** (hrv_balance /
  recovery_index) — Cloud-frozen; derive or gate.
- **Surface:** health "stress" section (currently Cloud-only, frozen). **Build:** export + golden + assemble;
  resilience blocked on the contributor dependency like §2's readiness.

## 5. Automatic activity detection

**Models:** `automatic_activity_detection_3_1_11` (+ `_3_0_8`). Neural. Existing investigation doc:
`2026-07-15-activity-detection-onnx-investigation.md` — this plan supersedes its "needs weights" note now
that source is vendored.

- **Inputs:** `context, met, stepmotion, motion, temperature, heartrate, location, past_activities`.
- **Value:** auto-detect the workout activity type the calorie estimate now asks the user to pick (§energy
  Phase-A) → removes the manual picker; also feeds `steps`/awhr.
- **Build:** export the two cores; port the (large) feature assembly; **GO/NO-GO** on whether we capture
  enough daytime motion — this is the heaviest of the set. Gate: strongest daytime-motion requirement.

## 6. Awake-HR imputation (`awhr`)

**Models:** `awhr_imputation_1_2_0` (LSTM — constants vendored, **not exported**, needs native rebuild),
`awhr_profile_selector_1_0_1`. Fills sparse daytime HR (inputs: `hr, stepmotion, motion`). Lower standalone
value; mainly an input-quality upgrade for §1/§3/§5. Build only if the daytime models above prove out.

## 7. Alternate sleep staging

- **`sleepstaging_2_6_0`** — a different/newer stager than `sleepnet_moonstone`. Uses a **custom
  `oura_ops::oura_create_windows`** op, so it won't `jit.load`/export without that op library — a
  reverse-engineering task on its own. Investigate whether it beats moonstone's REM parity before
  investing; **low priority** (moonstone already validated at Cloud-band REM).
- **`astd_event_detection_0_1_0`** — automatic sleep-time / event detection (`dsa_values, timestamps`).
  Could sharpen sleep-window boundaries feeding SleepNet. Small; investigate as a staging-window helper.

---

## Priority (recommended) — daytime-signal gate now ANSWERED (2026-07-16)

1. **§1 steps** — daytime stepmotion confirmed dense (80%); clear user value, replaces a heuristic; models
   fully inline (no npz). **Cleanest buildable win — start here.**
2. **§3 daytime stress + baselines** — inputs (temp/MET/HR daytime) confirmed present; makes a shipped
   feature correct; rule-based, in-sandbox verifiable.
3. **§6 awhr (awake-HR)** — feasible (hr + stepmotion present) but likely low value: daytime IBI is already
   dense, so little HR gap to impute. Build only if §1/§3 surface a need.
4. **§2 training stress score** / **§4 cumulative/resilience** — still gated on readiness/vo2max
   (Cloud-frozen); resolve that dependency (derive or gate) before building.
5. **§5 activity detection** — **blocked:** wants daytime raw motion (`0x72`, night-only here) + location
   (never over BLE). Not cleanly buildable as-is.
6. §7 alt sleep — low priority (moonstone already validated at Cloud-band REM).

The shared **daytime-signal feasibility gate is closed** (see the table at the top): stepmotion / HR /
skin-temp / MET stream daytime; raw motion (`0x72`) and location do not. Re-run the `/admin/oura-ble`
"Daytime signal coverage" probe if the ring firmware/wear pattern changes.
