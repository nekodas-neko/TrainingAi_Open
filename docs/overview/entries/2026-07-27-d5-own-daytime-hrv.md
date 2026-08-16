# 2026-07-27 — D5: own daytime-HRV

Branch: `feat/d5-own-daytime-hrv` · v1.218.0

## Why

Master plan sequencing is **D6 → D5 → D2**, not straight to D2. D6 (the Polar H10 comparison
harness) shipped earlier the same day; D5 replaces Oura's `dhrv_imputation` ONNX model — the one
*wired* Oura oracle in the app — with our own daytime-HRV estimate, built with zero knowledge of
dHRV's actual output (observe-never-feed). D5 must land before D2's neural WASM port so dHRV is
never ported to WASM only to be deleted right after; after D5, D2's neural half is scoped to
SleepNet + step_counter only, for real, not just in the plan.

Plan doc (written and executed in the same session, per owner directive):
[`docs/superpowers/plans/2026-07-27-d5-own-daytime-hrv.md`](../../superpowers/plans/2026-07-27-d5-own-daytime-hrv.md).

## Design decision

A **per-user linear regression** (`ln(rmssd) = a + b·hr + c·temp`, closed-form OLS, no external
numerics library), not a from-scratch neural net and not a fixed population formula — confirmed
with the owner before starting. Fit from this user's own **night-time** `0x5d` HRV events: the ring
only streams real daytime HRV ~7% of waking hours (verified on-device 2026-07-16 —
`docs/superpowers/plans/2026-07-16-remaining-oura-models-build-plan.md` §0), so direct measurement
isn't viable, but night-time `0x5d` is dense and real, and each event already carries its own
paired `hr_bpm` (no separate HR-tag join needed). **MET is deliberately NOT a fit feature** — night
has almost no MET variance to learn from, so a MET coefficient would be poorly conditioned and
would badly mis-extrapolate to exercise-elevated HR, a regime the fit never saw. Instead MET gates
evaluation: a 30-min bucket above `MET_ACTIVE_THRESHOLD` (the app's one existing active-period
threshold) scores `null`, same "return nothing rather than a wrong number" contract the ONNX path
already had.

## What shipped

- **`lib/health/daytime-hrv-model.ts`** — `extractNightlyTrainingSamples` (sleep-window-restricted
  `(hr, temp) → rmssd` tuples from decoded raw rows), `fitDaytimeHrvModel` (closed-form 3×3 normal
  equations, `MIN_TRAINING_SAMPLES` floor), `evaluateDaytimeHrvModel` (MET-gated point eval),
  `daytimeHrvEstimatesPerBucket` (shared bucket-iteration, reused by both the production stress
  series and the D6 harness adapter — refactored out to avoid duplicating the gating logic twice).
- **Migration 146** — `oura_daytime_hrv_model` (one row per user: intercept, hr/temp coefficients,
  residual std, sample count, fitted-at). Migration 147 regenerates the `claude_ro` read-only view
  schema to cover the new table (default-deny — a table with no view is unreadable by that role).
- **`lib/health/daytime-stress.ts`** — new `buildDaytimeStressSeriesFromModel`, a sibling of the
  existing `buildDaytimeStressSeries` (ONNX). The ONNX function and its golden-pinned tests stay
  completely untouched — they're just no longer called from production. Extracted a shared
  `scoreStressPoints` tail (day-median baseline + Oura's real stress-level rule, identical either
  way) so the two per-bucket loops only differ in how `dhrv` itself is derived.
- **Wiring**: `lib/data/postgres/adapter.ts`'s resilience rollup and
  `app/api/body-battery/route.ts` (the live per-request path) both now load the persisted model and
  call the new sibling function. No ONNX fallback on cold start — same empty-series contract as
  before.
- **Throttled refit**: `adapter.ts`'s new `maybeRefitDaytimeHrvModel`, gated on the persisted
  `fittedAt` timestamp (not an in-memory timer — correctly per-user, survives restarts), run as its
  own isolated step inside `aggregateOuraRawSamples` (never on `body-battery`'s live path — a
  60-day raw-sample query + fit there would be a severe latency regression).
