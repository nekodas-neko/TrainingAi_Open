# D5 — own daytime-HRV (implementation plan)

**Status:** planning + implementer doc, written and executed in the same session (owner directive —
plan then build, no separate hold). Read
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](2026-07-21-oura-ondevice-hybrid-master-plan.md) §D5 and
[`2026-07-21-oura-decoupling-and-own-models-strategy.md`](2026-07-21-oura-decoupling-and-own-models-strategy.md)
first — this doc turns that scope into a concrete build. D5 is next per the master plan's **D6 → D5 → D2**
sequencing (D6, the Polar H10 comparison harness, shipped 2026-07-27 — see
[`2026-07-26-d6-polar-h10-comparison-harness.md`](2026-07-26-d6-polar-h10-comparison-harness.md)); D5 must
land before D2's neural port so dHRV is never WASM-ported only to be deleted right after.

## Why this is a genuine build, not a wiring task

Today `lib/health/daytime-stress.ts`'s `computeDaytimeStress()` calls Oura's own `dhrv_imputation_1_1_0`
ONNX model (`lib/oura-models/inference/dhrv.ts`) to turn a short window of skin-temp/MET/HR into an imputed
daytime HRV value, which feeds `stress = dhrv − dhrv_baseline` and ultimately the resilience/Body-Battery
pipeline. The ring only emits real `0x5d` HRV events **7% of daytime hours** (verified on-device 2026-07-16,
`2026-07-16-remaining-oura-models-build-plan.md` §0 — night-only), which is why Oura built an imputation in
the first place. D5's job is to replace that ONNX call with **our own** imputation, built with zero
knowledge of dHRV's actual behaviour (**observe-never-feed** — the whole point of D6 existing first is to
validate against the Polar H10, not against dHRV, so we never re-anchor to Oura's opinion).

## What already exists (do not re-build)

- **`rmssdFromRr(rrMs: number[])`** (`lib/health/rmssd.ts`) — the app's one RR→rMSSD implementation
  (artifact-gated, `MIN_BEATS=30`). Already used for chest-strap-derived HRV elsewhere; this is what the D6
  harness adapter for this feature will use on the H10 side.
- **`rr_intervals`** table (migration 124) — beat-to-beat RR from the H10 (`source='chest_strap'`), already
  written live by `POST /api/hr-ingest` whenever the strap is worn. No new ingest work needed for the D6
  reference side.
- **`getOuraRawSamplesForTags(userId, tags, days)`** (`lib/data/repository.ts:675`) — decoded raw-sample
  read, ordered by `measured_at`, already used by the admin device-metrics route
  (`app/api/oura-ble/device-metrics/route.ts`) for exactly this kind of compute-on-read job. This is the
  read path for training-pair extraction — **no new repo read method needed**, and critically, this does
  NOT touch `aggregateOuraRawSamples` (the write/rollup pipeline CLAUDE.md flags as high-blast-radius).
- **`listSleepSessions(userId, from, to)`** — existing repo method, gives `sleepStart`/`sleepEnd` windows to
  restrict training pairs to genuine sleep (where `0x5d` is dense and real).
- **`MET_ACTIVE_THRESHOLD = 1.8`** (`lib/health/daily-medians.ts`) — the app's one MET-active-period
  threshold, already used to exclude active windows from nightly HRV/RHR medians. Reused here as the
  evaluation-time gate (below), not re-derived.
- **Everything downstream of `dhrv` stays exactly as-is**: `daytimeStressLevel()` (Oura's
  `stress_daytime_sensing_1_1_0`, a deterministic formula, not an oracle to replace),
  `daytimeStressScalingParams()`, `dailyBaselines`'s Gaussian-weighted baseline smoothing
  (`daily_short_term_baselines_1_1_0`), `buildDaytimeStressSeries`'s bucketing, `summarizeStressDay`. These
  consume whatever `dhrv`-shaped value they're given — D5's scope is replacing **only** the imputation
  step, per the master plan's own framing ("(1) validate density, else build our own imputation; (2) wire
  it into the resilience/stress path" — not "rebuild the whole stress pipeline").
- **D6 comparison harness** (`lib/oura-comparison-harness.ts`, `lib/oura-comparison-harness-adapters.ts`,
  `app/api/oura-ble/comparison-harness/route.ts`, `components/oura-ble/comparison-harness-console.tsx`) —
  reference-pluggable by design; this plan registers a second adapter, doesn't touch the core.

## Design decision (confirmed with owner before starting)

**A per-user linear regression**, not a from-scratch neural net and not a population-level fixed formula:

