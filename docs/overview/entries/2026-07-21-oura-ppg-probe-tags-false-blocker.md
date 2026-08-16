# 2026-07-21 — Oura PPG/bioZ census probe tags + false-blocker correction

**Branch:** `fix/oura-ppg-probe-tags` · Docs + admin-probe only (no version bump)

Acts on an audit (owner handoff) finding that five models parked in `oura-models-inventory.md` as
"raw PPG (`0x81`) / bioimpedance — unreachable over BLE / we don't capture" were parked on an
**unmeasured assumption**. Verified all three load-bearing claims against the code before editing:

- We **do** decode + store `0x81` (cva_raw_ppg), `0x87` (atlas_metadata), `0x88` (atlas_raw_bioz) —
  `lib/oura-ble/decode.ts`; none are in `RAW_STORAGE_DROP_TAGS`, so they're kept archival.
- The `getDaytimeTagCoverage` census probe's `TAG_LABELS` omitted all three, so "unreachable" was
  literally never measured.
- The `oura-native-ble` skill's own field note records `open_oura` enabling `CVA_PPG` → SUCCESS,
  contradicting the same skill's "cannot enable over the wire" summary — and `REAL_STEPS` carried the
  identical "server-gated/unreachable" label before it was enabled and now streams at ~80%.

## What landed

- **Probe fix (code):** added `0x81`/`0x87`/`0x88` (`PPG`/`BioZ meta`/`BioZ raw`) to
  `getDaytimeTagCoverage`'s `TAG_LABELS` (`lib/data/postgres/adapter.ts`) so an on-device census can
  actually see whether they stream.
- **Inventory correction:** the cva/halite/atlas row is re-classified from "parked-forever" to
  **NEEDS-ON-DEVICE-CENSUS**, with the honest secondary deps kept (PPG power-gating unproven; cva
  needs calibrator; halite needs baselines + `ppg_score_history`; atlas `0x87`/`0x88` decoders are
  `unvalidated` + need `calibration_coeffs`). `whr_2_7_1`'s block reason corrected: raw full-rate
  accel, **not** PPG. `sleepstaging_2_6_0` "needs `oura_ops`" corrected: only the classifier op is
  opaque; its IBI feature extractor is already ported (`lib/health/hrv-5min.ts`).
- **Skill correction:** the `oura-native-ble` CVA_PPG "can't enable over the wire" lines now note the
  contradicting field-note evidence and the reachable-to-request / streaming-needs-census distinction.

## Owner actions (from the handoff, cannot be done in-sandbox)

- **Run the census:** `SetFeatureMode(CVA_PPG=0x0d)` → get-history drain → `oura_raw_samples GROUP BY
  tag`. If `0x81`/`0x87`/`0x88` arrive, cva/atlas move to "buildable pending secondary deps."
- **⚠️ Rotate the storage key** — an `AWS_SECRET_ACCESS_KEY` was pasted into a prior chat; rotate it
  in the AWS console even though the upload is done and nothing depends on it.
- PR #615 (docs-only, golden-captured marker) — merge or close. Backup branch
  `docs/preserve-pt-originals-and-goldens` (52 MB `.pt`) is redundant with the verified bucket — safe
  to delete (destructive; owner confirm).

## Verification

- tsc + lint clean. The probe change is an additive map entry (admin-only route); the rest is docs.
  The census itself is on-device — this PR only unblocks the measurement.
