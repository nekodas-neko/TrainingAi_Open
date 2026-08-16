> **⏭ SUPERSEDED (2026-07-21).** The audit this baton asked for is complete; the plan is written, reviewed,
> and on `main`. The current baton for *building* it is **[`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md)** —
> start there. This file is kept for history.

# Handover — Oura on-device + local-analysis: unifying the two threads

**Updated 2026-07-21.** This is the baton for the next agent on the Oura raw-on-device initiative. It
combines two threads the owner wants worked as one, and points at **the first part of the puzzle** — a
data-requirements analysis that must ground everything downstream. Standing truth still lives in
`CLAUDE.md`, `projectOverview.md`, and the plan docs referenced below; this doc is the live task map.

---

## The two threads being combined

1. **Move everything on-device (raw + calculation).** The phone's local SQLite becomes the source of
   truth for raw ring data and all high-resolution derived series; Railway holds only compact
   *calculated* fields as a backup. Design + phased plan already written and partly shipped (below).
2. **Move analysis on-device and figure out what data we actually need.** Determine, across the whole
   app, exactly what raw inputs must be *kept* (and for how long), what must be *calculated* and
   persisted (and at what resolution), what can be *discarded* after calculation, and what must be
   *backed up*. This is the owner's core question — the §5 "what is calculated data?" question, unified
   with the culling question from the 2026-07-15 plan.

**The owner's directive: treat these as one problem.** You cannot correctly build the on-device data
model (the tier ladder, the bucket schema, the sync) without first knowing, definitively, *what feeds
what* — which is thread 2. So **thread 2 is "the first part of the puzzle" and is what the next agent
should work.** North star: everything on the phone, future-proof, best performance/update; mimic the
device-primary health-app pattern (Garmin / Apple Health / Samsung Health) — phone computes incl. ML,
cloud is backup/sync only, never a compute dependency.

---

## Current state (all on `main` as of 2026-07-21)

**Shipped + reviewed:**
- **Phase 0 spec** (`docs/superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md`, #720) —
  hardened by a 4-reviewer pass + a 3-pass confirmation review. Locked decisions: **D1 on-device neural
  (WASM)** — the rollup's 2 ONNX models (SleepNet, dHRV) run in the WebView via `onnxruntime-web`;
  **D2 full-history cloud backup + restore** (not 90-day-capped); **storage-aware raw retention** on
  device; **device-primary** framing.
- **Phase 1 Task 0** (#722) — WASM/native ONNX **parity gate**: `onnxruntime-web` reproduces
  `onnxruntime-node` on the vendored models to ground-truth (SleepNet 0/1800 stage diffs; dHRV ~1e-6),
  proving on-device neural is viable. Guarded by `lib/oura-models/__tests__/wasm-parity.test.ts`.
- **Phase 1 Task 1** (#723, corrected in #725) — local SQLite **v18** calculated-form tables
  (`oura_bucket` keyed on `bucket_start_ms`, `oura_daily_summary`, `oura_daily_derived`, `oura_heartrate`,
  + Oura columns on local `sleep_sessions`). Additive/unused; a projectOverview Known-Issues row marks the
  v16→v18 upgrade NOT-yet-device-verified (open the app once on the S25 to confirm the DB loads).

**Planned + reviewed, NOT yet built:**
- **Phase 1 Tasks 2–9** (`…-phase-1.md`) — native `oura_raw.db` + local-commit cursor gate, port the
  rollup to the WebView, tier promotion, storage UI. **Device-gated** (native Kotlin, BLE, on-device
  SQLite) — needs the owner's S25 + APK rebuild.
- **Phase 2 durability** (`…-phase-2-durability.md`, #727/#728) — reviewed (3 passes), **revised to
  resolve R1–R7**, now a two-track plan (Foundation F1–F4 + shared-path Track A + dedicated HR/bucket
  Track B + cutover + restore). **Pending one more agent review before code.**

**Unplanned:** Phase 3 (retire server raw ingest + the 437k-row Railway drop, confirm-first) and Phase 4
(read-flip + device-storage UI).

---

## The first part of the puzzle — the data-requirements audit (what the next agent produces)

Before more device code, produce a **definitive data-requirements map** that unifies threads 1 and 2.
For the whole app's health/analysis surface, map end to end:

**feature/metric the app shows or computes → the calculated form(s) it reads → the resolution/tier those
need → the raw Oura tags / `body_hex` those calculations consume → how long raw must be retained on
device to (re)compute or reprocess → what is discardable after calculation → what must be backed up to
Railway (the durability subset).**

Concretely, the deliverable is a doc (in `docs/superpowers/plans/` or `docs/`) that answers:
1. **The metric inventory** — enumerate every health/analysis output: readiness + contributors, sleep
   score + stages/hypnogram, HRV (nightly + intraday), RHR, SpO₂, skin temp, respiratory rate, BDI/apnea,
   resilience, illness, chronic/daytime stress, body battery, activity/MET, steps, energy expenditure,
   training load, wear time, body comp, vascular age — and where each is displayed/consumed
   (readiness-score route, body-battery, weekly-digest, health/trends, running-plan, ai/health-insight, …).
2. **Calculation provenance** — for each, what it's computed from *today* (`aggregateOuraRawSamples`
   `adapter.ts:4033-5003` is the authority: the ROLLUP_TAGS it reads, the binning grids, the 2 ONNX
   models, the deterministic math in `lib/health/`, `lib/oura-models/`), and which finished tables it
   lands in (`oura_daily`/`_summary`/`_derived`, `sleep_sessions`, `body_metrics`, `oura_heartrate`).
3. **Raw → calculated map, per Oura tag** — for each high-volume tag (`0x8b` SpO₂ R/PI, `0x60/0x80` IBI,
   `0x5d` HRV, `0x6f` SpO₂, `0x86` aohr, `0x46/0x69/0x75` temp, `0x72` acm, `0x50` MET, `0x7e/0x7f` step
   features, sleep-phase tags): which calculated field(s) it feeds, and therefore how long its raw must
   survive on device to recompute/reprocess (decoder fix or **model-version bump** — SleepNet/step/
   illness/dHRV are versioned) vs when it's safe to drop in favour of the finest bucket.
4. **The keep/calculate/discard/backup decision, per data class** — the actual answer to "what do we
   need": raw retention window (storage-aware, per the decision), which tier(s) persist locally, which
   subset backs up to Railway (the restore set), and what is genuinely discardable.
5. **Reconcile with what already exists** so the on-device model *subsumes* rather than duplicates:
   `oura_daily`, `oura_daily_summary` (mig 116), `oura_daily_derived` (123/127/128), `sleep_sessions`,
   `body_metrics`, `oura_heartrate` (090), `rr_intervals` (124, chest-strap), `step_live_windows`.

This map is what makes the tier-ladder/bucket schema (Phase 0 §2), the Phase-1 rollup port, and the
Phase-2 backup subset *correct instead of guessed*. It is device-gated only in verification; the analysis
itself is doc work, fully doable in the sandbox by reading the rollup + model + schema code.

---

## Files & docs to read first
- `CLAUDE.md` (all DB/sync/offline/SQLite/BLE + "Oura Direct-BLE" sections) — standing rules.
- `docs/superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md` — the spec + Review Outcome + the
  §5 central question + §11 review findings.
- `docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md` and `…-phase-2-durability.md` — the plans.
- `docs/superpowers/plans/2026-07-15-oura-data-architecture-and-culling.md` — the culling / completed-form thread.
- `docs/db-volume-cleanup-handover.md` — why this started (Railway volume; `oura_raw_samples` = 91% of the DB).
- `docs/oura-ble-operations.md` + the `oura-native-ble` skill — pipeline rules, failure matrix, protocol.
- `lib/data/postgres/adapter.ts` `aggregateOuraRawSamples` (~4033) — the authoritative "what's computed
  from what" today. `lib/oura-ble/decode.ts` — per-tag decoders. `lib/oura-models/` — the ONNX + math.
  `lib/data/postgres/schema.ts` + `lib/sqlite/migrations.ts` — server vs local (v18) finished-table schemas.

## Open questions / blockers
- The data-requirements map (above) is the immediate task; it's the input the rest of the initiative needs.
- Phase 2 revised plan is **pending one more review** before any code.
- All native/BLE/SQLite/WASM-on-device behaviour is **unverified on device** — needs the owner's S25 + APK
  rebuild. Sandbox is green where it can be; device is the authoritative check per the Canonical Runtime rule.
