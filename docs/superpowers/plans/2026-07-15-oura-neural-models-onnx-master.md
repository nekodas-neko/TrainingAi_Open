# Oura Neural Models → ONNX — Program Master

**Status (2026-07-15):** Phase 0 (export + verify + vendor) **DONE and pushed** for the build-now
set. Runtime integration is the remaining work, split per model below.

## 1. Goal & scope

Run Oura's reverse-engineered **on-device neural models** ourselves, server-side, over the raw
BLE samples we already ingest — the accuracy ceiling the heuristic ports can't reach. The learned
weights are the one irreplaceable input; everything else (architecture, preprocessing) we can
reconstruct. This program **exports each portable model to ONNX** (done, verified bit-exact) and
**wires each into the rollup** with a TypeScript preprocessor port (per-model sub-plans).

Not a refactor of existing ports. The rule-based ports (`lib/oura-models/constants/`) stay as-is.

## 2. Current state (cited)

- Sleep staging is a heuristic: `lib/health/sleep-staging.ts` `stageSleepDetailed()`, called from
  the rollup `lib/data/postgres/adapter.ts` `aggregateOuraRawSamples()` (~line 3845). REM plateaus
  at ~8–17% vs Cloud's ~23–28% — the reason this program exists.
- No ONNX/ML runtime is wired in yet (greenfield). `onnxruntime` is not a dependency.
- Raw BLE samples are archival in `oura_raw_samples.body_hex`; `redecodeOuraRawSamples()` +
  `aggregateOuraRawSamples()` re-derive everything from stored hex with no ring re-sync — so a new
  decoder/model **back-fills all history** for free. This is the mechanism every model reuses.

## 3. Phase 0 — DONE (this PR): export + verify + vendor

All build-now cores exported to ONNX and verified **bit-exact vs the original TorchScript**
(onnxruntime maxdiff < 6e-06). Vendored in `lib/oura-models/onnx/` with constants, golden
fixtures, preprocessor source, and the reusable tool `scripts/oura-models/export-onnx.py`. Full
technical spec (architectures, I/O contracts, BLE mapping): **`lib/oura-models/onnx/README.md`** —
the authoritative embedded-data reference; read it before any integration work.

