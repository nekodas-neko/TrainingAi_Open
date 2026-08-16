# Sub-plan D — Oura Movement: Steps, Activity Score, Energy Expenditure, Training Load (+ AAD capture spike)

**Parent:** `2026-07-15-oura-models-program-master.md` · **Branch:** `feat/oura-movement-metrics`
· **Phase:** 2 (rule-based fidelity upgrades) + a Phase-3 **capture R&D spike** (gated, not scheduled).
· **Type:** `lib/health/*` + `lib/oura-ble/*` ports, rollup plumbing, `oura_daily_derived` writes.
No new DB migration owned here — depends on **Sub-plan A** (`oura_daily_derived` + the per-bin MET
series persistence) and **Sub-plan B** (vendored constants loader) landing first.

> Model math is NOT re-transcribed here — it lives in the **`oura-models` skill**
> (`.agents/skills/oura-models/references/steps-activity-energy.md` + `SKILL.md`) and the
> **extracted constants bundle** (`C:\Temp\oura_bundle_lite\oura_model_constants\*.constants.json`,
> to be vendored by Sub-plan B). This plan cites the specific numbers that are load-bearing or that
> **differ from the skill text** (the skill was written before the constants were extracted; where
> they disagree, **the constants file wins** — One-Constant-One-Source, §4.2 master).

---

## 1. Goal

Turn four of Oura's on-device movement models into finished, persisted metrics on our BLE-only
pipeline, all fed from signals we already capture:

1. **Steps** — replace the biased flat-30-steps-per-window estimate with a real cadence integration
   by porting the 0-param `steps_motion_decoder_2_0_0` (dequantize the 27 gait columns → `stride_frequency`
   Hz) and counting `steps = stride_frequency × window_seconds`.
2. **Activity score** — persist our existing score in completed form, and upgrade its movement
   component to use the now-available per-bin MET series instead of steps+active-cal alone.
3. **Energy expenditure (active calories)** — build the first consumer of the per-bin MET series:
   the portable Schofield rule mode `kcal = duration_min × (MET − 1.5) × BMR_per_min`.
4. **Training load (OTS)** — port the 0-param `training_stress_score_0_2_1` over the MET series to
   produce a physiology-based load that complements our set-log ACWR.

Plus a **gated Phase-3 spike (§8, task D-9)**: investigate whether the ring can supply the
continuous all-day accelerometer that auto-exercise-detection (AAD) needs — *before* any AAD port is
scheduled.

The counterweight objective (master §4.1) applies: every metric here lands in `oura_daily_derived`
in *completed form*, written by the rollup, read by the UI — never recompute-on-read as the primary
path.

---

## 2. Current state (cited)

**Steps — biased under-count.**
- `lib/health/step-estimate.ts` is the only step formula. Tier-1 counts paired `0x7e/0x7f` gait
  windows where the opaque `unpack27` **column 14 ≤ 20** and credits a **flat `STEPS_PER_WINDOW = 30`**
  (`step-estimate.ts:27-33`). The header comment is explicit that this is "biased to UNDER-count".
- The 27 columns come from `lib/oura-ble/step-features.ts::unpack27` (ported byte-exact from
  `open_health`), but are treated as **opaque** — only `col0` (`STEP_GAIT_GATE_COLUMN`,
  `step-features.ts:29`) and `col14` are named, and the file comment claims *"we cannot reproduce
  their number"* (`step-features.ts:18`) — **now stale**, since the decoder constants are in hand.
- Tier-2 accel counter — **no longer an unproven spike (2026-07-14/15 update).** The gait-gated
  counter (`lib/oura-ble/gait-step-count.ts`) is validated on labelled owner captures (walk-30 → 31,
  handwave/stand-still → 0), and a full **continuous capture pipeline** shipped v1.143.0
  (`lib/oura-ble/continuous-capture.ts` → `POST /api/oura-ble/accel-chunks` → `oura_accel_chunks`
  → server-side gait count → `step_live_windows` source `continuous-accel`). Day-one production run
  (2026-07-15): ~2 h clean streaming (102k frames, 447 steps incl. a verified walk burst),
  live-HR pause/resume worked, **~4%/hr battery while streaming**; the WebView-alive limit cost the
  whole afternoon (app killed 12:16–21:27 AEST → zero coverage). Conclusion already ratified by the
  owner: recorded-gait decoding (this plan) supersedes streaming as the primary step source;
  the streaming pipeline is retained as **D's ground-truth validator** (labelled walks counted both
  ways) and the **AAD capture asset** (§8 D-9). Stays opt-in/off by default.
