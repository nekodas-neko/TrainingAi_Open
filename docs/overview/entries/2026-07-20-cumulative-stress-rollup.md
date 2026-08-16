# 2026-07-20 — Cumulative-stress rollup wiring (Chunk 1)

**Branch:** `feat/cumulative-stress-rollup` · **No version bump** (server-only, no user-visible change)

Wires the golden-verified `cumulative_stress_1_2_2` (ChronicStress) model into the BLE rollup. The
2026-07-18 plan had deferred this as blocked on two "missing" model inputs; the owner resolved that
block by pointing out both series are plain math on the raw per-beat IBI + validity flag we already
decode (tag 0x80), with the exact algorithm preserved in
`docs/oura-models/readable/sleepstaging_2_6_0__source/hrv_raw_to_low_level_features.py`.

## What landed

1. **`lib/health/hrv-5min.ts`** — `computeHrv5MinSeries(events)` → `{hrvMedianHR5min, hrvQuality5min}`.
   Ported the two consumed features from the `sleepstaging_2_6_0` source: `filter_ibi`'s 3-tap validity
   erosion, then per-5-min-window `median(60000/ibi)` and `valid/total × 100`. Uses non-overlapping
   5-min buckets rather than the source's 30-s-hop sliding windows — the model reduces each series to
   its `nanmean`, so the estimator is equivalent in expectation (documented). **GAP 2 resolved.**
2. **`computeNightIntermediates`** exported from `lib/oura-models/cumulative-stress.ts` — a thin
   `preprocess`-only wrapper so the five 30-day history series (each = a prior night's preprocessor
   "latest" output) are recomputed in memory (plan §3B), no stored intermediate that could drift. A
   re-export of already-golden math; the golden test is unchanged and still passes.
3. **`lib/health/chronic-stress-assembly.ts`** — `computeChronicStress(summaryRows, signalsByDate)`
   assembles all 27 model inputs for the latest night from `DailySummaryRow` windows + per-night raw
   signals, with every input→source mapping pinned per plan §1. `chronicStressScoreToInt` rounds to
   the INTEGER column, NaN → null.
4. **`aggregateOuraRawSamples`** (`adapter.ts`) — stashes `ChronicStressNightSignals` per night in the
   existing loop (30-sec hypnogram up-sampled 10× from the 5-min stager — **GAP 1** fallback (b);
   per-5-min HRV; skin-temp samples+timestamps; bedtime), then a new isolated `chronic_stress` step
   (mirrors `resilience`): COALESCE-upsert of `chronic_stress_score/contributors` only, latest-night,
   skips the write on a null score so a sparse pass never clobbers a prior good value.

## Verification

- `computeHrv5MinSeries` unit test (6 cases) + `computeChronicStress` assembly test (4 cases,
  incl. a **synthetic 31-night full-data → non-null score in [0,100] + 5 finite UI contributors**,
  which is the only in-sandbox proof the wiring produces a value). Golden model test green (3/3).
- tsc + lint clean (0 errors). All 34 Postgres DB-integration test files pass as a group (102/102).
- **NOT verified (stated in the Known-Issues row):** a real non-null score (needs ≥21 nights of real
  ring data — owner/device only), and whether the value is sane vs Oura's own ChronicStress. Two
  documented approximations pending owner calibration: `TEMP_DEV_FEVER_LIMIT_C` (1.0°C, biased against
  over-masking) and the 10×-up-sampled 30-sec hypnogram (coarser SFI transitions).

## Remains

Chunk 2 (Health ChronicStress card + learning state + contributor breakdown) is deferred until the
owner confirms a plausible on-device value — nothing renders until the 21-night gate is met.
