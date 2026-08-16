# Illness Detection ONNX — upgrade the illness radar (P2)

**Goal:** replace the heuristic illness-radar (shipped v1.150.0, deviation-vs-baseline flag) with
Oura's actual `illness_detection_0_5_1` model, run server-side via onnxruntime-node.

Phase 0 (weights → ONNX) is **partly done**: the model's `.pt`, `constants.json`, and source are
vendored, but the ONNX export is **not yet built** — its core has a two-input conv+concat topology
(see §2) that needs a native rebuild, deferred from the first export batch.

## 1. Current state (cited)

- Illness radar today: heuristic deviation flag in the readiness indicator (v1.150.0), stored in
  `oura_daily_derived` (see `docs/module-map.md` §Oura). Data-vs-baseline, not a learned model.
- `illness_detection_0_5_1.pt` core (`_model_runner.trained_model`) topology (from introspection):
  two inputs `(x_scalar, x_time_series)`; time-series branch `Conv1d → BN → ReLU → Dropout → Conv1d
  → BN → ReLU → Dropout → flatten → Linear(200→20)`; concat with scalar branch → `Linear(48→400) →
  BN → ReLU → Dropout → Linear(400→320) → BN → ReLU → Dropout → Linear(320→1) → Sigmoid`. Output =
  illness probability. `48 = 20 (conv-branch) + 28 (scalars)`.
- Preprocessor/validator + means/stds: `lib/oura-models/onnx/constants/illness_detection_0_5_1.
  constants.json` `attributes`; source in the lite bundle `illness_detection__source/tagnet/`.

## 2. Design

- **Export:** rebuild the two-branch core as a native `nn.Module` (mirror the vendored `__torch__.py`
  forward), assert `native == scripted` (0.0), export to ONNX with two named inputs, assert
  onnxruntime parity (< 1e-3). Add to `scripts/oura-models/export-onnx.py`. Vendor the `.onnx`.
- **Inputs from BLE:** temp (`0x75/0x46`), HR/HRV (`0x5d`), respiratory-derived, SpO₂ (`0x6f`) — the
  28 scalars + time-series are daily aggregates we already compute for the radar; map them to the
  model's expected feature order (read the preprocessor source for exact columns — verify against a
  golden vector, do not guess order).
- **Runtime:** `lib/oura-models/inference/illness.ts` → probability; infallible → heuristic fallback.
- **Storage:** reuse the existing `oura_daily_derived` illness column; add the model probability
  alongside (or replace the heuristic value with a flag noting model-sourced).

## 3. Phased task list

1. Rebuild + export illness core to ONNX + verify (extend `export-onnx.py`); vendor `.onnx` +
   golden fixture.
2. Port the preprocessor/feature-assembly to TS, pinned to a golden `sample`.
3. `lib/oura-models/inference/illness.ts` runtime entry.
4. Wire into the illness-radar computation in the rollup; keep heuristic fallback.
5. Verify probability against the owner's known-well vs known-sick days; sanity-check bounds.
6. Journal + version bump.

## 4. Risks

- Feature-column ordering is the failure mode (silent wrong output) — pin to a golden vector.
- Model output is a probability; do not let it gate any automatic action on a self-reported number
  (AI/Security default) — surface it, band it deterministically.

## 5. Backlog entry

```
N. **Oura illness-detection ONNX — model-based illness radar** — plan
   `docs/superpowers/plans/2026-07-15-illness-detection-onnx.md`, branch
   `feat/illness-detection-onnx`, added 2026-07-15. Rebuild+export the two-branch core to ONNX
   (deferred from Phase-0 batch), TS feature-assembly, wire into the shipped illness radar. Depends
   on the SleepNet PR's onnxruntime-node runtime module.
```