- Merge: `mergeStepSources` (`lib/health/step-estimate.ts:73`; invoked `adapter.ts:4036`). Persisted
  to `body_metrics.steps` with a plain-COALESCE max-merge guard (`adapter.ts:3995-4043`).

**Activity score — live, not persisted.**
- `lib/health/activity-score.ts` composites movement (steps + active-cal vs the user's own trailing
  average, 60% weight) + logged-gym-volume credit (40%). Explicitly replaces the frozen Cloud
  `activityScore`. Its own header (`activity-score.ts:9-11`) names the MET-bin upgrade as the
  extension point.
- **Recomputed live** in `app/api/readiness-score/route.ts:192` on every read; never stored.

**Energy expenditure — none.**
- The MET stream `0x50` decodes to a per-bin `met[]` array (`lib/oura-ble/decode.ts:220-229`; scale
  `b<128 → b×0.1`, else `12.8+(b−128)×0.2`), but the rollup **collapses it to a day-mean and
  discards the per-bin series** (`adapter.ts:4144-4162`: `metByDay` → `metAvg` → one scalar on the
  daily summary). No active-calorie estimate exists.

**Training load (OTS) — none.**
- We compute ACWR from set logs (`computeVolumeAcwr`) entirely separately. The MET series (`0x50`)
  and the HR series (`oura_heartrate`) are both available but unused for a physiology-based load.

**Auto exercise detection — capture capability now EXISTS (2026-07-15 update; text below it is
the pre-v1.143.0 state).**
- AAD needs **continuous all-day accelerometer**. Two of this section's original claims are now
  corrected by on-device testing: (a) only **REAL_STEPS** blocks the `0x33` stream — DAYTIME_HR and
  SPO2 keep recording internally while accel streams (proven via the HR-coverage readout), and
  live-HR (feature-modes + DHR burst, not a SetRealtime session) **coexists** with the stream
  (both frame tallies climbing, 2026-07-13); (b) the continuous stream exists:
  `lib/oura-ble/continuous-capture.ts` (v1.143.0, opt-in) streams the day window with watchdog
  re-arm (the ~5 min firmware time-box is handled) and posts `oura_accel_chunks` continuously.
  The real constraints for AAD capture are: **REAL_STEPS mutual exclusion** (streaming spans record
  no gait windows — choose per span) and the **WebView-alive limit** (app killed = capture gap;
  day-one lost 12:16–21:27 AEST to this — a native-service port is the known fix).

---

## 3. Inputs captured

| Signal | BLE tag | Decoded to | Where | Sufficient for this plan? |
|---|---|---|---|---|
| Real-step gait features | `0x7e`+`0x7f` (paired) | 27 quantized columns (`unpack27`) | `step-features.ts` | ✅ Steps decoder input — **column-order match to Oura's `data_columns` must be verified** (§5.1) |
| Per-bin MET | `0x50` | `met[]` (per-bin levels) + `state` | `decode.ts:222` | ✅ Energy + OTS + activity movement — **per-bin timestamps must be reconstructed** (§5.3); currently day-averaged and lost |
| Intraday HR | (→ `oura_heartrate`) | bpm series | `slices/oura.ts` | ✅ OTS `rhr` input; EE Mode-1 HR (optional NN) |
| Live-counted steps (accel) | `0x33` | `step_live_windows` (`continuous-accel`) | `gait-step-count.ts` via `/api/oura-ble/accel-chunks` | ✅ validated on labelled walks — now D's ground-truth validator; opt-in, off by default |
| Continuous all-day accel | `0x33` | `oura_accel_chunks` (raw magnitudes, 7-day pruned) | `continuous-capture.ts` (v1.143.0) | ⚠️ capability exists (day-one: ~2 h clean, 4%/hr battery); limits = REAL_STEPS mutual exclusion + WebView-alive (§8 D-9) |
| Low-res motion events | `0x47` / `0x6b` | orientation + motion-seconds (`decodeMotion`) | `decode.ts:232` | ❓ currently unused — candidate lighter-detector input (§8 D-9 spike) |
| Demographics (age, sex, weight) | user profile / `personal_info` | — | `users` / profile | ✅ Schofield BMR + OTS age/sex bucketing |
| Readiness score | derived nightly | — | `oura_daily_derived` (Sub-plan E) | ✅ OTS `readiness<60` threshold drop |

