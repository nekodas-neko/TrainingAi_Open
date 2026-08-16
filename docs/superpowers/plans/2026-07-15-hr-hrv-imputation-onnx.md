# HR / HRV Imputation ONNX — dhrv + awhr (P3)

> **2026-07-16 — BUILDING (owner approved: "stress affects Body Battery drain").** Source + the exact
> 10-feature layout are vendored (`scripts/oura-models/_source/dhrv/`). `dhrv` imputes daytime HRV →
> `stress = dhrv − baseline`; owner wants that stress feeding Body Battery drain.
>
> **Stage 1 — DONE (#569):** `lib/health/daytime-stress.ts` — Preprocessor port + scaling + the
> golden-verified ONNX MLP → `computeDaytimeStress(temp, met, hr, baselines)`. Golden-tested against
> the `.pt` forward on 4 inputs. Infallible.
>
> **Stage 2 — daytime stress SERIES (precompute in the aggregate, NOT inline in the battery route).**
> Body Battery is a hot per-load endpoint; running dozens of ONNX inferences there is perf-wrong.
> Instead, `aggregateOuraRawSamples` (runs on sync) computes stress per ~15–30-min bucket across each
> day and stores the series (new column/table). Baselines: `hr_baseline` = resting HR; `dhrv_baseline`
> = recent overnight-HRV mean (proxy at cold start); `temp_baseline` = recent skin-temp mean.
> Inputs: daytime `temps_c` (0x46/0x69), `met` (0x50), HR — **feasibility-gated on the ring actually
> capturing these in the daytime** (it power-gates worn-idle; confirm with a device probe first).
>
> **Stage 3 — Body Battery drain:** the walk loop in `app/api/body-battery/route.ts` reads the stored
> stress series and, per HR sample, applies an extra drain (or reduced charge) scaled by how far below
> baseline stress is — so stress depletes the tank even at rest.
>
> **Stage 4 — surface** the daytime-stress signal alongside Body Battery.

**Goal:** run Oura's imputation nets to fill HRV/HR gaps and feed daytime-stress, server-side.

Phase 0 status: **dhrv done** (`dhrv_imputation_1_1_0.onnx`, ORT parity 0.0 — 4-layer MLP
`10→32→64→32→1`). **awhr not yet exported** — it has an LSTM core (see §2) needing a native rebuild.

## 1. Current state (cited)

- Daytime stress uses `stress_daytime_sensing_1_1_0` (rule-based, already vendored):
  `intensity = dhrv − dhrv_baseline`. Today `dhrv` (daytime HRV) is sparse — the `dhrv_imputation`
  net imputes it from a 10-feature daily vector.
- `awhr_imputation_1_2_0` core (`impute_net`): `LSTM → fc1 → ReLU → fc2 → ReLU → fc3 → ReLU → fc4`.
  From the npz: bidirectional 2-layer LSTM (weight_ih/hh l0/l1 + reverse). Imputes awake HR gaps.

## 2. Design

- **dhrv** (done exporting): runtime `lib/oura-models/inference/dhrv.ts` → imputed daytime HRV;
  feed into the existing daytime-stress computation (`intensity = dhrv − baseline`). Feature order
  from `dhrv_imputation__source`; pin to golden vector. Storage: `body_metrics.hrv_ms` (imputed
  flag) or a derived column — decide at build (do not clobber a measured HRV with an imputed one;
  flip `sync_status`/precedence appropriately).
- **awhr**: export the LSTM core (onnxruntime supports LSTM). Rebuild native `nn.LSTM(bidirectional,
  2 layers)` + 4 Linears, assert parity, add to `export-onnx.py`, vendor. Then runtime + wiring for
  awake-HR imputation. Lower value than dhrv — sequence after it.

## 3. Phased task list

1. dhrv runtime + TS feature-assembly (pinned) + wire into daytime-stress; non-clobber storage.
2. Verify imputed dhrv vs measured on days with both.
3. awhr: rebuild+export LSTM core to ONNX + verify; vendor.
4. awhr runtime + wiring.
5. Journal + version bump.

## 4. Risks

- Imputed values overwriting measured ones — non-clobber + flag.
- LSTM ONNX export: confirm onnxruntime runs the bidirectional LSTM (opset ≥ 14); pin to golden.

## 5. Backlog entry

```
N. **Oura HR/HRV imputation ONNX — dhrv + awhr** — plan
   `docs/superpowers/plans/2026-07-15-hr-hrv-imputation-onnx.md`, branch
   `feat/hr-hrv-imputation-onnx`, added 2026-07-15. dhrv ONNX shipped in Phase 0; awhr LSTM export
   still to build. TS wiring for both + daytime-stress feed. Depends on the SleepNet PR's runtime.
```
