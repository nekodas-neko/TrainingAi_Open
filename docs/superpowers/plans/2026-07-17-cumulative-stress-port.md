# Cumulative-Stress (`cumulative_stress_1_2_2`) TS Port — Implementation Plan / Handoff

> **For the implementer:** this is a **verbatim TorchScript→TypeScript port, golden-verified** — the
> same pattern already used for `stress_resilience_2_2_1` (`lib/health/stress-resilience.ts`),
> `training_stress_score_0_2_1` (`lib/oura-models/inference/ots.ts`), `daily_short_term_baselines`
> (`lib/oura-models/daily-baselines.ts`) and `meal_timing` (`lib/oura-models/meal-timing.ts`). Read one
> of those + its test first to internalise the shape of the work. **Everything you need is already in
> the repo** (golden vector on `main`, source, constants extractable, harness). This is the single
> largest port of the set (~600 lines, 27 inputs, 19 outputs) — do it **stage-by-stage against
> `.pt`-dumped intermediates**, not one big pass.

**Goal:** Port Oura's `cumulative_stress_1_2_2` (ChronicStress — a 0-parameter algorithmic TorchScript
model) to TypeScript at `lib/oura-models/cumulative-stress.ts`, golden-verified to `< 1e-3` against the
captured `.pt` vector. It is the §4 pair to stress-resilience: a chronic-stress score + 5 UI
contributors + intermediates, from ~2 weeks of nightly biometrics. **Library port only** — do NOT wire
it into a surface or the rollup in this PR (persistence columns `chronic_stress_score` /
`chronic_stress_contributors` already exist from migration 123; wiring is a separate follow-on).

---

## Current state (all prep done — verified 2026-07-17)

- ✅ **Golden vector on `main`:** `lib/oura-models/goldens/cumulative_stress_1_2_2.golden.npz`
  (**27 inputs `in_0..in_26`, 19 outputs `out_0..out_18`** — all outputs non-trivial, a strong anchor).
  Convert it to a JSON test fixture with the existing harness:
  `python3 scripts/oura-models/golden-to-json.py cumulative_stress_1_2_2`
  → writes `lib/oura-models/onnx/__fixtures__/cumulative_stress_1_2_2.golden.json` (`{shape, flat}` per key).
- ✅ **The `.pt` is on the backup branch** (gitignored in the tree). Fetch it for the intermediate-dump
  oracle:
  `git show origin/docs/preserve-pt-originals-and-goldens:lib/oura-models/pt/cumulative_stress_1_2_2.pt > lib/oura-models/pt/cumulative_stress_1_2_2.pt`
- ✅ **torch 2.13.0 + numpy are available in the sandbox** (`pip install onnxruntime onnx` if you also
  need ONNX — you do NOT for this model; it is 0-parameter, pure algorithm, **no ONNX core**).
- ✅ **Traced source (authoritative — port from this, NOT memory):**
  `docs/oura-models/readable/cumulative_stress_1_2_2__source/`
  - `___torch_mangle_10.py` — `ChronicStress` top `forward` (344 lines) + `determine_cycle_phase`,
    `enhanced_final_check`, `check_valid_tensor`, `get_ui_contributors`.
  - `___torch_mangle_8.py` — `Preprocessor.preprocess` (279 lines, 18 outputs): `drop_fever_outliers`,
    `calculate_sfi`, `normalise_hrv_median`, `calculate_norm_iqr`, `normalise_temperature_wake`,
    `remove_temp_outliers`, `normalise_hr_min`, `calculate_medianbaseline_ratio_nhrv`.
  - `___torch_mangle_9.py` — `Processor` (**fully understood, see below**): `estimate_chronic_stress`,
    `estimate`, `factor_analysis_transform`, `factor_analysis_drop_dim`, `estimate_cluster_proba`,
    `euclidean_distance2centroid`, `scale_contributors`.
  - `utils.py` — `torch_huber`, `torch_median`, `format_decimal`.
  - `___torch_mangle_7.py` — `Validator` (568 lines, mostly error-code boilerplate — **do NOT port
    verbatim**; reduce to a pragmatic pass/fail gate that returns all-NaN outputs on invalid input, the
    way the resilience port gates. The golden input is valid so `validation_result == 0`).