**Note on the accel spike (updated 2026-07-15):** everything in §4 items 1–4 is buildable *today*
from captured signals. AAD (§8 D-9) is no longer capture-*blocked* — the continuous stream exists —
but stays an R&D spike: its open questions are now data-shaped (REAL_STEPS mutual exclusion,
WebView-alive coverage gaps, whether opportunistic streaming spans are enough for the AAD model).

---

## 4. Model reference (pointers + the load-bearing constants)

Full math is in `references/steps-activity-energy.md`. The constants below were **extracted** from
the `.pt` files (they were `[runtime tensor]` when the skill was written) — cite these, and prefer
the vendored constants file (Sub-plan B) over any number transcribed into the skill prose.

### 4.1 `steps_motion_decoder_2_0_0` (0 params) — dequantization codec
- **Input `data_columns` (27)** = 3 globals (`sum_accel_mg_std`, `y_accel_std_ratio`,
  `z_accel_std_ratio`) + 3 bands `b∈{1,2,3}` of 8 each: `total_amplitude_mg_b`, `stride_frequency_b`,
  `stride_amplitude_frac_b`, `first_non_locomotor_frequency_b`, `first_non_locomotor_amplitude_frac_b`,
  `gait_amplitude_frac_b`, `frequency_bin_high_frac_b`, `frequency_bin_mid_frac_b`. So
  **`stride_frequency` lives at indices 4, 12, 20**.
- **Decode per column** (`decode()` in the reference): `available = 2^bits` (−1 if `encode_zero`);
  reserve code 0 as "zero"; `x = (x/available)·(high−low)+low`; apply `inverse_transform` if the
  column has a transform.
- **`decoder_base_settings` (extracted, `low/high/bits[/encode_zero]`):**
  `stride_frequency {low 0.68, high 3.4, bits 9, encode_zero 1}` ·
  `total_amplitude_mg {0, 8000, 9}` · `stride_amplitude_frac {0, 1, 9}` ·
  `gait_amplitude_frac {0, 0.75, 8}` · `first_non_locomotor_frequency {0, 24.8046875, 7}` ·
  `first_non_locomotor_amplitude_frac {0, 0.65, 8}` · `frequency_bin_high/mid_frac {0, 1, 8}` ·
  `sum_accel_mg_std {0, 8000, 10}` · `y/z_accel_std_ratio {0, 0.85, 8}`.
- **`decoder_transform_settings` (extracted):** `total_amplitude_mg` & `sum_accel_mg_std` →
  `log_transform`/`log_itransform` (`log10(x+1)` / `10^x−1`); `stride_amplitude_frac`,
  `gait_amplitude_frac`, `first_non_locomotor_amplitude_frac` → `sqrt`/`square`. `stride_frequency`
  has **no transform** (linear over 0.68–3.4 Hz).
- **Reshape:** each 27-col packet expands to 3 output rows of 11 (one per 30-s sub-window); timestamp
  split into thirds. **No `[runtime tensor]` gap remains** for the decoder — the full table is
  extracted.

### 4.2 `step_counter_1_3_0` (7.8K params) — count core + optional NN
- **Core formula:** `steps = stride_frequency × seconds_per_batch` (`seconds_per_batch ≈ 30`,
  matching the 30-s sub-window), zero-floored below `min_steps` and where amplitude is below
  `min_stride_gait_amplitude_frac/_mg`.
- **First-order port needs no NN.** The NN is a fidelity upgrade only: an **eligibility MLP** (19
  features → sigmoid ∈[0,1]) gates/scales via a `ParameterizedSigmoid` `step_count_multiplier`, and a
  heuristic applies a conditional **×2 low-cadence "L-shape" correction** for systematic under-counting
  at low frequency/ratio. Weights are extracted (8K params) — note as a later upgrade, do not port now.

### 4.3 `energy_expenditure_1_0_0` — Schofield rule mode (+ optional NN modes)
- **Active-calorie formula:** `kcal = duration_min × (MET − 1.5) × bmr_per_minute`, floored at 0.
- **Schofield BMR** (age-bracketed, from the reference file — brackets/coeffs are in the skill,
  **not** in the constants-JSON attributes): `age_brackets = [1.5, 6.5, 14, 24, 45, 500]`, per-sex
  `weight_multiplier`/`weight_bias` rows, linearly interpolated between adjacent brackets, combined
  via one-hot sex; `bmr_per_minute = BMR / 24 / 60`.