Key method note (so it isn't rediscovered): torch 2.13's TorchScript→ONNX path throws an internal
param-count assert on these graphs. The working path is **rebuild the core as a native `nn.Module`**
from the extracted config + `state_dict`, assert `native == scripted` (maxdiff 0.0), then export
the native module. Two ONNX-export gotchas already solved in the tool: `unfold` needs static shapes
(batch=1) and is replaced by a precomputed-index gather; `Conv1d(padding='same')`+dilation isn't
runnable in onnxruntime → use explicit integer padding (`dilation·(k−1)/2`, identical for odd k).

## 4. Model catalog & disposition

> **Full 31-model inventory + disposition (2026-07-16):** see the extracted-model inventory (private archive — `scripts/private-paths.json`) — every extracted `.pt` triaged (used / exported / source-preserved / parked), with the orphaned-but-relevant build candidates (steps, training-stress, baselines, daytime-stress rule) and their vendored source.

| Model | Disposition | Sub-plan |
|---|---|---|
| `sleepnet_moonstone_1_2_0` | **BUILD P1** — REM-parity staging | `2026-07-15-sleepnet-onnx-staging.md` |
| `sleepnet_bdi_0_3_0/0_4_0` | IBI-only fallback (same plan) | ↑ |
| `illness_detection_0_5_1` | **BUILD P2** — upgrades shipped illness radar | `2026-07-15-illness-detection-onnx.md` |
| `energy_expenditure_1_0_0` | **BUILD P2** — active-energy | `2026-07-15-energy-expenditure-onnx.md` |
| `dhrv_imputation` + `awhr_imputation` | **BUILD P3** — imputation/daytime-stress | `2026-07-15-hr-hrv-imputation-onnx.md` |
| `automatic_activity_detection_3_x` | **INVESTIGATE** — auto activity/exercise | `2026-07-15-activity-detection-onnx-investigation.md` |
| `cva_1_3_0/2_1_0`, `halite`, `whr` | **PARKED** — raw-PPG-gated (unreachable over wire) | (this doc §6) |
| `popsicle_1_6_0/1_8_1` | **N/A** — menstrual-cycle (not relevant) | archive only |

## 5. Shared runtime infrastructure (built once, first sub-plan carries it)

1. **`onnxruntime-node` dependency** (server-side; not bundled into the WebView). Add via `pnpm`.
2. **`lib/oura-models/inference/` module** — lazy `InferenceSession` per model (load once, cache),
   one typed entry per model. **Infallible**: any failure → return `null` → caller falls back to
   the existing heuristic. Never throw, never drop a night (same rule as the BLE decoders).
3. **Preprocessor ports** — per model, in TS, ported from the vendored
   `scripts/oura-models/_source/**` and validated against a golden `sample` tensor captured from the
   `.pt` preprocessor. Deterministic math only.
4. **Rollup insertion** — swap at the one boundary in `aggregateOuraRawSamples`; redecode back-fills
   history from `body_hex`. No schema change for SleepNet/energy (existing columns).

## 6. Parked models (do not build)

`cva_*` (vascular age), `halite` (PulseNet), `whr` (wrist-HR) all consume **raw PPG waveform**
(`0x81`, `CAP_CVA_PPG_SAMPLER`), which is **server-flag-gated and cannot be enabled over the BLE
wire** — the `oura-native-ble` skill is explicit: "plan on IBI, not raw PPG". The weights export
fine (portable arch) but there is no input to feed them on our path. Disposition: the `.pt` are
archived by the owner; **do not** attempt a build until an on-device spike proves raw-PPG capture at
~50 Hz over 30 s (unproven; the ring power-gates PPG). This is a GO/NO-GO gate, not a task.

## 7. Testing & verification

- **Per model, offline:** `native == scripted` (maxdiff 0.0) and `onnxruntime == scripted` (< 1e-3),
  both asserted in `export-onnx.py`. Golden fixtures committed.
- **Per model, product gate:** run on the owner's stored nights via redecode and compare against the
  Cloud baseline (SleepNet: REM% into the ~23–28% band). Green `pnpm dev` is necessary, not
  sufficient.
- **Device:** any change to the offline-first sleep pipeline needs the on-device smoke run
  (`docs/device-smoke-checklist.md`) or a `projectOverview.md` Known-Issues row marking it
  NOT-device-verified. onnxruntime-node runs server-side in the Railway rollup — verify it loads and
  infers there, not just locally.

## 8. Risks

- **Preprocessor fidelity** is the real risk, not the CNN — the SleepNet preprocessor is complex
  (gap-aware interpolation, cardiac feature extraction). Mitigation: port from the vendored source,
  pin to a golden `sample` tensor.
- **Repo size**: ONNX weights add ~21 MB. Acceptable (runtime needs them server-side); do not move to
  git-lfs without confirming Railway's clone supports it.
- **onnxruntime-node on Railway**: native addon. **Confirmed working in the Node sandbox (2026-07-15):**
  `onnxruntime-node@1.27.0` installs, loads, and runs the moonstone ONNX with parity 5.25e-06 vs the
  TorchScript reference (staging) / 5.72e-06 (apnea) — the full chain TorchScript → ONNX →
  onnxruntime-node is verified. The bundled prebuilt binary works even with pnpm's build script
  deferred. **Still to confirm on the Railway deploy image** (frozen-lockfile install + `pnpm.
  onlyBuiltDependencies` may need `onnxruntime-node` approved) — the SleepNet integration PR adds the
  dependency together with the code that uses it and verifies the deploy loads it.

## 9. Backlog entry

See `docs/implementation-backlog.md` — this program supersedes the old item-4 SleepNet-extraction
blocker (`.pt.enc` + key delivery), now unblocked by the delivered weights + lite bundle.
