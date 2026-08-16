# Oura Sub-plan E — Recovery, Readiness & Health Events

**Date:** 2026-07-15 · **Status:** Planning (docs-only) · **Branch (impl):** `feat/oura-recovery-health-events`
**Program hub:** `docs/superpowers/plans/2026-07-15-oura-models-program-master.md`
**Model math (reference — do not re-transcribe):** the `oura-models` skill —
`.agents/skills/oura-models/SKILL.md` and
`.agents/skills/oura-models/references/{stress-baselines-illness,cardiovascular-hr}.md`.
**Constants:** `C:\Temp\oura_bundle_lite\oura_model_constants\*.constants.json` (vendored by
Sub-plan B — this plan consumes them, never hardcodes their numbers).

> Scope: everything downstream of the nightly physiology we already capture — HRV/RHR nightly
> aggregation, personal baselines, readiness + its contributors, recovery index, temperature
> deviation, an illness radar, daytime stress, cumulative stress, and resilience. Sleep staging,
> steps/activity/energy and vascular age are **out of scope** (Sub-plans C, D, F). The
> completed-form `oura_daily_derived` table and constants loader are provided by Sub-plans A and B;
> this plan writes to them.

---

## 1. Goal

Since the 2026-07-07 BLE re-key the Oura Cloud is frozen, so every recovery/health metric the ring
app used to show is dead unless we recompute it from raw BLE signals. We already compute a partial
set in `lib/health/*`, but with three concrete defects and several missing metrics:

1. **The nightly HRV number is wrong** — it is a naive mean of every in-window RMSSD sample, with no
   quality gating. Oura takes a **quality-gated median**. This is the cheapest high-value fix.
2. **Readiness is recomputed live on every read and never persisted** — it defeats the program's
   "record in completed form for later analysis" objective and re-does work on every paint.
3. **Wear confidence keys off Oura Cloud non-wear**, which is stale on the BLE path.

And we are missing metrics the user explicitly wants (an **illness radar**) or that are now portable
because the archived tensors are available (**daytime stress, cumulative stress, resilience**).

**Deliverable:** compute each of these in completed form, persist them durably to
`oura_daily_derived`, read them back (read-first, compute-and-persist fallback), and label
provenance — while being honest about which are calibrated ports and which are rule-based radars.

---

## 2. Current state (cited)

| Concern | Where | Status |
|---|---|---|
| **Nightly HRV** | `adapter.ts:3740` (`rmssd = inWindow(hrvRows).flatMap(…'rmssd_ms').filter(v>0)`) and `:3848` (`averageHrvMs = mean(rmssd)`) | ❌ **naive mean**, only gate is `>0`. Persisted to `sleep_sessions.average_hrv_ms` + `body_metrics.hrv_ms`. |
| **Resting HR** | `adapter.ts:3747-3764` — bucket in-window IBI-derived `hr_bpm` into 5-min bins (band-filtered 35-150, ≥3 beats/bin), RHR = **lowest bin average** | ✅ **Good** — this is already Oura's "lowest", not a raw min. Keep the shape; only add the daily_medians gates for consistency. |
| **Personal baselines** | `lib/health/personal-baseline.ts` (asymmetric-EMA, ecore port `baseline_update_lt_mean_and_dev`), replayed forward by `lib/health/daily-summary.ts` → `computeDailySummaries`, persisted to `oura_daily_summary.*_baseline_mean_x8/dev_x8` + `n_history` | ⚠️ Written **replace-all**: `slices/oura.ts:541` `db.delete(ouraDailySummary).where(userId=…)` every rollup → O(all history) rewrite. Shared `nHistory` age counter across all 5 metrics (`daily-summary.ts:51,57`). |
| **Readiness** | `lib/health/readiness-composite.ts` (8-contributor weighted composite) + `app/api/readiness-score/route.ts:245` | ❌ **Recomputed live, never persisted.** Recovery-index contributor is hard-wired `NEUTRAL` (`readiness-composite.ts:91`). |
| **Recovery index** | `lib/health/recovery-index.ts` → persisted `oura_daily_summary.recovery_index_hours` | ⚠️ Computed + stored, but **never scored into readiness** (surfaced as raw hours only, `route.ts:341`). |
| **Temperature** | `lib/health/temperature-baseline.ts` (`nightlyTemperatureCentiC` ported), dev via `daily-summary.ts:59` | ✅ Persisted `oura_daily_summary.temp_mean_c/temp_dev_c`; feeds readiness `tempZ`. |
| **Breathing rate** | `lib/health/breathing-rate.ts` (`breathingFromIbi`) → `sleep_sessions.respiratory_rate` (`adapter.ts:3807`) | ✅ Persisted; median of per-epoch breaths/min. |
| **Wear confidence** | `lib/health/wear-confidence.ts` (`isLowWearDay(nonWearTimeSec)`) | ❌ Keys off `oura_daily.nonWearTimeSec` (**Oura Cloud**, stale on BLE). |
| **Rollup entry** | `adapter.ts:4163-4167` — `computeDailySummaries(nights)` → `replaceOuraDailySummary` inside `aggregateOuraRawSamples` | reference for all new derived writes. |
| **Daytime stress / cumulative / resilience** | — | ❌ Not implemented. `stressHigh`/`recoveryHigh`/`resilienceLevel` in the route are Oura-Cloud passthroughs (`route.ts:318,332-333`), frozen. |