- **Mode 3 (rule-based, what we port):** MET from the per-bin series (or `activity_type_dict` for a
  logged workout). `activity_type_dict` **is** extracted (`activity_type_version 20250825`, e.g.
  `8 → ["strength training", 3, 5.5, 6]`, `12 → ["running", 7, 9.8, 12.8]`, `14 → ["walking", 3, 4.3, 6]`).
- **Modes 1/2 (NN, 50/42 features):** later upgrades — weights extracted (`.weights.npz`), but the
  feature-name order is still `[runtime list]`. Do not port now.

### 4.4 `training_stress_score_0_2_1` (OTS, 0 params)
- **Rolling 12-h window (720 min, stride 1)** over the per-minute MET series;
  `ots = Σ(MET × met_weights) / Σ(met_weights)`; require enough valid minutes; window timestamp = its
  720th minute.
- **Category scaling:** `× vo2max_weights[cat]` if VO2max known, else `× rhr_weights[rhr_cat]`; floor
  `ots ≥ 0.9`.
- **Post:** `readiness < 60 → high_ots_threshold ×= 0.9`; `ots_high_low = 1 if ots > threshold`.
- **Extracted constants (⚠️ several DIFFER from the skill prose — use these):**
  `met_weights` len **720** (ascending ramp `2.47e-4 … 1.0`, Σ≈**87.04** — weights recent minutes
  heaviest) · `rhr_weights` len **10** (`1.0 … 1.2`) · `vo2max_weights` len **4** (`1.2, 1.133,
  1.067, 1.0`) · `high_ots_threshold = 4` · `min_met_value = 0.9` (MET below → NaN) ·
  `validator.min_mets_count = 720` (skill said "≥360 valid" — **reconcile: constant is 720**) ·
  `met_intensity_gamma = 1` (skill said 1.5) · `met_intensity_M = 8` (skill said 2) ·
  `use_met_intensity_weights = true` (skill said default false) · `resample_interval = 900` ·
  age groups `female_and_male_age_groups = [10..80]`, `other_age_groups = [20..70]`;
  `vo2max_thresholds` `[24×6]`, `*_percentiles` for `rhr_category` lookup.
- **Reconciliation task (blocking for OTS correctness):** the relationship between `met_weights`
  length 720, `min_mets_count = 720`, and `resample_interval = 900` (15 min) is **not** internally
  obvious — a 720-length weight vector over a 12-h window implies **1-min** resolution, contradicting
  a 900-s resample. The implementer MUST pin the window/resample/weight-length contract against the
  actual `.pt` forward pass or a captured MET test vector **before** trusting an OTS number (§9).

---

## 5. Design decisions

### 5.1 Steps: prove the column mapping first, then integrate cadence
The decoder assumes its input `data` is in **`data_columns` order**. Our `unpack27` produces 27
integers in an order ported from `open_health`; only `col0` and `col14` have been characterized.
`data_columns[0] = sum_accel_mg_std` (plausibly the idle/active gate `col0` already keys off) and
`data_columns[14] = first_non_locomotor_frequency_1` — **consistent but unproven**.

- **Decision:** treat "our `unpack27` order == Oura `data_columns` order" as a **hypothesis to
  validate**, not an assumption. Validate by decoding a captured counted-walk: the three
  `stride_frequency` columns (idx 4/12/20) must dequantize into a physically plausible cadence
  (~0.68–3.4 Hz, i.e. ~40–200 strides/min) during walking and read ~0 at rest. If they don't, the
  column order is wrong and must be re-derived from `libringeventparser` / `open_health` before the
  count can be trusted. **Ship the decoder + validation harness before ship­ping the new count.**
- **Count formula:** for each paired packet → 3 sub-windows; `sub_steps = decoded_stride_frequency ×
  window_seconds` (`window_seconds ≈ 30`, pinned from the packet timestamp delta, not hardcoded);
  day total = Σ over sub-windows, gated to 0 where `stride_amplitude_frac + gait_amplitude_frac`
  (or `total_amplitude_mg`) is below the decoder's amplitude floor. Keep the NN eligibility gate and
  ×2 L-shape correction as a documented **later** upgrade.
