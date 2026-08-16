# Energy Expenditure ONNX — active-energy model (P2)

> **2026-07-16 reframe (important).** Inspecting the `.pt` app-level source
> (`scripts/oura-models/_source/energy/app.py`) showed this is a **PER-WORKOUT** energy model, not
> the daily active-calories the original plan assumed. It scores a single workout from its activity
> type + intensity + the motion/HR during it. The feature layout, MET tables, and gates are now
> extracted and vendored — see `lib/oura-models/constants/energy-expenditure-features.json` and the
> `_source/energy/README.md`. This plan is rewritten around that reality and split into a shippable
> Phase A and a device-gated Phase B.

**Goal:** compute per-workout active-energy (kcal) with Oura's `energy_expenditure_1_0_0`, faithful
to Oura's own formulas, and attach it to logged workouts.

Phase 0 **done**: both heads exported + golden-verified (ORT parity 0.0 / 4.8e-07) — `_hr.onnx`
(50 feat) and `_no_hr.onnx` (42 feat), vendored in `lib/oura-models/onnx/`. Inference wrapper
`lib/oura-models/inference/energy.ts` done + tested. Source + feature spec vendored 2026-07-16.

## The model (cited: `_source/energy/app.py`)

`forward(demographic, workout_details, workout_timestamps, ring_met, motion, step_motion, hr,
temperature, trends, location, …)` → per-workout kcal. Two computation paths:

1. **No-motion MET fallback** — when `has_enough_motion` is false:
   `kcal = max(0, duration_min × (met − 1.5) × bmr_per_min)`, `met` = activity easy/mod/hard tier,
   `bmr_per_min = schofield(age, weight, sex)/24/60`. **Needs no BLE motion.**
2. **Neural heads** — enough motion → `flatten_features` → HR head (50 feat, `hr/min > 5`) or no-HR
   head (42 feat). ReLU-clamped ≥ 0.

Gates: `has_enough_motion` = `motion/min > 1.5 && step_motion/min > 5`; `has_enough_hr` = `hr/min > 5`.

## Phase A — MET fallback per logged workout (shippable now, no device dependency)

Deterministic, faithful to Oura's fallback, needs only data we already have.

1. Import `energy-expenditure-features.json` (82-activity MET table + `activity_type_version`).
2. Map the app's workout/exercise to one of Oura's 82 `activity_type` ids. Strength-focused rows
   exist (`strength training` id 8 = 3.0/5.5/6.0; `kettlebell` 67; `HIIT` 30; `core exercise` 28;
   `cardiovascular exercise` 79). Needs a mapping table + a default (id 8 for lifting).
3. Pick intensity (easy/moderate/hard) — from session RPE if available, else default moderate.
4. Port `schofield()` + `get_max_hr_tanaka()` to `lib/health/` (One-Formula: single home, imported).
   Profile inputs: `users` age (from DOB/age), weight (latest `body_metrics.weight_kg`), sex.
5. Compute `kcal` per completed workout; store/display. **Storage decision:** this is per-workout,
   so it belongs on `workout_sessions` (a new `est_energy_kcal` column), NOT `body_metrics.active_
   calories` (which is a daily Oura/Cloud field — do not conflate). Surface on the done screen /
   workout summary.
6. Validate: sanity-band a few logged workouts (a 45-min lift ≈ 150–300 kcal for this user).

**Open product decisions for Phase A (needs owner steer):** exercise→activity-type mapping source;
intensity source (RPE mapping vs fixed); where it shows (done screen line? workout history row?).

## Phase B — neural heads (device-gated, later)

Needs the ring's workout-window motion (8-col) + step_motion (11-col) frames + HR. **Feasibility
dependency:** confirm the BLE pipeline captures those frames during *waking* workouts (today:
`0x7e/0x7f` step frames + sleep-only `0x72`). If yes: port `flatten_features` (stats over the
window) pinned to a golden vector, feed `energy.ts`, prefer over Phase A when `has_enough_motion`.
If the ring doesn't stream usable workout motion, Phase B is not buildable and Phase A stands as the
product.

## Risks
- Feature order / MET table — pinned to the vendored `.json` + `_source`, never memory.
- Partial-day cumulative comparison — N/A now (per-workout, not daily cumulative).
- Do NOT write the per-workout value into `body_metrics.active_calories` (daily Cloud field).

## Backlog entry
```
N. **Oura energy-expenditure ONNX — per-workout active-energy** — plan
   `docs/superpowers/plans/2026-07-15-energy-expenditure-onnx.md` (reframed 2026-07-16: per-workout,
   not daily). Phase 0 (ONNX + inference) done. Phase A = MET-fallback per logged workout (shippable,
   no device dep) — needs exercise→activity-type mapping + Schofield port + `workout_sessions.est_
   energy_kcal` + done-screen surface + owner steer on the product decisions. Phase B = neural heads,
   gated on confirming workout-window motion capture over BLE.
```