---

## 3. Inputs captured (feasibility per metric)

All nightly physiology is already extracted inside `aggregateOuraRawSamples` and available per-night
via `nightInputsByDate` / the `sleepRows` push (`adapter.ts:3852`). Relevant raw tags/decoders:

| Signal | Tag / decoder | Fields | Notes for this plan |
|---|---|---|---|
| HRV | `0x5d` `decodeHrv` (`decode.ts:115`) | `hr_bpm[]`, `rmssd_ms[]`, `interval_min:5` | **No `hrv_accuracy` field** — the daily_medians accuracy gate has no direct source (see §5.1). 5-min cadence, whole-day (not just sleep). |
| IBI / HR | `0x5b`-family IBI (`decode.ts:111`) → `hr_bpm`, `ibi_ms` | per-beat | feeds RHR bins + recovery index + breathing. |
| MET | `0x50` `decodeActivityInfo` (`decode.ts:220`) | `state`, `met[]` (per-bin) | **enables the MET>1.8 active-period gate.** |
| Skin temp | `0x75`/`tempRows` → `temps_c` | centi-degC | feeds nightly temp + illness. |
| Movement | `0x72` `acm_mad` | MAD stats | sleep-staging / wear proxy. |
| Bedtime window | `0x76` `decodeBedtimePeriod` (`decode.ts:255`) | `bedtime_start_ds/end_ds` | **enables the sleep-window gate + daytime "not-asleep" filter.** |
| Daytime HR (all-day) | `0x86` aohr | HR series | **unvalidated** — candidate daytime-HRV/HR source for stress (§5.6). |
| EDA | `0x59` | decoded but **UNUSED** | possible future stress input; not required by the ported models. |

**Key feasibility flags up front:**
- **Accuracy gate is unsourced.** `daily_medians` excludes `hrv_accuracy < 20`; our `0x5d` decode
  carries no accuracy byte. Phase 1 applies the **MET + sleep-window gates and the mean→median
  switch** (fully sourced) and uses a **coverage/artifact proxy** for accuracy (§5.1), documenting
  the divergence — do not silently claim the accuracy gate is applied.
- **Daytime HRV is sparse** — the ring power-gates PPG when worn-idle (CLAUDE.md Oura section), so
  daytime `0x5d` samples are intermittent. `dhrv_imputation_1_1_0` (4.6K NN, weights now in the
  bundle) exists precisely to fill these; it is a Phase-2 dependency of daytime stress, not Phase 1.

---

## 4. Model reference (pointers only — math lives in the skill)

Read these before implementing; do not re-transcribe the formulas into code comments — load
constants from the vendored bundle (Sub-plan B) and cite the skill section.

| Metric | Model | Skill ref | Constants file | Params |
|---|---|---|---|---|
| HRV/RHR/temp median | `daily_medians_1_1_0` | stress-baselines-illness.md §"daily_medians" | `daily_medians_1_1_0.constants.json` (MET gate **1.8**, error codes only — no tensors) | 0 (RB) |
| Baselines | `daily_short_term_baselines_1_1_0` | §"daily_short_term_baselines" | `daily_short_term_baselines_1_1_0.constants.json` (window 5-21, error codes) | 0 (RB) |
| Daytime stress | `stress_daytime_sensing_1_1_0` | §"stress_daytime_sensing" | `stress_daytime_sensing_1_1_0.constants.json` (**target_level_limit 0.5, scaled_level_limit 0.4, ring_met_limit 1.8**) | 0 (RB) |
| Daytime HRV imputation | `dhrv_imputation_1_1_0` | cardiovascular-hr.md §7 | `dhrv_imputation_1_1_0.constants.json` (`rf_net.*` weights present; `means`/`stds` buffers present) | 4.6K NN-S |
| Cumulative stress | `cumulative_stress_1_2_2` | §"cumulative_stress" | `cumulative_stress_1_2_2.constants.json` — **now includes** `processor.fa_model_weights[9,6]`, `fa_model_mean[9]`, `fa_model_std[9]`, `cluster_centroids[5,5]`, `positive_clusters[2]`, `contributor_means[5]`, `contributor_99p[5]`, `contributor_01p[5]`, `dim_to_drop=0`, `fever_limit=38`, `min_days_required=21`, `luteal_phase_correction=0.2`, `min_sleep_length=480`, `min_hrv_coverage=0.2` | 0 (RB*) |
| Resilience | `stress_resilience_2_2_1` | §"stress_resilience" | `stress_resilience_2_2_1.constants.json` — **now includes** all `*_weight`, `resilience_plane_fit_coef[3]`, `pca_minor_axis_length[1]`, `resilience_level_multipier[4]`, `sleep_recovery_scaler_coef[4]`, bin thresholds | 0 (RB*) |
| Illness (reference only) | `illness_detection_0_5_1` | §"illness_detection" | `illness_detection_0_5_1.constants.json` — CNN weights present (`layer1…6`) but **we do NOT run the CNN**; use its 7-biomarker list as a tuning guide | 156K NN-L |