- **Stride-vs-step ambiguity:** whether Oura's `stride_frequency` is strides/sec (1 stride = 2 steps)
  or already steps/sec is **not** settled by the constants. Resolve it empirically against the
  counted-walk ground truth (§9) — a factor-of-2 calibration constant, pinned to the test vector,
  is acceptable and expected.
- **Keep the accel Tier-2 path (`accel.ts`) exactly as-is** — separate, opt-in, and still merged by
  `mergeStepSources` (which keeps winning where live windows exist). The decoder replaces only the
  Tier-1 *estimate* (the flat-30 branch), not the merge or the Tier-2 override.
- **Update the stale comment** in `step-features.ts:18` ("we cannot reproduce their number") — we now
  can, first-order; point it at the decoder port.

### 5.2 Activity score: persist + upgrade the movement component
- Persist the finished score + contributors to `oura_daily_derived.activity_score` /
  `activity_contributors` (Sub-plan A columns). The readiness route reads the persisted row and only
  computes-and-persists on a cache miss (master §4.1).
- **Movement upgrade:** add a MET-derived movement signal alongside steps/active-cal. Compute
  **active MET-minutes** (Σ over bins where `MET > 1.5`, ×bin-minutes) and/or **active-time
  fraction** from the per-bin series, scored against the user's own trailing average (same relative,
  no-absolute-target philosophy as today). Fold it into the existing renormalise-over-available-parts
  structure — do **not** hard-require it (MET may be absent for a day). Keep the training-credit and
  weighting model unchanged; this only enriches the movement half.
- **One-Formula-One-Place:** the score stays defined once in `lib/health/activity-score.ts`; the
  route imports it. No band/threshold math leaks into the route or the web fallback (Canonical
  Runtime — the online-web read fallback stays a logic-free pass-through).

### 5.3 Energy expenditure: rule mode over the persisted MET series
- **Prerequisite:** the per-bin MET series must be **persisted** (Sub-plan A §2.4 — `oura_met_daily`
  or a JSONB array on the daily row), because today the rollup discards it. This plan *consumes* that
  series; if Sub-plan A hasn't landed it, this task is blocked.
- **Per-bin timestamp reconstruction:** `decode.ts` returns `met[]` per `0x50` event but not per-bin
  wall-clock. Reconstruct as `event_ds + bin_index × bin_interval_ds`, with `bin_interval` **pinned
  from a test vector** (Oura MET is conventionally 1-min bins; confirm, do not assume). This is shared
  infrastructure needed by both EE and OTS — build it once in the MET-series consumer.
