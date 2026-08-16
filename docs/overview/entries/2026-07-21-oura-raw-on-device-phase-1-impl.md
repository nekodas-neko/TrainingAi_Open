## 2026-07-21 — Oura raw-on-device: Phase 1 implementation (Tasks 0–1)

Implementation of the Oura raw-on-device architecture
(`docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md`). Building the JS/sandbox-verifiable
halves first; native Kotlin (`oura_raw.db`, BLE cursor) is batched for a single owner APK rebuild later.

**Task 0 — WASM neural-parity gate (#722, merged).** Added `onnxruntime-web` + a WebView session loader
(`lib/oura-models/inference/session-web.ts`) so the neural rollup can run in the WebView instead of the
server-only `onnxruntime-node` addon. A CI regression test (`wasm-parity.test.ts`) proves the WASM runtime
reproduces the native runtime on the real vendored models: **SleepNet per-epoch stage argmax matches
exactly (0/1800 mismatches); dHRV and apnea logits agree to ~1e-6.** This validates decision D1
(on-device neural) — moving the models on-device shifts no displayed sleep stage. Only remaining neural
unknown: S25 nightly runtime speed (device-measured later). Pure JS, ships via Railway, no APK rebuild.

**Task 1 — local calculated-form tables (this PR).** Local SQLite → v17: four additive/nullable tables
(`oura_bucket` tier store, `oura_daily_summary`, `oura_daily_derived`, `oura_heartrate`) + Oura columns on
local `sleep_sessions` (reconcile-only, Batch-F pattern) so a BLE sleep night can render offline. Schema
foundation only — not yet read/written (the rollup that populates them is a later PR); landed in isolation
so the v17 upgrade can be device-verified before anything is wired to it.

**Verification:** `check-reconcile` green (34 tables, 70 columns); tsc/lint green; **every migration version
+ the reconcile pass applied cleanly to a real in-memory SQLite, including the idempotent reconcile-ALTER
re-run (the partial-upgrade path that killed the local DB twice)**. NOT device-verified: the Capacitor
plugin's actual v16→v17 upgrade transaction on the S25 — flagged with a projectOverview Known-Issues row
(open the app once to confirm the DB loads). No version bump (no user-visible change; tables unused).