- Fit `ln(rmssd) = a + b·hr + c·temp` by ordinary least squares (closed-form, 3×3 normal-equations solve —
  no external numerics dependency) from this user's own **night-time** 5-minute-binned
  `(hr, temp) → rmssd` tuples, where `hr`/`temp` are real (dense, real HRV at night) and MET is
  near-constant, so it's a poorly-conditioned regression feature (little night-time variance to learn from)
  — see "explicitly out of scope" below for why MET is excluded from the fit itself.
- **MET is an evaluation-time gate, not a fit feature.** The model was trained on resting/sleep
  HR↔HRV behaviour and would badly mis-extrapolate to exercise-elevated HR (the relationship is
  qualitatively different during activity, and the regression never saw that regime). At evaluation time,
  a bucket whose MET is above `MET_ACTIVE_THRESHOLD` scores `null` — same "return null rather than a wrong
  number" contract `computeDaytimeStress` already has today for insufficient data.
- **No live-path cost.** `body-battery`'s route calls `buildDaytimeStressSeries` synchronously per request
  — fitting a regression from 60 days of raw samples on every page load would be a severe latency
  regression. The fit is **precomputed and persisted**, refit **throttled** (not on every call) from the
  server-side raw-sample aggregation pass (mirrors `lib/oura/sync-throttle.ts` /
  `lib/data/postgres/retention-throttle.ts`'s shape — this app has no cron layer, so throttled-from-an-
  existing-write-path is the standing pattern). Evaluation at request time is then just loading the
  persisted 3 coefficients + a closed-form formula — cheaper than the ONNX call it replaces.

## Scope for this PR

### 1. Persistence — migration 145, `oura_daytime_hrv_model` table [S]

