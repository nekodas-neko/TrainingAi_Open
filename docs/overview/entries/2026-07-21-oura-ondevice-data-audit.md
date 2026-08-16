## 2026-07-21 — Oura on-device + own-analysis: data-requirements map + master plan (docs-only)

**Planning session** unifying the two Oura threads the owner wants worked as one: (1) move raw data +
calculation on-device (Railway holds only calculated fields), (2) own our metric interpretation (keep Oura
only as a temporary oracle + 2 kept models). Answers the owner's core question — *what do we keep vs.
calculate vs. discard vs. back up* — and sequences the whole build. **Docs-only: no migration, no data
dropped, no code touched.**

**Shipped (2 plan docs + backlog):**
- **`docs/superpowers/plans/2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`** — the
  definitive keep/cull/calculate/backup matrix. Every metric's calculation provenance, per-raw-tag
  retention verdict (keep-raw / keep-hex-only / cull-now / cull-after-window), the finished-form backup
  subset, and the durability gap that gates the server raw drop. **Grounded in 5 parallel code audits**
  (`aggregateOuraRawSamples`, `decode.ts`, `lib/oura-models/`, server-vs-local schemas, every read surface),
  then hardened by an adversarial review.
- **`docs/superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md`** — the master sequencing plan
  (D0–D7): step_counter wiring → durability chain (Phase-2) → native raw + rollup port (Phase-1) → silent
  cutover → server-raw drop → dHRV retirement → Polar H10 reference → oracle deprecation, with the
  dependency graph and owner-decision table.
- Backlog entry added; branch `feat/oura-ondevice-hybrid` for the implementer.

**Key findings (code beat the prose — corrections recorded in the map §10):**
- Only **two ONNX models run in the live rollup**: SleepNet (moonstone) + dHRV imputation. step_counter is
  admin-route-only (live steps = a flat-30/window heuristic that over-counts — the D0 fix); energy/illness/
  awhr/sleepnet-bdi ONNX are dormant/test-only. Vascular-age has **no wired model at all**.
- **SyncDelta carries 24 domains** (not "only sleepSessions+ouraDaily" as the handover claimed); but the 4
  mirror tables (`oura_daily_summary/_derived/_heartrate/_bucket`) have **no pull-delta domain** — that's
  the real durability gap and the prerequisite for dropping the 437k-row server raw table.
- Local SQLite is **v18** (v17 added the mirror tables; v18 is corrective). Next Postgres migration **136**.
- **Own everything except SleepNet (hypnogram) + step_counter (steps);** the Oura oracle-deprecation window
  does **not** shrink the retained raw set (owned metrics + 2 kept models consume ~the whole biometric
  spectrum). The real space win is the **server raw drop**, not device-side biometric culling.

**Adversarial review caught + fixed:** `0x47` motion was mis-classed as a top cull lever — it actually
feeds the *kept* step_counter model, so it's keep-raw (would have driven an irreversible wrong drop); the
live owned **illness radar** (`computeIllnessRadar`, 7+ read surfaces) was missing from the metric
inventory and conflatable with the dormant `illness_detection` ONNX; `0x61` mislabelled as rollup-consumed;
several "decided" items downgraded to open owner decisions.

**Verification / not exercised:** docs-only — nothing to device-verify in this PR. The plans themselves
flag every native/SQLite/BLE/WASM step as owner-S25-gated. No version bump (not user-visible). Open owner
decisions (O1–O4) are all post-implementation confirms or engineering recommendations — none block this
planning doc.