- **Formula:** `kcal_bin = bin_minutes × max(0, MET − 1.5) × bmr_per_minute`; day total = Σ bins.
  BMR via Schofield from the user's age/sex/weight (§4.3). Persist per-day `active_calories_est` to
  `oura_daily_derived`; optionally per-workout (bins overlapping a logged session's time window) as a
  follow-up.
- **Do NOT overwrite `body_metrics.active_calories`** — that column holds Cloud/Health-Connect values
  and the COALESCE-merge contract. `active_calories_est` is the *derived/estimated* sibling, kept
  distinct with a `source = ble-derived` label (master §4.6). Keep the boundary crisp (Sub-plan A §6
  double-source-of-truth risk).
- NN modes (50/42-feat) are noted upgrades only.

### 5.4 Training load (OTS): complements ACWR, does not replace it
- OTS is a **physiology-based acute load** (12-h MET-weighted intensity, ×cardio-fitness scaling),
  whereas our `computeVolumeAcwr` is a **mechanical training-load ratio** from logged set volume.
  They answer different questions (systemic strain vs muscular chronic:acute) and are complementary —
  OTS covers non-gym movement (walks, cardio) that never enters a set log, and reacts to poor
  readiness (the `readiness<60` threshold drop). Surface both; do not merge or re-band one into the
  other (One-Formula-One-Place — each stays its own metric).
- Port `training_stress_score` as a 0-param function over the persisted per-minute MET series;
  inputs: MET series, age, biological_sex, `rhr` (from `oura_heartrate` / nightly RHR),
  `readiness` (from `oura_daily_derived`, Sub-plan E), optional `vo2max` (null → use `rhr_weights`).
- Persist `oura_daily_derived.training_load_ots` (float) + `training_load_high` (0/1 flag from
  `ots > high_ots_threshold`, with the readiness×0.9 adjustment applied). Provenance-labelled.
- **Validation-range guards fail closed** (AI & Security Defaults): `rhr` 30–100, `readiness` 0–100,
  `vo2max` 10–100, MET count ≥ `min_mets_count`; out-of-range or insufficient → OTS null, never a
  fabricated number.

### 5.5 Compute location & redecode
All four run **server-side in `aggregateOuraRawSamples`** (master §4.4). All are replayable over
stored `body_hex` via the existing redecode path (master §4.3) — a better step column-mapping or a
pinned MET bin-interval back-fills history by re-running the rollup, never by re-draining the ring.

---

## 6. Storage

Reuses the Sub-plan A schema — this plan defines no new migration.

**Completed form (`oura_daily_derived`, one row per user/day):**
- `activity_score` INT + `activity_contributors` JSONB (movement/training sub-scores incl. the new
  MET-minutes contributor).
- `active_calories_est` INT (nullable) — derived, distinct from `body_metrics.active_calories`.
- `training_load_ots` REAL (nullable) + `training_load_high` BOOLEAN/INT (nullable).
- `model_versions` JSONB gains `{"steps":"decoder-2.0.0", "activity":"…", "ee":"…", "ots":"0.2.1"}`.
- `source = ble-derived`. All columns nullable; a metric absent for a day is null (never fabricated).
- Written via Sub-plan A's idempotent `upsertOuraDailyDerived(userId, day, payload)`
  (`ON CONFLICT (user_id, day)` with COALESCE-keep so a partial recompute never nulls a good value).

**Per-bin MET series (Sub-plan A §2.4 — prerequisite):**
- Compact per-day MET array (`oura_met_daily` or JSONB on the daily row) at the pinned bin resolution,
  persisted by the rollup **instead of** collapsing to `metAvg`. This plan is its first consumer;
  keep the existing day-mean write for the baseline summary (don't regress `metAvg`) while adding the
  series.

**Steps** stay in `body_metrics.steps` via the existing `mergeStepSources` max-merge (unchanged
storage; only the Tier-1 value feeding the merge changes).

---

## 7. Plumbing

- **Rollup (`aggregateOuraRawSamples`, `lib/data/postgres/adapter.ts`):**
  - Steps: replace the flat-30 Tier-1 estimate feeding `mergeStepSources` (`adapter.ts:4036`) with
    the decoder-based per-window cadence count. Keep the merge + Tier-2 override intact.
  - MET: at `adapter.ts:4144-4162`, **persist the per-bin series** (Sub-plan A) in addition to the
    existing `metAvg`; feed the series into the new EE + OTS consumers.
  - Call `upsertOuraDailyDerived` with `activity_score`, `active_calories_est`, `training_load_ots`,
    `training_load_high` (activity score moves from live-route compute into the rollup).
- **Read sites:**
  - `app/api/readiness-score/route.ts:192` — stop live-computing the activity score; **read** it from
    `oura_daily_derived`, compute-and-persist fallback on miss (Sub-plan A §2.3). Keep the web-online
    fallback logic-free.
  - Any health surface showing steps/active-cal/training-load reads the persisted derived row
    (instant paint via cache-seed).
- **New modules (keep files <800 lines, One-Formula-One-Place):**
  - `lib/oura-ble/steps-motion-decoder.ts` — the 0-param dequantization codec (loads
    `steps_motion_decoder_2_0_0` constants via the Sub-plan B loader).
  - `lib/health/met-series.ts` — per-bin MET timestamp reconstruction + active-MET-minute helpers
    (shared by activity/EE/OTS).
  - `lib/health/energy-expenditure.ts` — Schofield BMR + rule-mode active-calorie estimate.
  - `lib/health/training-load-ots.ts` — the OTS port.
  - Extend `lib/health/step-estimate.ts` (cadence count) and `lib/health/activity-score.ts` (MET
    movement component) rather than forking them.
- **Cache groups (`lib/cache-groups.ts`):** register `oura-daily-derived:*` reads (Sub-plan A) and
  add the key to the rollup-write invalidation group so a new rollup surfaces fresh
  steps/activity/EE/OTS. New aggregate GET routes (if any) ship SWR headers at creation
  (`private, max-age=60, stale-while-revalidate=120`). One canonical TTL per key in `lib/cache-ttl.ts`.
- **Redecode:** the redecode pass (`redecodeOuraRawSamples`) re-runs the rollup, so all four metrics
  back-fill from `body_hex` with no ring drain. No separate redecode wiring needed beyond ensuring the
  new consumers live inside the rollup.
- **Constants:** every magic number loads from the Sub-plan B vendored/SHA-pinned constants — no
  decoder table, `met_weights`, `rhr_weights`, `activity_type_dict`, or Schofield row is hardcoded in
  a `lib/` file.

---

## 8. Phased task list

**Prereqs (blocking):** Sub-plan B (constants loader) and Sub-plan A (`oura_daily_derived` table +
per-bin MET series persistence + read-path scaffold) must land first.

- **D-1 — Steps decoder port.** `lib/oura-ble/steps-motion-decoder.ts`: implement `decode()` per
  column from `decoder_base_settings`/`decoder_transform_settings`; reshape 27→3×11. Unit-test each
  transform (`log/sqrt` + `encode_zero`) against hand-computed values.
- **D-2 — Column-mapping validation (§5.1).** Harness that decodes a captured counted-walk and
  asserts `stride_frequency` (idx 4/12/20) lands in the plausible cadence band during walking and ~0
  at rest. **Gate D-3 on this passing** — if the order is wrong, re-derive it before counting.
- **D-3 — Cadence step count.** Replace the flat-30 Tier-1 branch with
  `steps = stride_frequency × window_seconds` (window from packet timestamp delta), amplitude-gated.
  Wire into `mergeStepSources` (Tier-2 override + max-merge unchanged). Resolve the stride↔step factor
  against counted-walk ground truth; pin the calibration to the test vector. Update the stale
  `step-features.ts:18` comment.
- **D-4 — MET-series consumer infra.** `lib/health/met-series.ts`: per-bin timestamp reconstruction
  (pin `bin_interval` from a test vector), active-MET-minute / active-time helpers. Persist the
  per-bin series in the rollup (Sub-plan A §2.4) instead of discarding it.
- **D-5 — Activity score persist + MET upgrade.** Add the MET-minutes movement contributor to
  `activity-score.ts`; move the compute into the rollup; persist to `oura_daily_derived`; convert the
  readiness route to read-first.
- **D-6 — Energy expenditure (rule mode).** `lib/health/energy-expenditure.ts`: Schofield BMR +
  `kcal = duration_min × (MET−1.5) × bmr_per_min` over the MET series. Persist `active_calories_est`.
  Keep distinct from `body_metrics.active_calories`.
- **D-7 — Training load (OTS).** `lib/health/training-load-ots.ts`: port `training_stress_score`.
  **First reconcile the window/resample/`met_weights`-length/`min_mets_count` contract (§4.4)**
  against the `.pt` behaviour / test vector. Persist `training_load_ots` + `training_load_high`.
  Fail-closed validation guards. Add a short note (health surface + `docs/module-map.md`) explaining
  OTS-vs-ACWR complementarity.
- **D-8 — Read-site + cache wiring.** Surfaces read persisted derived rows; cache groups + SWR
  headers; `docs/module-map.md` rows for the four new modules.
- **D-9 — AAD capture spike (Phase 3, GATED — R&D only, do NOT port the model).** Investigate,
  in a written findings doc (not a feature):
  1. Whether the ring can stream/log **continuous all-day accel** without starving DAYTIME_HR /
     SPO2 / REAL_STEPS (the `0x33` sharing constraint) — test on-device, measure the tradeoff.
  2. Failing that, whether **low-res motion events `0x47`/`0x6b`** (currently unused) **+ the MET
     series `0x50`** can drive a *lighter* activity detector (PELT change-point on MET is the AAD
     front-end anyway — see the reference).
  Only **after** capture is solved does AAD (1.3M/3.6M-param nets) get its own plan. Explicitly
  gated: no AAD schema, no model port, no schedule commitment in this plan.

Ordering within D: D-1→D-2→D-3 (steps chain); D-4 unblocks D-5/D-6/D-7 (MET chain); D-8 last; D-9
independent and gated.

---

## 9. Testing

- **Unit tests (pinned test vector — a captured/redecoded day, mirroring the Oura-BLE decoder
  discipline):**
  - Decoder: each column's dequantization (transforms + `encode_zero` + `stride_frequency` linear
    range 0.68–3.4 Hz) against hand-computed expected values from a captured packet.
  - Step count: decoded cadence × window → steps for a known packet; the stride↔step factor pinned to
    the counted walk.
  - MET-series: bin-timestamp reconstruction + active-MET-minute totals for a fixture `0x50` stream.
  - EE: Schofield BMR for a known age/sex/weight (cross-check against the reference brackets); a
    hand-computed `kcal` for a fixed MET/duration.
  - OTS: `Σ(MET×met_weights)/Σ(met_weights)`, the ≥`min_mets_count` gate, category scaling, floor 0.9,
    and the `readiness<60` threshold drop — against a fixture MET series with a **known** expected OTS
    (only meaningful once §4.4's window/resample contract is pinned).
- **Boundary/guard tests:** OTS validation ranges (`rhr` 30–100, etc.) return null, not a number;
  insufficient MET minutes → null; activity score renormalises correctly when the MET contributor is
  absent.
- **Integration:** a redecode over a fixture day reproduces identical `oura_daily_derived`
  steps/activity/EE/OTS values (idempotency + completed-form correctness).
- **`pnpm dev`:** exercise the readiness route reading the persisted derived row (not recomputing);
  confirm steps/active-cal/training-load render.
- **Device gate (S25 APK — the only real verification for BLE behaviour):**
  - **Steps need an on-device counted-walk validation** — decode a real captured walk and compare the
    cadence-based total against a hand-counted step count; this is the only way to confirm the column
    mapping and the stride↔step factor. Web/sandbox cannot exercise native BLE capture.
  - Confirm instant paint reads persisted derived rows offline.
  - Anything not device-verified in-session gets a `projectOverview.md` Known-Issues row marking it
    NOT device-verified (Canonical Runtime).

---

## 10. Risks

- **Step column-order mismatch (highest).** If `unpack27`'s order ≠ Oura `data_columns`, the decoded
  `stride_frequency` is garbage and the count is worse than the flat-30. Mitigated by the D-2 gate —
  do not ship the new count until the counted-walk validation passes.
- **OTS constant/skill divergence.** `met_weights` length vs `resample_interval` vs `min_mets_count`
  is internally ambiguous and the skill prose disagrees with the extracted constants (gamma, M,
  thresholds). Trusting the wrong contract yields a plausible-but-wrong load number. Mitigated by the
  D-7 reconcile-against-`.pt`/test-vector step before persisting.
- **MET bin-interval assumption.** Reconstructing per-bin timestamps wrong shifts every MET-derived
  metric. Pin `bin_interval` from a test vector; never assume 1-min.
- **Stride↔step factor-of-2.** Silent 2× over/under-count if `stride_frequency` semantics are
  misread. Resolved empirically (D-3) and pinned.
- **Double source of truth for calories.** `active_calories_est` must never overwrite the measured
  `body_metrics.active_calories`. Enforced by keeping them separate columns with distinct `source`.
- **AAD capture starvation.** Forcing continuous accel could silently degrade HR/SpO2/steps on-device.
  Contained by keeping D-9 an investigation with an explicit on-device tradeoff measurement, not a
  shipped change.
- **Capture gaps unchanged.** Radio-asleep windows (worn-idle power-gating) still miss steps/MET —
  this port improves accuracy *where the ring recorded*, it doesn't close capture holes. Keep the
  "biased to under-count" honesty in the docs.

---

## 11. Backlog entry (to insert into `docs/implementation-backlog.md` in the docs-only PR)

- **Title:** Oura movement metrics — steps decoder, activity-score MET upgrade, energy expenditure,
  training load (OTS)
- **Branch:** `feat/oura-movement-metrics`
- **Plan:** `docs/superpowers/plans/2026-07-15-oura-movement-steps-activity-energy.md`
- **Depends on:** `feat/oura-model-constants-ingestion` (Sub-plan B) **and**
  `feat/oura-data-architecture-culling` (Sub-plan A — `oura_daily_derived` + per-bin MET series).
  ⛔ blocked until both land.
- **Priority rationale:** Phase 2, after the enablers (A/B) and the higher-downstream sleep/recovery
  sub-plans (C/E). Self-contained; no DB migration of its own. The AAD capture spike (task D-9) is
  gated R&D and does not block the rest of the item.
- **Date added:** 2026-07-15
