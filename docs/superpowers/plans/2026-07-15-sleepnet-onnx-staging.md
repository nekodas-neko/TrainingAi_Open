# SleepNet ONNX — REM-accurate sleep staging (P1)

**Goal:** replace the heuristic sleep stager with Oura's actual SleepNet CNN, run server-side via
onnxruntime-node, to reach REM parity (~23–28% vs the heuristic's ~8–17%).

Phase 0 (export + verify + vendor) is **done** — see the master plan and
`lib/oura-models/onnx/README.md`. This plan covers the **integration**.

## 1. Current state (cited)

- `lib/health/sleep-staging.ts` `stageSleepDetailed(epochs: SleepEpoch[])` → `SleepStagingResult`
  (`stages: ('deep'|'light'|'rem'|'awake')[]`), called from `aggregateOuraRawSamples()`
  (`lib/data/postgres/adapter.ts` ~L3845) when no ring phase events exist. Output feeds
  `summarizeSleepStages()` → `sleep_sessions` (`sleep_phase_5_min` string `1=deep 2=light 3=rem
  4=awake`; `deep/light/rem/awake_hours`). No schema change needed.
- Vendored, verified: `sleepnet_moonstone_1_2_0_core.onnx` (staging + apnea heads), plus
  `bdi_0_3_0/0_4_0` IBI-only fallbacks. Golden fixtures + constants in `lib/oura-models/onnx/`.

## 2. Model I/O (see README for full contract)

- **ONNX inputs:** `high_res (1,115200,3)` = `[ibi_ms, amplitude, spo2]` @ 2.1333 Hz; `low_res
  (1,1800,1)` = motion per 30-s epoch. **Outputs:** `staging_logits (1,4,1800)` → argmax = stage;
  `apnea_logits (1,1,1800)` → sigmoid > 0.61.
- **Preprocessor** (`scripts/oura-models/_source/sleepnet/inference/preprocessing.py`): builds the
  bedtime time grids, interpolates irregular BLE samples with gap-aware NaN fill (`thr_gap` 5 s
  high-res / 60 s low-res), motion zero-fill within 15 s, then `Normalize/Fillna/CropPad/
  NormalizeScalars` (means/stds in the model's `constants.json` `attributes`). `input_indexed_on
  ="end"` → subtract 30 s from ACM/temp timestamps.
- **Postprocessor** (`postprocessing.py`): maps logits → per-epoch stages indexed on epoch end,
  `n_epochs=1800`.

## 3. Design

- **moonstone is primary; bdi is fallback.** Use moonstone when a night has motion+temp+spo2; fall
  back to bdi (IBI-only) when only IBI is present; fall back to the heuristic if inference fails.
- **Server-side only.** onnxruntime-node in the rollup — the device WebView never runs it. Fits the
  Canonical-Runtime "device wins, but server-computed aggregates are fine" model (staging is already
  a server-computed rollup output, not a local-first write).
- **Infallible.** Inference wrapped so any error → `null` → heuristic path. Never throw in the rollup.

## 4. Phased task list

1. **Runtime module** (shared, carried here): add `onnxruntime-node` (`pnpm`); create
   `lib/oura-models/inference/session.ts` (lazy cached `InferenceSession` by model file) and
   `lib/oura-models/inference/sleepnet.ts` (`runSleepNet(preprocessed) → {stages, apnea} | null`).
2. **Preprocessor port** `lib/health/sleepnet-preprocess.ts` — port `preprocessing.py` to TS
   (interpolation + normalize). Validate against a golden `sample` tensor captured from the `.pt`
   preprocessor (add a capture mode to `export-onnx.py`, save `__fixtures__/moonstone_sample.npz`).
   Unit-test the TS output against it (< 1e-4).
3. **Assemble inputs from BLE** — in the rollup, build `high_res`/`low_res` from the already-decoded
   `0x80/0x60/0x5d` (IBI), `0x72` (motion), `0x75/0x46` (temp), `0x6f/0x8b` (spo2), `0x76` (bedtime).
4. **Wire the boundary** — at `aggregateOuraRawSamples` ~L3845, try `runSleepNet` → map
   `staging_logits` argmax to `SleepStage[]` → existing `summarizeSleepStages`. Heuristic on null.
5. **Backfill** — run redecode over stored nights; confirm history restages.
6. **Verify** — REM% vs Cloud baseline on the owner's nights; target ~23–28%. Device smoke or
   Known-Issues row.
7. **Journal + version bump** in the same PR.

## 5. Testing & verification

- Preprocessor TS port pinned to golden `sample` (< 1e-4).
- End-to-end: `runSleepNet` on a real stored night → sane hypnogram, REM% in band.
- onnxruntime-node loads + infers **in the Railway deploy**, not just local `pnpm dev`.
- Not device-verified until the smoke run — carry a Known-Issues row.

## 6. Risks

- Preprocessor fidelity (the hard part) — mitigated by the golden-`sample` pin.
- Scalar inputs: the CNN core has `scalars_ch=0`, so age/sex aren't needed for staging — do not
  block on them.
- onnxruntime-node native-addon availability on Railway — verify early (task 1).

## 7. Backlog entry

```
N. **Oura SleepNet ONNX — REM-accurate staging (integration)** — plan
   `docs/superpowers/plans/2026-07-15-sleepnet-onnx-staging.md`, branch
   `feat/sleepnet-onnx-staging`, added 2026-07-15. Phase 0 (ONNX export + verify + vendor) shipped
   in the neural-models master PR; this item is the onnxruntime-node runtime + TS preprocessor port +
   rollup wiring + on-device REM% verification. Highest-value model (only path to REM parity).
```
