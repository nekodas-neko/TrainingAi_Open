# Sub-plan B — Oura Model-Constants Ingestion (the shared enabler)

**Parent:** `2026-07-15-oura-models-program-master.md` · **Branch:** `feat/oura-model-constants-ingestion`
· **Phase:** 0 (must land before the rule-based ports in C/D/E/F). · **Type:** vendored data + a
typed loader. Docs/data-only — low risk.

Every rule-based port (steps decoder, OTS, daytime stress, baselines, cva_calibrator, daily_medians,
resilience, cumulative stress) and every NN option depends on numeric constants that were **pickled
inside the `.pt` binaries**. The user has provided them extracted: `oura_models_bundle_lite` →
`oura_model_constants/*.constants.json`, **all 31 models, SHA-256 pinned, zero extraction errors**
(`MANIFEST.json`). This sub-plan vendors them into the repo as the single source of truth so ports
never hardcode a magic number.

---

## 1. What the bundle contains (verified)
- One `*.constants.json` per model with `{source:{file,sha256,size_bytes}, params_and_buffers,
  attributes, errors:[]}`.
- **Rule-based models** (small: 0.5–30 KB) — scalar tuning constants in `attributes`, big lookup
  tables inline in the traced source the `oura-models` skill already captured. Examples verified:
  - `steps_motion_decoder`: full `decoder_base_settings` (per-column `{low,high,bits,encode_zero}`;
    `stride_frequency` = low 0.68, high 3.4, bits 9) + `decoder_transform_settings`.
  - `stress_daytime_sensing`: `target_level_limit 0.5`, `scaled_level_limit 0.4`, `ring_met_limit 1.8`.
  - `daily_medians`: MET gate 1.8 (+ the gating logic in source).
  - `sleepstaging`: HRV bands (mHz) VLF 3–40, LF 40–150, HF 150–400; full feature-column list.
- **Neural models** (large: 0.1–2.4 MB) — `params_and_buffers` hold the weight tensors (shape,
  dtype, values) for `step_counter` (8K), `dhrv_imputation` (4.6K), `energy_expenditure` (319K),
  `illness_detection` (156K), `cva_*`, `sleepnet_*`, `whr`, `aad_*`, etc.

## 2. Vendoring decision (size-tiered)
- **Tier 1 — commit to repo** (`lib/oura-models/constants/`): all **rule-based** model constants
  (small JSON) + the `MANIFEST.json`. These are load-bearing for the ports and tiny. Keep the
  original filenames + SHA in a header/index so provenance is traceable.
- **Tier 2 — large NN weights**: do **not** commit multi-MB weight JSON into the app repo by default.
  Options: (a) a separate `oura-model-assets` location / Git LFS, (b) fetched at build/deploy into a
  server-only path, (c) committed only if/when a specific NN port is scheduled (Phase 3). Decide per
  NN when its sub-plan is picked up; Phase 1–2 need **no** Tier-2 weights (all rule-based).
- Record the chosen location + SHA in an index file so a version bump is auditable.

## 3. Typed loader
`lib/oura-models/constants/index.ts`:
- A small typed accessor per rule-based model, e.g. `getStepsDecoderSettings()`,
  `getDaytimeStressConstants()`, `getOtsConstants()`, returning validated shapes (Zod or hand-typed).
- Loads the vendored JSON (server-side; these are Node-readable, not shipped to the client bundle
  unless a client port needs them — prefer server-side use in the rollup).
- Exposes the **model version + SHA** for the provenance stamping (`model_versions` on
  `oura_daily_derived`, master §4.6).
- **One-Constant-One-Source:** ports import from here; no duplicated literals. A CI custom-rule check
  (optional) can flag a hardcoded constant that duplicates a vendored one.

## 4. Provenance & versioning
- Each vendored file keeps its `source.sha256`. An index (`constants/MANIFEST.json` copy) lists model
  → sha → version. When Oura firmware/model changes (not expected — frozen firmware), a new bundle
  bumps versions; the loader surfaces the change and derived rows re-stamp `model_versions`.
- The bundle came from the user's decrypted extraction; note in the file header that these are
  pinned to that extraction and must not be regenerated from a re-onboarded ring (protocol-freeze
  rule).

## 5. Tasks
1. Add `lib/oura-models/constants/` with the Tier-1 rule-based JSONs + `MANIFEST.json` + a README
   noting provenance/SHA and the "don't regenerate from a re-onboarded ring" caveat.
2. `lib/oura-models/constants/index.ts` typed loaders + version accessors + tests (shape validation,
   SHA presence).
3. Decide + document the Tier-2 (NN weights) storage location (stub; actual weights land with their
   NN sub-plan).
4. Update the `oura-models` skill: replace every `[runtime tensor]` / `[archive constant]` flag with
   "resolved — see `lib/oura-models/constants/<model>.constants.json`".

## 6. Verification
- Unit: loader returns the known verified values (e.g. `stride_frequency.high === 3.4`,
  `ring_met_limit === 1.8`, HF band `[150,400]`).
- CI: JSON files parse; MANIFEST SHAs match the committed files (a checksum test).
- No runtime/device surface — pure data + loader.
