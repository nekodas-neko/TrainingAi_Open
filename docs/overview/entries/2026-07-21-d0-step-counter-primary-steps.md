## 2026-07-21 — D0: `step_counter` is the ring's daily-steps source (own-analysis) (v1.196.0)

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — first implementer PR of the Oura on-device + own-analysis
initiative (master plan D0). Retires the flat-30 col14 step estimate that over-counted (~16,800 vs
~10,500 real) and wires Oura's real `step_counter` model as the ring's daily-steps source.

### What shipped
- **Rollup step path (`lib/data/postgres/adapter.ts`, `aggregateOuraRawSamples`):** the `steps_estimate`
  step is now `steps`. Instead of `mergeStepSources` (flat-30 col14 credit) it runs `runStepCounterPipeline`
  (`lib/oura-ble/step-counter-pipeline.ts`: 0x7e/0x7f gait features + 0x47 motion → `steps_motion_decoder`
  → `step_counter`, golden-verified) **per local day**, buckets frames by day, and merges accurate
  live-counted accel windows on top via the new `mergeStepCounterWithLive`.
- **New `mergeStepCounterWithLive` (`lib/health/step-estimate.ts`):** step_counter's per-window output is
  the base; live-counted windows OVERRIDE the model for the ds/ms span they cover (Tier-2-wins, the same
  accuracy hierarchy the retired estimate had, generalised to the model's windowed output). `estimateSteps`/
  `isWalkingWindow` stay only as the realtime-accel walk gate + admin calibration cross-check — no longer
  the persisted daily total.
- **0x47 motion is now a rollup-consumed tag** (`STEP_MOTION_TAG` in `lib/oura-ble/rollup-consumed-tags.ts`,
  added to `ROLLUP_CONSUMED_TAGS`) — protects it from the Lever-2 drop set and back-fills via redecode.
- **Backfill lever unchanged:** the existing admin `POST /api/oura-ble/samples/redecode` (`fullHistory`)
  re-runs this same path over all archived `body_hex` — no re-walking/re-sync.

### Safety posture — deliberate, non-destructive
- The **max-merge guard (`> existingSteps`) is KEPT.** step_counter can only RAISE a day's steps (monotonic
  same-day accumulation; never lowers Health Connect / manual / a prior value). Consequence: it **cannot
  lower a historical flat-30 estimate already stored under `oura_ble`**. New days get the honest (lower)
  step_counter number immediately and safely. **Correcting the inflated *history* downward is a separate,
  destructive, OWNER-GATED backfill** deferred until step_counter's real-day totals are confirmed sane on
  the S25 (see below).

### Verification
- `pnpm exec tsc --noEmit` — 0 new errors (2 pre-existing `onnxruntime-web` module errors on `main`, not
  installed in the sandbox). `pnpm lint` — 0 errors. `pnpm test` — **1920 passed** (1 pre-existing suite
  fail, `wasm-parity.test.ts`, is the same missing `onnxruntime-web` package — green on CI).
- New/updated tests: 6 `mergeStepCounterWithLive` unit cases; the DB-backed rollup test
  (`oura-ble-step-rollup.test.ts`) rewritten to verify the step_counter wiring end-to-end against real
  local Postgres (self-consistent with the pipeline + merge, driven by live windows).
- `pnpm dev`: `/api/oura-ble/samples/redecode` compiles + serves (401 auth — the adapter import chain
  builds clean in the Next runtime).

### NOT verified on device (Known-Issues row added to projectOverview.md)
- **step_counter returns 0 on the sparse calibration fixtures** (3–7 isolated windows are far too little
  for the model to fire) and the pipeline's own header flags its on-device input-assembly (unpack27 column
  order, 0x47 motion mapping) as **unconfirmed**. **Real-day daily totals are only provable on the owner's
  S25** — the D0 device gate. Owner action: use the admin `step-counter-export` console on a worn day and
  compare the total to Garmin/Samsung; if sane, trigger the (destructive) historical redecode backfill.
  Until then the ring step number could read low/blank on a day with poor coverage (max-merge keeps it
  from destroying any stored value). This is the exact "sanity vs the old inflated number" gate the plan
  calls out.

### Next
- D1 (durability chain / six-form backup) — server infra runs parallel to D2; per the master plan graph.
