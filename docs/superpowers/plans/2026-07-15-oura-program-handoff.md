# Oura On-Device Models Program — Handoff & Continuation Guide

**Date:** 2026-07-15 · **Purpose:** let a fresh session (esp. a **cloud instance**) continue this
program cleanly. Read this first, then the master plan
(`2026-07-15-oura-models-program-master.md`) and the `oura-models` skill (`.agents/skills/oura-models/`).

---

## 1. What this program is
Reimplement Oura's on-device (tier-2) metrics on our direct-BLE pipeline, now that the decrypted
model suite + its extracted constants are in hand: sleep, readiness, steps, activity, energy,
training load, illness radar, stress, and (gated) vascular age + body composition — persisted in
completed form for analysis, while **culling the raw ingestion bloat** that's growing the DB.

Priorities baked in (owner directive): **culling unused raw is the #1 goal**; completed-form
persistence is analysis-first with a **performance-gated** read path; data-dropping steps are
confirm-first; vascular age + auto-exercise-detection are on-device-capture-gated.

## 2. Status — what has shipped (all merged to `main`, 2026-07-15)
| PR | Delivered | Sub-plan |
|---|---|---|
| #525 | Program docs (master + 7 sub-plans), `oura-models` skill, backlog | all |
| #526 | CI heap fix (build/typecheck were OOMing at 2 GB → 4 GB) | infra |
| #527 | **Constants ingestion** — 12 rule-based models vendored (`lib/oura-models/constants/`) + typed loader + integrity test | B (done) |
| #528 | **`oura_daily_derived`** completed-form table (migration 123) + COALESCE upsert repo | A (table half) |
| #529 | **Body-composition + weighted-trend** pure cores (`lib/health/body-composition.ts`, `metric-trend.ts`) | F (core) |
| #530 | **Steps `steps_motion_decoder`** pure port (`lib/oura-ble/steps-motion-decoder.ts`) | D (decoder core) |
| #531 | **Quality-gated daily-median** core (`lib/health/daily-medians.ts`) | E (HRV core) |

**Done:** all Phase-0 enablers (constants + completed-form table + CI) and the correctness-critical
**pure cores** for body-comp, steps, and HRV median. Each has CI unit tests.

## 3. Why the local (this) environment stopped at pure cores
This ran on a **local Windows worktree** with hard limits:
- **vitest can't run locally** (its `rolldown` win32 native binding isn't in the lockfile) → unit
  tests only run on **CI**. Compensated by validating every core's logic via Node before pushing.
- **No local Postgres, no runnable dev server** → migrations, the rollup, API routes and UI can't
  be runtime-verified here. Only pure-logic libraries are fully verifiable.
- **No ring / native SQLite** → all BLE/offline-first behaviour is unverifiable here.

So only **pure cores** were shipped-and-verified. Everything else was deliberately left for an
environment that can verify it.

## 4. What the CLOUD instance unlocks (the reason for the move)
On the cloud/remote sandbox (`CLAUDE_CODE_REMOTE=true`), per CLAUDE.md's "Local Development
Database" section:
- **`pnpm db:local`** provisions a local Postgres 16 (port 5433), applies all migrations, seeds a
  test user/program → **the rollup, repo, API routes and DB integration tests all run.**
- **vitest runs** (Linux binding) → the whole test suite, including the currently-skipped DB
  integration tests, executes locally.
- **`pnpm dev`** runs → API/UI flows verifiable per the "test on the dev server before merging" rule.

So on cloud, the **integration work becomes verifiable**: wiring the pure cores into the rollup,
the readiness/illness/body-comp API + UI, and the culling. **Still needs the owner's S25 + ring**
for true on-device BLE verification (steps column-order validation, sleep on-device, capture spikes).

### Provisioning the constants bundle on cloud
- **Rule-based constants are already vendored in-repo** (`lib/oura-models/constants/`) — nothing to
  re-provision for any rule-based port (steps, OTS, stress, baselines, body-comp, illness).
- **NN weights (Tier 2) are NOT in the repo.** For neural work (sleepnet, cva, energy_expenditure
  NN, dhrv_imputation), the owner re-provides `oura_models_bundle_lite.zip`
  (`oura_model_constants/*.constants.json`) — it holds the weight tensors. The full decrypted model
  dumps for reference live in that same zip; the `oura-models` skill references distill them.
  **See the bundle-provisioning doc (private archive — `scripts/private-paths.json`)** for exactly what the bundle
  contains (all 31 models with param counts + tier), the reprovisioning steps, the last-provided
  SHA-256, and the hard constraint that 5 custom C++ ops aren't recoverable (blocks some NN ports).

