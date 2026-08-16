## 2026-07-22 — D0 fix: step_counter column-order bug (returned 0 on all walking) (v1.198.1)

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`. Bug fix for D0 (`step_counter` as ring steps, on `main`
since v1.196.0). Found by the owner's on-device step-sanity check.

### The bug (confirmed on-device)
The admin `step-counter-export` over a real walk showed the decoder was perfect — stride frequency **median
2.09 Hz, 753/1500 sub-rows in the 1.5–3 Hz walking band** — but **`step_counter total: 0` on every window**.
Same on the calibration fixtures.

### Root cause (investigated with runtime proof)
`steps_motion_decoder`'s 11 output columns are in a **different order** than `step_counter`'s stepmotion
`features` (verified by name against both vendored constants files). The pipeline fed the decoder output
straight through (identity), so the model read `stride_frequency` from the `first_non_locomotor_frequency`
slot (≈0 while walking) → `steps = stride_frequency × 10` computed on ~0, and the amplitude gate zeroed the
rest → **0 steps on every window**. The 0x47 motion mapping was investigated and is **correct** (no change).

**Why the golden test missed it:** `step_counter_1_3_0.golden.json`'s `in_1`/`in_3` are uniform-random noise
already in model order, and its expected output is **all zeros** — the parity test only confirms `0 == 0` on
synthetic noise; it never exercises the decoder→model column contract or a real walk.

### The fix
`lib/oura-ble/step-counter-pipeline.ts`: reorder the decoder's 11 columns into the model's stepmotion feature
order before `runStepCounter` — `STEPMOTION_MODEL_ORDER = [6,7,9,10,8,5,4,0,3,1,2]` (model col i ← decoder
col N). `SELECTED_STEPMOTION_COLUMNS` in `step-counter.ts` is a correctly-vendored model constant + the
golden fixture is already in model order — **not touched**. `strideFrequencyHz` keeps reading the pre-reorder
decoder output (col 4 = stride_frequency, always correct).

### Verification
- `pnpm exec tsc --noEmit` 0 new errors; lint 0 errors.
- Probe on a continuous real walk: total flips **0 → ~7360** (sane magnitude), stride median ~1.7 Hz.
- **Golden test still passes** (pipeline-only change). All 33 step tests pass.
- **New regression test** (`step-counter-pipeline.test.ts`): a continuous real walk must yield > 100 steps —
  the ONLY kind of test that catches a column-order regression, since the golden fixture is all-zero noise.
- The DB rollup test's stale "sparse fixtures → 0" assumptions updated (the model now fires on real walk
  frames) + made order-robust (reset before each merged-value assertion).

### ⚠ Still device-gated — accuracy (the D0 gate proper)
This fixes the **0-bug**, not accuracy. **Owner: re-run the admin `step-counter-export` on a counted walk
and confirm the new total ≈ your real count** before we adopt step_counter as primary + run the owner-gated
historical backfill. The fix is non-destructive (max-merge guard unchanged — can only raise steps), so it's
safe to ship now: worst case it produces a sane-but-unvalidated number instead of 0.