- ✅ **Constants:** vendored in `lib/oura-models/constants/cumulative_stress_1_2_2.constants.json` for
  the scalar attrs, but the tensor buffers (`fa_model_*`, `cluster_centroids`, `contributor_*`,
  `contributor_levels`) are cleanest to extract straight from the `.pt`. Shapes (confirmed):
  `fa_model_mean (9,)`, `fa_model_std (9,)`, `fa_model_weights (9,6)`, `dim_to_drop = 0`,
  `cluster_centroids (5,5)`, `positive_clusters (2,) int64`, `contributor_means/01p/99p (5,)`,
  `contributor_levels (…, 5, 2)` (piecewise-linear level thresholds), top-module
  `luteal_phase_correction = 0.2`. Vendor them into a `cumulative_stress_1_2_2.constants.json` values
  block (or a small typed loader beside `getResilienceConstants`), extracted via:
  ```python
  import torch, numpy as np; torch.set_grad_enabled(False)
  m = torch.jit.load("lib/oura-models/pt/cumulative_stress_1_2_2.pt", map_location="cpu").eval()
  p = m.processor
  for n in ["fa_model_mean","fa_model_std","fa_model_weights","dim_to_drop","cluster_centroids",
            "positive_clusters","contributor_means","contributor_01p","contributor_99p"]:
      v = getattr(p, n); print(n, v if isinstance(v,int) else np.asarray(v).tolist())
  print("contributor_levels", np.asarray(m.get_ui_contributors.__self__.contributor_levels).tolist())  # or m.contributor_levels
  print("luteal_phase_correction", float(m.luteal_phase_correction))
  ```

---

## The pipeline (top `forward`, mangle_10) — port in this order

1. **Pre-clean:** `hrv_medianHR_5min[hrv_medianHR_5min < 1] = NaN`.
2. **Validator** → pragmatic gate (all-NaN outputs if invalid; golden is valid).
3. `bedtime_start //= 1000`, `temp_skin_timestamps //= 1000` (ms→s, int32).
4. **`determine_cycle_phase(interpreted_cycle_phase, cycle_phase, n_days_to_ovulation, n_days_to_period)`**
   → `final_interpreted_cycle_phase`, `interpreted_cycle_phase_latest`.
5. `temperature_dev_limit = temperature_dev_baseline + final_interpreted_cycle_phase * luteal_phase_correction (0.2)`.
6. **`Preprocessor.preprocess(...)`** → 18 outputs (the feature-engineered latest-night values +
   history-consistent series + `fever_mask_31`, `hrv_coverage`, `sufficient_sleep_check`). This is the
   big piece — port method-by-method, verifying each against the dumped intermediate.
7. Concatenate history + latest for the 5 "series" features (SFI ÷100, norm_hrv_medianHR_5min,
   median_hrv_quality_5min, normalised_iqr, norm_temp_wake).
8. **`enhanced_final_check(...)`** → `final_check_result`, `fever`, `can_produce_score`,
   `can_produce_intermediates` (another gate + the fever flag).
9. **`Processor.estimate_chronic_stress(...)`** (see below) → `chronic_stress_score` (×100, rounded),
   `contributors` (5), `cluster_proba`.
10. **`get_ui_contributors(...5 contributors...)`** → piecewise-linear remap of each contributor through
    `contributor_levels` thresholds into UI levels.
11. **Assemble the 19 outputs** (read the exact order + shapes off the `forward` return tuple and the
    golden `out_0..out_18` shapes; e.g. `out_0 (1,1)=21`, `out_1..(1,1)` scalars, `out_17 (5,1)` =
    contributors, `out_18 (20,1)`). Map each output name → its golden index by matching values from the
    `.pt` run.