- **D6 harness**: `dhrvVsH10Adapter` in `lib/oura-comparison-harness-adapters.ts` — our own model's
  estimate vs the Polar H10's RR-derived rMSSD (`rmssdFromRr`, the app's one RR→rMSSD
  implementation), 5-min buckets, ±10ms first-tripwire tolerance. Wired into the existing
  `GET /api/oura-ble/comparison-harness` via `?metric=hrv` (defaults to `hr` for back-compat) and a
  new `components/oura-ble/dhrv-comparison-console.tsx`, following the same pattern as D6's HR
  console rather than overloading it with a metric picker.

## A real bug found and fixed during implementation

The first cut of `daytimeHrvEstimatesPerBucket` gridded buckets from `fromMs` (the requested
window's start), not an absolute epoch grid. For the production stress series that's harmless
(nothing merges bucket keys across separate calls), but the D6 harness *does* — it merges two
independently-bucketed series by `bucketStart` string. Two adapter calls with slightly different
`fromMs` (or a window not aligned to a 5-min boundary) would land on different grids and silently
never match, making every bucket read as "missing one side" instead of comparing. Fixed by grid-
aligning to `floor(fromMs/bucketMs)*bucketMs`; caught by a regression test asserting the two
adapters' bucketing lands on the same key for a deliberately misaligned window (`:02:17`).

## Verification

- Full unit-test coverage: the regression module (fit recovers known synthetic coefficients
  noise-free, null below the sample floor, null for a singular/no-variance system, MET gating,
  extraction's sleep-window/HR-band/accuracy-gate filters), the new stress-series sibling (resting
  vs active-bucket behaviour, missing-signal skip), the new harness adapter + the grid-alignment
  regression test above.
- DB-backed tests: `oura_daytime_hrv_model` persistence (upsert-replaces, not duplicates).
- `tsc --noEmit`, `eslint` (0 errors, pre-existing warnings only), `check-push-mutations` /
  `check-reconcile` clean, full suite **2331/2331 passing**, `pnpm build` clean.
- **Sandbox end-to-end against local Postgres via `pnpm dev`**: seeded a synthetic fitted model,
  ring HR, raw temp/MET samples (with a real ring-clock-anchor row — `getOuraDaytimeSignals` is
  entirely ds-based, not `measured_at`-based, which the first seed attempt missed), and H10 RR
  intervals. Confirmed `GET /api/oura-ble/comparison-harness?metric=hrv` returns real bucketed
  values on both sides with correct out-of-band flagging, and confirmed the live
  `GET /api/body-battery` route's `stress` field carries real non-null values computed through the
  new model — not just "doesn't 500". Confirmed the new admin console renders on `/admin/oura-ble`.
  Reverted all seeded rows afterward.

## What was NOT exercised

- **The actual H10 spot-check validation gate.** This is admin-only tooling exercised with
  synthetic data; the real point of D5 (per the plan) is the owner wearing both the ring and the H10
  together and confirming the two daytime-HRV sources roughly agree. That can't happen yet — see
  the cold-start gate below.
- **Cold start.** The model only exists after `maybeRefitDaytimeHrvModel`'s first successful run,
  which needs `MIN_TRAINING_SAMPLES` (50) real night-time `0x5d` buckets — a few days of real
  overnight ring wear post-merge, not something the sandbox can fast-forward. Until then,
  daytime-stress contributes nothing to Body Battery, identical to today's behaviour.
- **The throttled refit step itself, live.** Verified the persistence/read/eval wiring end-to-end
  with a hand-seeded model; did not trigger `aggregateOuraRawSamples`'s full pipeline live (out of
  scope for a sandbox with no real ring data flowing through it — the refit logic's own pure pieces
  are fully unit-tested).

Both flagged as a Known Issues row in `projectOverview.md`.

## Next

D2 (native `oura_raw.db` + on-device rollup) is next per the master plan's D6 → D5 → D2 ordering —
the highest-risk phase in the whole initiative (native + WASM + CSP + an owner APK rebuild). Needs
its own implementation plan written first, same protocol as D6/D5.