```sql
CREATE TABLE IF NOT EXISTS oura_daytime_hrv_model (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  intercept     DOUBLE PRECISION NOT NULL,
  hr_coef       DOUBLE PRECISION NOT NULL,
  temp_coef     DOUBLE PRECISION NOT NULL,
  residual_std  DOUBLE PRECISION NOT NULL,  -- sqrt(mean squared residual) of ln(rmssd), fit-quality signal
  n_samples     INTEGER NOT NULL,
  fitted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

One row per user, upserted on refit. `getDaytimeHrvModel`/`upsertDaytimeHrvModel` repo methods
(read/write, following the existing `oura_tokens`/`oura_daily`-style one-row-per-user pattern).

### 2. Pure regression module — `lib/health/daytime-hrv-model.ts` [S]

- `extractNightlyTrainingSamples(rows: OuraRawSampleRow[], sleepWindows: {sleepStart: Date; sleepEnd: Date}[]): {hr: number; temp: number; rmssd: number}[]`
  — bins decoded `0x80/0x60` (HR), `0x46/0x69` (temp), `0x5d` (HRV) rows to 5-minute buckets (reusing the
  existing HR band-filter [35,150] and the existing pairwise `0x5d`/`hr_bpm` accuracy-proxy gate — same
  guards `aggregateOuraRawSamples` already applies, ported not re-derived), keeps only buckets whose
  midpoint falls inside a sleep window, and only buckets with both a valid HR and a valid rMSSD. Pure,
  no I/O — the caller passes in rows already fetched via `getOuraRawSamplesForTags`.
- `fitDaytimeHrvModel(samples): { intercept, hrCoef, tempCoef, residualStd, nSamples } | null` — closed-form
  OLS via 3×3 normal equations (`(XᵀX)β = Xᵀy` solved by Cramer's rule or Gaussian elimination — 3×3 is
  small enough not to need a matrix library). Returns `null` below a minimum sample floor (mirrors
  `MIN_OBS = 5` nights' worth of buckets in `daily-baselines.ts` — a floor in **bucket count**, not
  night count, since bucket count is what actually determines regression stability).
- `evaluateDaytimeHrvModel(model, hr, temp, met): number | null` — returns `null` when
  `met > MET_ACTIVE_THRESHOLD`, else `exp(intercept + hrCoef·hr + tempCoef·temp)`.
- Unit tests: fit recovers known synthetic coefficients from noise-free synthetic data; fit returns `null`
  below the sample floor; evaluate gates correctly on MET; extraction correctly excludes daytime rows /
  keeps only sleep-window rows / applies the HR band filter and the existing `0x5d`↔`hr_bpm` accuracy gate.

### 3. Wire into `daytime-stress.ts` [S]

`computeDaytimeStress` gets a new signature (or a sibling `computeDaytimeStressFromModel`) that takes the
persisted `DaytimeHrvModel` instead of calling `runDhrvImputation`. Same infallible-null contract: no model
yet (cold start, <floor samples) → `null`, same as an ONNX failure today — callers (`buildDaytimeStressSeries`,
`body-battery`) already handle that path (no stress contribution shown). `lib/oura-models/inference/dhrv.ts`
and the ONNX model file are **not deleted yet** — D7 (oracle deprecation, ~T+3mo) removes them once parity
is proven; D5 only stops calling them from the production path. Kept alive only inside the D6 comparison
harness's existing dHRV-vs-something plumbing if useful for a side-by-side sanity check — not required for
this PR's gate.

### 4. Refit trigger — throttled, from the raw-aggregation pass [S]

A `maybeRefitDaytimeHrvModel(userId)` call at the end of `aggregateOuraRawSamples`, gated by
`shouldPrune(lastFittedMs, nowMs, 24h)` (reuse `retention-throttle.ts`'s `shouldPrune` — same shape as
every other throttled maintenance task in this pipeline). Wrapped in try/catch, isolated the same way the
function's existing per-step errors are (`stepErrors` on `OuraRawAggregateResult`) — a refit failure must
never break the sleep/body-metrics/HR-series steps it runs alongside. Pulls `getOuraRawSamplesForTags(userId,
[0x80,0x60,0x46,0x69,0x5d], 60)` (60-day lookback) + `listSleepSessions` for the same window, extracts,
fits, upserts.

### 5. D6 harness adapter — `dhrvVsH10Adapter` [S]

Second registration in `lib/oura-comparison-harness-adapters.ts`: `ours()` evaluates the persisted model
against the window's own temp/HR/MET (5-min buckets, MET-gated exactly as production does);
`reference()` reads `rr_intervals` (`source='chest_strap'`) in the window (new repo method
`getRrIntervalsBySource`, mirrors `getOuraHeartrateBySource`), buckets to 5-min groups, and runs
`rmssdFromRr` per bucket (reused, not re-implemented — this is the "Own analysis" module's canonical RR→rMSSD
path). Tolerance band: start at **±10 ms** RMSSD (looser than the ±5bpm HR band — RMSSD is inherently
noisier bucket-to-bucket than a mean HR, and this is a first tripwire, not a validated threshold, exactly
per D6's own precedent). Wired into the existing comparison-harness route via a `?metric=hr|hrv` param
(defaults to `hr` for backwards compatibility) rather than a second route — the harness core is already
adapter-agnostic, this is just a second registration. New admin console
`components/oura-ble/dhrv-comparison-console.tsx`, wired into `/admin/oura-ble` next to the HR one,
following the exact same pattern (window picker, per-bucket ours/reference/Δ table, out-of-band flags).

### 6. Tests

- Pure-function unit tests for the regression module (§2 above).
- `evaluateDaytimeHrvModel` MET-gating and the swapped `computeDaytimeStress` path.
- `dhrvVsH10Adapter`'s bucketing (mirrors the existing `bucketHrToMinuteMeans` tests but at 5-min grain and
  running `rmssdFromRr` per bucket).
- DB-backed test for the new repo methods (`getDaytimeHrvModel`/`upsertDaytimeHrvModel`,
  `getRrIntervalsBySource`) against local Postgres.

### Gate

- Sandbox: full unit-test coverage above; `tsc`/`eslint`/`check-push-mutations`/`check-reconcile` clean;
  `pnpm build` clean.
- **Device-verified**: the owner runs the same H10 spot-check burst D6 asked for (wear both ring + strap),
  this time on the new `dhrv-comparison-console`, and confirms the two sources are in the same ballpark.
  Flag as NOT-verified in `projectOverview.md` Known Issues until that happens — same posture as D6.
  Additionally: the FIRST refit needs ≥ a few days of real overnight ring wear post-merge before the model
  has enough training buckets to produce anything (cold start returns `null`, same as today) — this is a
  genuine data-accumulation gate, not just a device-testing one.
- No live-path regression: `body-battery`'s live per-request cost must stay O(1) coefficient lookup +
  closed-form eval, never a re-fit. Verify by confirming `maybeRefitDaytimeHrvModel` is only reachable from
  the aggregation pass, never from the body-battery route.

## Explicitly out of scope for this PR

- **MET as a regression feature** — evaluation-time gate only, per the design decision above. Revisit only
  if the H10 spot-check shows the HR/temp-only model is systematically wrong during borderline-active
  daytime windows (a real finding to make with real data, not a speculative upgrade now).
- **A trained-from-scratch neural net** — the master plan doesn't mandate matching Oura's architecture; a
  single-user app has no batch-training infra, and the linear model is honestly evaluable against the H10
  the same way a neural one would be.
- **Deleting `dhrv_imputation_1_1_0`/`onnxruntime` usage** — that's D7 (~T+3mo), after parity is proven, not
  this PR.
- **Backfilling historical `body_metrics`/`oura_daily_derived` daytime-stress rows** with the new model —
  only new computations use it; old persisted values aren't recomputed.