### Processor (mangle_9) — FULLY UNDERSTOOD, port directly
```
estimate(got_ups, total_sleep_duration, norm_hr_min, sfi, norm_hrv_medianHR_5min,
         median_hrv_quality_5min, average_met_minutes, normalised_iqr, medianbaseline_ratio_nhrv, norm_temp_wake):
  norm_got_ups_huber = torch_huber(got_ups.flatten()) / (nanmean(total_sleep_duration.flatten())/60/60)
  X = stack([ norm_got_ups_huber,
              torch_median(norm_hr_min), torch_median(sfi), torch_median(norm_hrv_medianHR_5min),
              torch_median(median_hrv_quality_5min), torch_median(average_met_minutes),
              torch_median(normalised_iqr), torch_median(medianbaseline_ratio_nhrv),
              torch_median(norm_temp_wake) ], dim=1)                       # shape [1,9]
  fa = factor_analysis_transform(X)   # ((X.flatten() - fa_model_mean) / fa_model_std) @ fa_model_weights  -> [6]
  fa = factor_analysis_drop_dim(fa, dim_to_drop=0)  # drop index 0 -> reshape [1,5]
  (positive_cluster_proba, cluster_proba) = estimate_cluster_proba(fa):
       dist = fro_norm(cluster_centroids - fa, dim=1)   # per-centroid euclidean, [5]
       cluster_proba = softmin(dist, dim=0)             # torch.nn.functional.softmin
       positive_cluster_proba = sum(cluster_proba[positive_clusters])
  scaled_contributors = scale_contributors(fa):
       x = fa - contributor_means
       x = where(x>0, x/contributor_99p, x/(-contributor_01p)); clamp(-1,1); *100   # [5]
  return (positive_cluster_proba, scaled_contributors, cluster_proba)
estimate_chronic_stress = round(estimate(...).positive_cluster_proba * 100)   # the score
```
### utils — semantics that WILL bite if ignored
- `torch_median(x)` here is the **TRUE median** (average of the two middle values for even n) — it is
  `(torch.median(cat(valid, max(valid))) + torch.median(valid)) / 2` over the non-NaN values. This is
  **different** from `daily-baselines.ts`'s `torch.median` (which uses the lower-middle element). Do not
  reuse that helper — implement this one.
- `torch_huber(x, c=1.5, tol=1e-5, max_iter=50, eps=1e-8)` returns a **robust SCALE** (not a location):
  median/std seed, an outlier trim (`<= mu + 3.4·max(std, p90−p10)` OR `< p90+7`), then IRLS reweighting
  until `|scale_new − scale| < tol`. Port the loop verbatim from `utils.py`.

---

## De-risking: stage-verify against `.pt` intermediates (do this — it's why the port is low-risk)

`register_forward_hook` does NOT work on ScriptModules. Instead, in a python oracle script, **replicate
each stage's inputs from the golden and call the scripted submethod directly**, or reconstruct the stage
in numpy and diff against the `.pt`'s top-level output. Concretely:
- Run `m(*feeds)` once to get the 19 reference outputs (already confirmed to reproduce the golden).
- For the **Processor**: build `X` (the 9-feature vector) in numpy from the golden's preprocessed inputs,
  then call `m.processor.estimate(...)` directly (scripted submethods ARE callable:
  `m.processor.factor_analysis_transform(torch.tensor(X))`, etc.) and diff your TS stage against it.
- For the **Preprocessor**: call `m.preprocessor.preprocess(*preprocess_feeds)` directly and diff each of
  its 18 outputs against your TS `preprocess`.
- Only after each stage matches, run the end-to-end golden test on all 19 outputs.

Write the parity test as `lib/oura-models/__tests__/cumulative-stress.test.ts` reading the JSON fixture
(copy the `daily-baselines.test.ts` shape); assert each `out_i` within `1e-3` (NaN-aware).

---

## File structure