**Illness 7 biomarkers (direction/weight guide, from `illness_detection`):** `average_breath`,
`average_heart_rate`, `lowest_heart_rate`, `average_hrv`, `temperature_deviation`, `sedentary_time`,
`resting_time`. **Fever flag (mirror `cumulative_stress`):** `highest_temperature > fever_limit(38)`
OR `temperature_dev > temperature_dev_baseline`.

---

## 5. Design decisions (per metric)

### 5.1 HRV/RHR quality-gated median — **P1, no NN, highest value**

**New module `lib/health/daily-medians.ts`** porting `daily_medians_1_1_0`:

- `medianGated(samples, opts)` where a sample at timestamp `t` is **kept** iff NOT
  (`metMask(t)` OR `sleepMask(t)` OR `accuracyMask(t)`); result = median of kept, `null` if 0 kept
  (mirrors error code 6 → we return `null`, never throw — decoders-are-infallible rule).
- **MET gate:** given the day's `0x50` MET stream as `{ds, met}[]`, exclude any target `ts` within
  `[t, t+600ds]` (60 s) of any MET sample with `met > 1.8` (constant read from
  `daily_medians_1_1_0.constants.json`). The MET stream is already decoded per-bin; thread it into
  the sleep aggregation window (it is currently only day-averaged for `metAvg`).
- **Sleep-window gate:** consume bedtime windows as (start,end) pairs; exclude `ts ∈ [start,end]`.
  For the **nightly HRV** median we invert this (we *want* in-sleep samples) — see note below.
- **Accuracy gate (divergence):** we have no `hrv_accuracy` byte. Substitute a **coverage proxy**:
  reject a 5-min `0x5d` pair whose paired `hr_bpm` is out of band (35-150) or whose bin has too few
  underlying IBI beats to trust (reuse the `≥3 beats` discipline already in the RHR binning,
  `adapter.ts:3761`). Document in the module header that the true accuracy gate is unsourced on BLE
  and this is a best-effort proxy — **do not claim parity**.

**Application:**
- **Nightly HRV** (`adapter.ts:3740,3848`): replace `mean(rmssd>0)` with `medianGated` over the
  in-sleep-window `0x5d` RMSSD samples, applying the MET + accuracy(proxy) gates (the sleep-window
  gate is satisfied by construction since we already restrict to the sleep window). Persist the
  median to `sleep_sessions.average_hrv_ms` and `body_metrics.hrv_ms` as today.
- **Resting HR** (`adapter.ts:3759-3764`): the lowest-5-min-bin logic is already correct and arguably
  better than a plain median for "lowest HR". **Decision: keep the lowest-bin approach**, but pass
  its per-bin averages through the same MET/accuracy discipline (drop bins overlapping MET>1.8) so
  RHR and HRV exclude the same active periods. Do not switch RHR to a plain median — that would
  regress the "lowest, not mean" property Oura wants. Note this deviation from `daily_medians`
  (which medians `hr_min`) in the module header: our `hr_min` is already a per-bin min-of-means.
- **`skin_temp` median** from `daily_medians` is **not needed** — our nightly temp uses the ported
  `nightlyTemperatureCentiC` (min-of-window-maxima), which is a different, already-shipped Oura
  algorithm. Leave temperature alone.

### 5.2 Baseline reconciliation — **P2**

Two Oura baselines vs our one EMA:

| | Ours (`personal-baseline.ts`) | Oura `daily_short_term_baselines` main | Oura `night_hrv_baseline` |
|---|---|---|---|
| Method | asymmetric EMA, anneals by age, replayed forward | **centered Gaussian** over 5-21 day window, `std=window/2.5`, symmetric (center weighted most) | **median** of `average_hrv` over nights passing sleep≥4h AND 30≤lowest_hr≤200 AND 28≤highest_temp≤40 AND 5≤average_hrv≤150 |
| Output | mean + abs-dev (→ z-scores) | mean only | scalar |
| Cost | O(all history) replace-all | O(window) | O(window) |

**Decisions:**
- **Adopt `night_hrv_baseline` unconditionally** (new `lib/health/night-hrv-baseline.ts`) — daytime
  stress (§5.6) *requires* it as an input, and it is cheap and fully specified. Persist to a new
  `oura_daily_derived.night_hrv_baseline_ms` column. Physiological gates read the per-night values
  already in `oura_daily_summary` (`hrvAvgMs`, `rhrLowBpm`, temp).