## 5. How to continue — recommended order
The backlog (`docs/implementation-backlog.md`, "⭐ Program (2026-07-15)" block) + the sub-plans are
the roadmap. Suggested next steps for the cloud session:

1. **CI Tests-job Postgres service (small, high-leverage).** The `test` job in `.github/workflows/ci.yml`
   has no DB, so **every DB integration test skips in CI** — the rollup's DB behaviour has no CI
   coverage. Mirror the `migrations` job: add the `postgres:16` service + `DATABASE_URL` + a
   `node scripts/local-db/migrate.js` step before `pnpm test`. Verify locally first (cloud has PG),
   since enabling ~a dozen previously-skipped tests may surface a latent one needing seed data.
2. **Wire the pure cores into the rollup** (`aggregateOuraRawSamples`, `lib/data/postgres/adapter.ts`),
   each writing completed-form to `oura_daily_derived` and each verified against the seeded DB +
   its integration test:
   - HRV/RHR → `medianGated` (replace the naive mean at ~`adapter.ts:3848`); build MET/sleep windows.
   - Steps → decode `strideFrequency` and count `stride_freq × window_s` (after the **on-device
     column-order validation**, D-2 — needs the owner + a counted walk).
   - Body-comp → persist `body_comp` to `oura_daily_derived`; add the panel UI.
   - Readiness/activity → persist scores + contributors; make the route read-first where measured slow.
3. **Illness radar** (E) — rule-based over baselines, surfaced inside the readiness indicator
   (baseline-first; flag + suppression, not a double-counted contributor). See E §5.5.
4. **Remaining pure cores then their wiring:** OTS training load (D — reconcile the window/resample
   contract vs the `.pt` first, D-7), daytime stress (E), sleep feature stack (C).
5. **Culling** (A, the owner's #1 priority): Lever 2 (tag whitelist) + Lever 3 (`step_live_windows`
   retention) are safe/forward-only; **Lever 1 (drop `decoded` JSONB) requires refactoring the rollup
   to decode from `body_hex` in-memory** (it currently reads persisted `decoded` at ~30 sites,
   `adapter.ts:3597–4146`) — device/DB-verify carefully. Destructive steps (aged-`decoded` null
   backfill, `body_hex` retention) are **confirm-first with the owner**.
6. **Admin console** (G) — land the domain-section skeleton early so each feature PR drops its
   device-test card in; the DB-footprint card pairs with the culling.
7. **Capture-gated (owner + S25):** vascular-age PPG GO/NO-GO spike (F), auto-exercise continuous-accel
   spike (D-9). Don't schedule the models until capture is validated.

## 6. Working rules that carried this program
- **One PR per unit, CI-green then squash-merge** (GitHub `gh`/MCP; direct push to `main` is blocked).
- **Pure cores** ship with CI unit tests + Node logic-validation. **Integration** (rollup/API/UI)
  needs a runtime and an integration test on the seeded DB. **BLE/device** behaviour ships with a
  Known-Issues row until the owner runs the on-device smoke check.
- **One-Constant-One-Source:** ports import from `lib/oura-models/constants/`, never hardcode a
  vendored number. Note the extracted constants **correct earlier skill prose** in places (e.g. OTS
  `gamma=1`, `M=8`, `min_mets_count=720`; `high_ots_threshold` is tensor-wrapped).
- **Redecode discipline:** new derivations must recompute from stored `body_hex`; never mutate it
  (until the culling policy change is explicitly approved).
- Update `docs/module-map.md` + the backlog in the same PR as each change.

## 7. Loose ends / gotchas for the next session
- The constants bundle used here was at a local temp path (ephemeral) — see §4 for re-provisioning.
- CI `Tests` job currently gives DB integration tests a free pass (they skip) — see §5.1.
- The backlog program block still lists sub-plans A/D/E/F as pending; they are **partially done**
  (cores merged, wiring remains) — annotations added 2026-07-15. Check git history (#527–#531) before
  re-doing a core.
- `high_ots_threshold` and some OTS/tensor constants are `{kind:'tensor', values:[...]}`-wrapped —
  unwrap `.values[0]` when consuming.