**Create:** `lib/oura-models/cumulative-stress.ts` (the port), `lib/oura-models/__tests__/cumulative-stress.test.ts`,
`lib/oura-models/onnx/__fixtures__/cumulative_stress_1_2_2.golden.json` (from the harness),
`scripts/oura-models/dump-cumulative-stress-intermediates.py` (the oracle you write for stage-verify — optional to commit).
**Modify:** vendor the tensor constants (constants JSON values block or a typed loader in
`lib/oura-models/constants/index.ts`); `docs/module-map.md` (one row); remove the
`cumulative_stress_1_2_2` backlog entry when done; add the session journal entry.

---

## Working rules (from CLAUDE.md — follow exactly)

- **Golden-verify is the bar.** Never claim parity without the fixture asserting `< 1e-3`. Port from the
  traced source, never memory. If a branch is ambiguous, pin it against a `.pt`-dumped intermediate.
- **Branch/PR/CI/merge:** develop on branch `claude/backlog-dual-agent-run-vl4tvb` (start it fresh from
  `origin/main`: `git fetch origin main && git checkout -B <branch> origin/main`). Everything reaches
  `main` via a PR with all 5 required checks green (Lint, Tests, Build, Custom Rules, Migration Check).
  **Merge on green without asking** for a standard change (this is library-only: no migration, no auth,
  no secrets, no user-visible change). Squash-merge via the GitHub MCP tools.
- **The Tests check runs DB-integration tests that a bare `pnpm test` SKIPS locally.** Before pushing,
  run the full suite with the DB URL so CI passes first try (saves Actions minutes):
  `export DATABASE_URL="postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" && npx vitest run`.
  (The local Postgres is auto-started by the session hook.)
- **No version bump / changelog** — this is library infrastructure with no user-visible change (same as
  the other model-port PRs). Do add a `docs/module-map.md` row and a per-entry journal file in
  `docs/overview/entries/YYYY-MM-DD-<slug>.md` (NOT a prepend to a shared history file).
- **State what was NOT verified** in the PR body (e.g. "not wired into any surface/rollup — library
  port; wiring is the follow-on").
- **Don't rush.** It's ~600 lines / 19 outputs. Port + verify stage-by-stage. A silent
  off-by-a-normalisation bug is the failure mode — the intermediate dumps prevent it.
- **`.pt` files are gitignored** (`lib/oura-models/pt/*.pt`) — never commit them; the `.onnx`/golden/
  fixture artifacts ARE committed. Clean up any scratch dirs before shipping (stray untracked files fail
  the stop-hook).

---

## Other remaining model ports (context — not this PR)

After `cumulative_stress`, the still-unported captured-golden models are:
- **`steps_motion_decoder_2_0_0`** — 0-param, ~370-line dense frame decoder (256×27 → 768×11). Pure port.
- **`astd_event_detection_0_1_0`** — 0-param, 387-line stress-event classify+segment. Pure port.
- **`awhr_profile_selector_1_0_1`** — **neural** (10.8K params). Needs the ONNX-export path like
  `step_counter`: fetch `.pt` from the backup branch, export the neural core to ONNX bit-exact
  (`torch.onnx.export(submodule, ..., dynamo=False, opset=17)` — the FULL graph won't export if it has a
  `torch.roll`/unsupported op, so export the clean NN core and port the glue in TS, exactly like
  `scripts/oura-models/export-step-counter-core.py` + `lib/oura-models/inference/step-counter.ts`).
- **Step-counter real-data wiring + admin export console** — `runStepCounter` is ported+verified but not
  fed real data; the ring's motion-frame → 16-feature decode isn't in `lib/oura-ble/decode.ts`. Map that
  decode, then an admin console that runs the port over stored `oura_raw_samples` and exports step counts
  for owner validation vs the phone. (Owner explicitly wants this console.)

Reference ports to copy the pattern from: `lib/oura-models/daily-baselines.ts` (simple, golden test shape),
`lib/oura-models/meal-timing.ts` (intricate algorithmic), `lib/oura-models/inference/step-counter.ts`
(neural core + ONNX + hybrid glue). Golden→JSON harness: `scripts/oura-models/golden-to-json.py`.