- **Main baseline — present two options, recommend Option A:**
  - **Option A (recommended): keep our asymmetric-EMA** for the readiness z-scores. It is already
    ecore-pinned, unit-tested (`personal-baseline.test.ts`), and drives the shipped readiness
    contributors. Add the centered-Gaussian only as a *reconciliation check* in tests (assert the
    two agree within tolerance on the pinned vector), not a replacement. Rationale: swapping the
    baseline changes every readiness contributor at once — high blast radius for a metric that is
    "our own approximation" either way.
  - **Option B: migrate to the centered Gaussian** to match Oura's method exactly. Cleaner story,
    but loses the abs-deviation term our z-scores need (Oura's baseline is mean-only), so we'd have
    to derive spread separately (e.g. window std) — net new surface. Only take this if the EMA is
    shown to diverge materially on the pinned vector.
- **Fix the replace-all write (independent of A/B):** `replaceOuraDailySummary` (`slices/oura.ts:541`)
  deletes *all* user rows every rollup. The EMA replay is inherently sequential, but the rollup only
  ever touches a bounded recent window — change to an **upsert over the recomputed date range**
  (`ON CONFLICT (user_id, date) DO UPDATE`, scoped to `user_id`) instead of delete-all. Guard: the
  forward replay must still start from a correct prior baseline — seed the replay from the last row
  *before* the recomputed window rather than from null. This is a correctness+cost fix; call it out
  as its own task so it can ship even if A/B is deferred.

### 5.3 Persist readiness + contributors in completed form — **P1**

- Write `oura_daily_derived.readiness_score` (int 0-100), `readiness_contributors` (JSONB:
  `{ [key]: { score, provisional } }` for all 8 keys), `readiness_source`
  (`'oura-cloud' | 'ble-derived'`), and the model/constant version (provenance, master §4.6),
  inside the rollup right after `computeDailySummaries` (`adapter.ts:4165`) — the composite already
  consumes exactly the `oura_daily_summary` fields produced there.
- **`app/api/readiness-score/route.ts` becomes read-first:** read today's `oura_daily_derived` row;
  if present, return its stored score/contributors. Only when the row is missing (backfill/repair)
  fall back to the live `computeReadinessComposite` path — and persist the result. This keeps the
  Oura-Cloud blend precedence (`route.ts:265`) as the top branch when a Cloud readiness exists, but
  the `'custom'` branch stops recomputing on every paint.
- **Recovery-index contributor decision — calibrate, don't leave silently dead.** Today it is
  hard-wired `NEUTRAL` at weight 0.10 (`readiness-composite.ts:91`), i.e. a full 10% of readiness is
  a constant 50 — a silently dead weight. **Decision: map `recoveryIndexHours` → a 0-100 sub-score
  with an explicit, documented monotone curve** (earlier settle = higher score; e.g. clamp
  `hoursToSettle` to a plausible [0,8]h band and linear-map, direction "earlier-better"). It is an
  approximation (Oura's real hours→score curve is unrecovered), so flag `provisional` until
  validated and document the curve in the module. **If** review judges the curve too speculative,
  the fallback is to **redistribute the 0.10 weight** across the other 7 contributors (re-normalise)
  rather than keep a dead constant term — but the default is to calibrate. Either way, the "10% of
  readiness is a frozen 50" state must not persist. Record the chosen approach in the module header.

### 5.4 Fix wear confidence — **✅ ALREADY RESOLVED, reconciled 2026-07-15 (cloud session)**

**This section's premise is stale — do not implement it.** The `wornBinsByDay` wear-time step in
`aggregateOuraRawSamples` (`adapter.ts` ~4147–4174) was added 2026-07-13, *before* this plan doc was
written, and already derives wear from a BLE signal: it marks 15-min bins worn from IBI/HRV/SpO₂/
sleep-phase/sleep-signal/aohr samples or a skin-range temperature (≥31°C), and writes
`oura_daily.non_wear_time_sec` via `COALESCE(EXCLUDED.non_wear_time_sec, oura_daily.non_wear_time_sec)`
— the **only** writer of that column, so it is BLE-fresh for any day with BLE coverage, not frozen
Oura Cloud data. `readiness-score/route.ts` already reads it through `getOuraDaily` →
`toOuraByDate` → `excludeLowWearDays`/`isLowWearDay` — the exact call sites this section proposed
rewiring. Covered by `oura-ble-sleep-fallback.test.ts` ("materializes a binned HR series and a
derived wear-time day"). Building the `worn_hours_ble` mechanism below would add a second, redundant
wear-time signal next to the one already working — skip it.

<details><summary>Original (superseded) proposal — kept for history</summary>

`wear-confidence.ts` must derive wear from a **BLE signal**, not `oura_daily.nonWearTimeSec`.

- Add `bleWornHours(night)` computed from what the rollup already sees: the span covered by dense
  HR/IBI + `0x72` movement samples within the day. A pragmatic proxy: **count distinct 5-min bins
  in the day that contain ≥1 valid HR beat or movement sample**, ×5 min → worn minutes. The
  clamp-to-dense-sensing logic (`clampToDenseSensing`, `adapter.ts:3704`) already identifies dense
  HR runs — reuse that notion.
- Persist `oura_daily_derived.worn_hours_ble` in the rollup; `isLowWearDay` reads it (threshold
  `MIN_WEAR_HOURS=18` unchanged). Keep the Cloud `nonWearTimeSec` path only as a fallback for legacy
  pre-BLE dates (a day with neither signal stays *kept*, per the current "no signal → don't drop"
  rule at `wear-confidence.ts:31`). Update `excludeLowWearDays` call sites in
  `readiness-score/route.ts:150,162` to pass the BLE-derived map.

</details>

### 5.5 Illness radar — **P1, rule-based (user explicitly wants this)**

**New module `lib/health/illness-radar.ts`.** A composite deviation flag over the baselines we
already compute — *not* the CNN. Be explicit in copy and code that this is a **"vs-baseline radar"**,
less calibrated than Oura's demographic-calibrated CNN.

- **Per-biomarker z-scores** vs the personal baseline (`baselineZ`), for the biomarkers we have:
  skin-temp deviation (primary/fever), RHR↑, HRV↓, breathing-rate↑. (Sedentary/resting-time from the
  CNN's 7 are activity signals — optional, lower weight, skip if not readily available.)
- **Temp-weighted composite:** weight skin-temp deviation highest (it is the fever signal and the
  strongest illness marker), then RHR, HRV, breathing — use the `illness_detection` 7-biomarker
  ordering as the relative-weight guide (§4), normalised to sum 1 over the biomarkers we actually
  compute. `illness_score` = weighted sum of one-sided z-scores (each in the illness-consistent
  direction: temp away-from-baseline, RHR up, HRV down, breathing up), squashed to 0-100.
- **Fever flag (mirror `cumulative_stress`):** `illness_flag = fever` when
  `highest_temperature > fever_limit(38)` OR `temp_dev > temp_dev_baseline`, else a graded flag when
  `illness_score` crosses a documented threshold (tunable constant, in the module — not magic at the
  call site).
- **Guard — baseline-first (the load-bearing part, per owner steer 2026-07-15):** the whole point is
  to learn *your* normal before calling anything a deviation. Require a mature baseline
  (`nHistory ≥ BASELINE_MIN_NIGHTS = 14`, matching `readiness-composite.ts:71`) before the radar can
  raise a non-neutral flag; below that it silently accrues history and reports "learning your
  baseline". Never fabricate an illness signal on a cold user.
- **Persist** `oura_daily_derived.illness_flag` (enum/text), `illness_score` (0-100), and
  `illness_biomarkers` (JSONB: per-biomarker `{ z, contribution }`) so the surface can explain *why*.

**Surfacing decision (owner steer 2026-07-15): the radar lives INSIDE the readiness indicator, not a
separate card.** Rationale + design:
- **No standalone "illness" card.** When biomarkers deviate in the illness-consistent direction and
  the baseline is mature, the readiness surface shows an **inline advisory** — e.g. "Signs your body
  may be fighting something — readiness lowered" — with the contributing biomarkers (temp ↑, RHR ↑,
  HRV ↓) as the explanation. This is the Oura "signs of strain / getting sick" pattern.
- **Readiness suppression, NOT a double-counted contributor.** The illness biomarkers (skin-temp
  deviation, RHR, HRV) are **already readiness contributors** — adding their z-scores again as a new
  weighted term would double-count. Instead, illness is a **post-composite cap/penalty**: when
  `illness_score` crosses the flag threshold, apply a bounded readiness *suppression* (a capped
  multiplicative/subtractive penalty, documented constant) on top of the existing composite, and
  attach the advisory. This keeps `readiness-composite.ts`'s weights untouched and models "illness
  overrides an otherwise-OK readiness", which is the real-world behaviour.
- **Graded, honest states:** `learning baseline` (cold) → `normal` → `watch` (mild multi-signal
  deviation, advisory only, no/low suppression) → `elevated`/`fever` (strong deviation or
  `temp > fever_limit`, advisory + suppression). Thresholds are documented constants in the module.
- **Storage already covers it** (fields above); the readiness route adds the flag + advisory + the
  applied suppression amount to `ReadinessScoreResponse` so the card renders the state and the "why".
  A dedicated illness/trend view can come later if wanted, but is out of scope for P1 — the readiness
  indicator is the surface.

### 5.6 Daytime stress — **P2, portable**

**New module `lib/health/daytime-stress.ts`** porting `stress_daytime_sensing_1_1_0` (fully specified
in the skill — do not re-derive):

- `intensity = dhrv − dhrv_baseline`; neutral half-width `h(night_hrv_baseline)` = `<40→2, <75→3,
  else→4`; step-lookup stress/recovery saturations (tables in the skill); scale to ~[-1,1] via
  `stress_scaler`; then `equalize_scaled_levels` using `target_level_limit=0.5`,
  `scaled_level_limit=0.4` (read from `stress_daytime_sensing_1_1_0.constants.json`, Sub-plan B).
- Validation gate: `ring_met ≤ ring_met_limit(1.8)`, dhrv timestamp inside a bedtime window is a
  **sleep** sample and excluded (silent condition 6).
- **Inputs:** needs a **daytime HRV value** and `night_hrv_baseline` (§5.2). Daytime HRV source
  options, in preference order:
  1. Direct daytime `0x5d` RMSSD samples when present (sparse — power-gating).
  2. **`dhrv_imputation_1_1_0`** to fill gaps (4.6K NN; weights + `means`/`stds` now in the bundle).
     Its 10 features are HR-median/min/max (÷hr_baseline), skin-temp stats, MET stats, and the two
     baselines (cardiovascular-hr.md §7). This is the Phase-2 enabler; scope the NN wiring as a
     sub-task (server-side, per master §4.4 — no PyTorch in the WebView; a tiny hand-rolled MLP
     forward pass over the vendored weights is sufficient at 4.6K params).
  3. `0x86` aohr as an alternate HR source — **unvalidated**, so behind a flag.
- **Persist** `oura_daily_derived.daytime_stress_scaled` (float [-1,1]) plus, if a full-day series is
  computed, aggregate `stress_high_minutes`/`recovery_high_minutes` (these can eventually replace the
  frozen Cloud `stressHigh`/`recoveryHigh` passthroughs at `route.ts:332-333`).

### 5.7 Cumulative stress + resilience — **P3, heavier (tensor wiring)**

Now portable because the archived tensors are in the bundle (verified present, §4). Flag as heavier:
faithful tensor wiring + a long history requirement.

- **Cumulative stress (`cumulative_stress_1_2_2`)** — `lib/health/cumulative-stress.ts`:
  aggregate the 9 history features (per skill: `got_ups` via robust Huber-normalised, the rest via
  median), standardize `(X − fa_model_mean)/fa_model_std`, project `X_scale @ fa_model_weights`
  (`[9,6]`), drop `dim_to_drop=0` → 5-dim, softmin-distance to `cluster_centroids[5,5]`,
  `chronic_stress_score = round(sum(proba[positive_clusters]) × 100)`. 5 signed contributors via
  `contributor_means`/`99p`/`01p` (first four negated). **Gate:** `min_days_required=21` non-NaN
  history per required feature. **Reuse the fever flag** here too (shared with §5.5). Cycle-phase
  luteal correction is **N/A** (single male user) — set `final_interpreted_cycle_phase=0`.
- **Resilience (`stress_resilience_2_2_1`)** — `lib/health/resilience.ts`: quantize daytime stress
  (§5.6) into 7 bins, weighted daily indices (`*_weight` tensors), `daily_sleep_recovery` from
  sleep_score/hrv_balance/recovery_index/RHR (drop hrv_balance term when NaN),
  `polyval(sleep_recovery_scaler_coef,·)`, rolling long-term recency-weighted sums, PCA-plane
  boundaries (`resilience_plane_fit_coef[3]`, `pca_minor_axis_length`, `resilience_level_multipier[4]`)
  → 5 levels, `find_granular_resilience_level` → decimal in [1.01,5.99].
- **Persist** `oura_daily_derived.chronic_stress_score` (0-100), `chronic_stress_contributors`
  (JSONB), `resilience_level` (numeric 1-5), replacing the frozen Cloud `resilienceLevel`
  passthrough (`route.ts:318`).
- **Risk to accept up front:** these have long warm-up (21+ days) and depend on daytime stress (P2)
  which depends on daytime-HRV imputation. Schedule strictly after P2 lands and a pinned vector
  exists. If tensor wiring proves fiddly, ship chronic-stress first (self-contained) and resilience
  after.

---

## 6. Storage (completed form)

All new derived outputs land in **`oura_daily_derived`** (one row per user per local day), the
completed-form table created by **Sub-plan A** (master §4.1). This plan **adds columns** to it (or
creates the table with these columns if E lands before A — coordinate at implementation, see §7).

| Column | Type | Metric | Phase |
|---|---|---|---|
| `readiness_score` | int | §5.3 | P1 |
| `readiness_contributors` | jsonb | §5.3 (8 keys, `{score,provisional}`) | P1 |
| `readiness_source` | text | provenance | P1 |
| `worn_hours_ble` | real | §5.4 | P1 |
| `illness_flag` | text | §5.5 | P1 |
| `illness_score` | int | §5.5 | P1 |
| `illness_biomarkers` | jsonb | §5.5 (per-biomarker z + contribution) | P1 |
| `night_hrv_baseline_ms` | real | §5.2 | P2 |
| `daytime_stress_scaled` | real | §5.6 | P2 |
| `stress_high_minutes` / `recovery_high_minutes` | int | §5.6 | P2 |
| `chronic_stress_score` | int | §5.7 | P3 |
| `chronic_stress_contributors` | jsonb | §5.7 | P3 |
| `resilience_level` | real | §5.7 | P3 |
| `model_version` | text | constant/model version tag (provenance) | P1 |

- Nightly HRV/RHR medians (§5.1) continue to persist to `sleep_sessions` + `body_metrics` (no schema
  change) — only the *computation* changes.
- Every derived value carries provenance (`source` + `model_version`) per master §4.6.
- All writes are idempotent and replayable over stored `body_hex` (master §4.3): recomputing a day
  re-writes its `oura_daily_derived` row. Never prune/mutate `body_hex`.

---

## 7. Plumbing

- **Rollup:** all derivation runs server-side inside `aggregateOuraRawSamples` (`adapter.ts`, the
  `step('daily_summary', …)` block at `:4163`), never on-device/browser (master §4.4). Order:
  nightly medians (§5.1) feed `sleepRows` → `computeDailySummaries` → then readiness/illness/wear
  (P1), then daytime stress (P2), then cumulative/resilience (P3), each writing its
  `oura_daily_derived` columns. Add a single `step('daily_derived', …)` block after
  `computeDailySummaries` that upserts the derived row.
- **Baseline write:** change `replaceOuraDailySummary` (`slices/oura.ts:540`) from delete-all to a
  `user_id`-scoped upsert over the recomputed date range (§5.2), seeding the forward replay from the
  last row before the window.
- **Read sites:**
  - `app/api/readiness-score/route.ts` → read-first from `oura_daily_derived` (§5.3); add
    `illness_flag/score/biomarkers`, `daytime_stress_scaled`, `chronic_stress_score`,
    `resilience_level` to `ReadinessScoreResponse` (replacing the frozen Cloud passthroughs for
    stress/resilience). Web fallback stays logic-free per Canonical Runtime — a pure read of the
    persisted row.
  - Add repo methods `getOuraDailyDerived(userId, from, to)` / `upsertOuraDailyDerived(...)` in
    `lib/data/repository.ts` + `slices/oura.ts` + the adapter delegate row (mirror
    `getOuraDailySummary`/`replaceOuraDailySummary` at `adapter.ts:4576`).
- **Cache groups:** `readiness-score` is already invalidated by `invalidateOuraSync` and the
  workout/summary groups (`lib/cache-groups.ts:22,88,122,147`). No new key needed if the illness/
  stress data rides the existing `readiness-score` payload. If a **new** GET route is added for a
  dedicated illness/stress card, register its key in `invalidateOuraSync` **and** give it one
  canonical TTL in `lib/cache-ttl.ts` and SWR headers at creation (CLAUDE.md cache rules).
- **Redecode:** new decoders/derivations must be replayable over stored `body_hex`; the rollup's
  existing redecode path re-writes `oura_daily_derived` idempotently. No `body_hex` mutation.
- **Migrations:** claim numbers against **both** the directory and the sibling plan docs (CLAUDE.md
  rule — the tree already has collided pairs). Current tree: highest is `122_oura_accel_chunks.sql`,
  with `120` **missing** — do **not** fill the 120 gap (it would apply out of order on DBs that
  already ran 121/122). Sub-plan A owns `oura_daily_derived` creation; E's migration **adds the §6
  columns** to it. Allocate E's migration *after* A's (tentatively `124` if A takes `123`) and
  register every new column in `RECONCILE_COLUMNS` in the same commit (local-SQLite rule) — though
  `oura_daily_derived` is Postgres-only server-side, confirm whether it is also mirrored locally
  before assuming no reconcile entry is needed.
- **`docs/module-map.md`:** add a one-line row for each new `lib/health/*` module (daily-medians,
  night-hrv-baseline, illness-radar, daytime-stress, cumulative-stress, resilience) in the same PR
  that introduces it.

---

## 8. Phased task list

### Phase 1 (branch `feat/oura-recovery-health-events`, ships first)
1. `lib/health/daily-medians.ts` — port `daily_medians` (median + MET gate + sleep-window gate +
   coverage-proxy accuracy gate). Unit tests + pinned-vector test. (§5.1)
2. Wire nightly HRV (`adapter.ts:3740,3848`) to `medianGated`; thread the `0x50` MET stream into the
   sleep window; apply MET/accuracy discipline to the RHR bins (`:3759-3764`). (§5.1)
3. Fix `replaceOuraDailySummary` delete-all → scoped upsert over the recomputed range. (§5.2 — ship
   in P1 as an independent correctness/cost fix.)
4. `oura_daily_derived` P1 columns migration (readiness, illness, wear, provenance) — coordinate
   number with Sub-plan A. (§6)
5. Persist readiness + contributors in the rollup; make `readiness-score` route read-first. (§5.3)
6. Calibrate the recovery-index contributor (documented curve) OR redistribute its weight — no dead
   constant term left. (§5.3)
7. `lib/health/wear-confidence.ts` → BLE-derived wear (`worn_hours_ble`); update call sites. (§5.4)
8. `lib/health/illness-radar.ts` — rule-based vs-baseline radar; persist flag/score/biomarkers;
   surface in the readiness payload. (§5.5)

### Phase 2
9. `lib/health/night-hrv-baseline.ts` — median over physiologically-gated nights; persist. (§5.2)
10. Baseline reconciliation test (EMA vs centered Gaussian) + decision record (Option A default). (§5.2)
11. `dhrv_imputation` server-side forward pass over vendored weights (daytime-HRV fill). (§5.6)
12. `lib/health/daytime-stress.ts` — port `stress_daytime_sensing`; persist `daytime_stress_scaled`
    + high-minutes. (§5.6)

### Phase 3
13. `lib/health/cumulative-stress.ts` — port `cumulative_stress` with FA/centroid tensors; persist
    chronic score + contributors; shared fever flag. (§5.7)
14. `lib/health/resilience.ts` — port `stress_resilience` with PCA/weight tensors; persist level.
    (§5.7)
15. Replace frozen Cloud `stressHigh`/`recoveryHigh`/`resilienceLevel` passthroughs with the derived
    values in the route. (§5.7)

---

## 9. Testing

- **Unit:** each new `lib/health/*` module gets a `__tests__` file (mirror
  `personal-baseline.test.ts`). Cover: median gating (all-active day → `null`, not a throw; MET/sleep
  exclusion boundaries at `t+60s`); illness fever-flag boundaries (temp exactly at `fever_limit=38`);
  daytime-stress `equalize_scaled_levels` at `|x|=scaled_level_limit`; baseline boundary at 23:59/
  00:01 user-local (date-window rule).
- **Pinned test vector:** capture/redecode one real night's `oura_raw_samples.body_hex` and pin the
  expected nightly HRV median, RHR, readiness score+contributors, illness score, and (P2/P3) daytime
  stress / chronic score — mirroring the Oura-BLE decoder discipline (master §4.5). Store the vector
  + expected outputs next to the tests.
- **Reconciliation test (§5.2):** assert the asymmetric-EMA baseline and Oura's centered-Gaussian
  agree within tolerance on the pinned vector; if they diverge materially, escalate to Option B.
- **Local dev:** exercise `GET /api/readiness-score` against the local seeded DB; confirm it reads
  the persisted `oura_daily_derived` row (not a live recompute) and returns the new illness/stress
  fields.
- **Device gate (Canonical Runtime):** the rollup + BLE wear signal only run for real on the S25 APK
  with a real ring. Any claim that nightly medians / wear / illness work end-to-end needs the
  on-device smoke run (`docs/device-smoke-checklist.md`) **or** a Known-Issues row in
  `projectOverview.md` marking it not-yet-device-verified. State explicitly in the PR which surfaces
  were exercised only in the web sandbox (native SQLite, real BLE MET/HRV stream) and are therefore
  unverified.

---

## 10. Risks

- **Accuracy gate is unsourced on BLE** — the coverage proxy (§5.1) is not the same as Oura's
  `hrv_accuracy<20`. Nightly HRV may still admit lower-quality samples than Oura. Mitigate by
  documenting the divergence and validating median-vs-mean on the pinned vector.
- **Recovery-index curve is speculative** — Oura's real hours→score mapping is unrecovered.
  Calibrating it risks fabricated precision; leaving it dead wastes 10% of readiness. The plan
  chooses a documented approximation flagged `provisional`; reviewer may prefer weight
  redistribution.
- **Baseline swap blast radius** — Option B changes every readiness contributor at once. Default to
  Option A (keep EMA) to contain risk.
- **Replace-all → upsert seeding bug** — the forward EMA replay must seed from the correct prior
  baseline or the first recomputed night drifts. Explicit task + test.
- **Daytime HRV sparsity / imputation NN** — daytime stress depends on filling gaps with a 4.6K NN;
  a wrong feature order or missing standardization buffer yields silently wrong stress. Pin to a test
  vector; validate a known input→output pair.
- **P3 tensor wiring** — FA/centroid/PCA tensors are load-bearing; an axis/transpose error produces
  plausible-but-wrong scores. Faithful shape checks (`fa_model_weights[9,6]`, `cluster_centroids[5,5]`)
  and a pinned vector are mandatory before shipping.
- **Long warm-up** — cumulative stress needs 21+ days, resilience needs a rolling window; on a fresh
  user these are `null`/insufficient for weeks. Surface an honest "accruing history" state, never a
  fabricated number.
- **Migration number collision** with parallel Oura sub-plans — claim against directory + plan docs;
  do not fill the 120 gap.

---

## 11. Backlog entry

Add to `docs/implementation-backlog.md` at the priority the planner judges (per master §7, E-Phase1
ranks just behind enablers B and A, tied with sleep C for highest downstream value):

```
### feat/oura-recovery-health-events — Oura recovery, readiness & health events (Sub-plan E)
Plan: docs/superpowers/plans/2026-07-15-oura-recovery-readiness-and-health-events.md
Depends on: Sub-plan B (constants loader), Sub-plan A (oura_daily_derived table).
P1 (ship first): HRV/RHR quality-gated median (fix naive mean, adapter.ts:3740/3848);
  baseline delete-all → scoped upsert (slices/oura.ts:541); persist readiness + contributors to
  oura_daily_derived + read-first route; calibrate/redistribute the dead recovery-index weight;
  BLE-derived wear confidence; rule-based illness radar (user-requested).
P2: night_hrv_baseline; baseline reconciliation (EMA vs centered-Gaussian, keep EMA by default);
  dhrv_imputation forward pass; daytime stress port.
P3: cumulative stress + resilience ports (tensors now in bundle; heavier — needs faithful wiring +
  pinned vector); replace frozen Cloud stress/resilience passthroughs.
Device gate: rollup + BLE wear/MET/HRV only real on S25 APK — device smoke or Known-Issues row.
```

Re-verify the plan against `main` before implementing (plans go stale): confirm `adapter.ts:3740`
still computes the naive mean, `readiness-composite.ts:91` still hard-wires the recovery-index
contributor to `NEUTRAL`, and Sub-plan A's `oura_daily_derived` shape before adding columns.
