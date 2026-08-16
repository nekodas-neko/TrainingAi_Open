# Stress-Resilience Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Oura's multi-day **stress-resilience** model (`stress_resilience_2_2_1`) as our own derived metric: a rolling resilience *level* (Oura's `low → limited → adequate → solid → strong` bands, 1.0–5.0 continuous) computed each night from our own sleep/recovery contributors plus the direct-BLE daytime-stress series — persisted to `oura_daily_derived` and surfaced in the health recovery/stress section, which today shows only the **frozen** Oura Cloud `resilienceLevel` (dead since the 2026-07-07 re-key).

**Architecture:** `stress_resilience_2_2_1` is a **0-trainable-parameter, pure-algorithm** TorchScript graph (a `Validator`/`Preprocessor`/`Processor` pipeline — no neural core, no `state_dict`; see `docs/oura-models/readable/stress_resilience_2_2_1.md`). It is therefore ported **verbatim to TypeScript** and golden-verified against a captured `.pt` test vector — exactly the pattern already used for `daytimeStressLevel`/`dhrvFeatures` in `lib/health/daytime-stress.ts`, **not** the ONNX-runner pattern of `lib/oura-models/inference/dhrv.ts` (that pattern is for MLP cores with weights to export; there are none here). The one neural dependency — the daytime `stress` series — already runs through the golden-verified `dhrv_imputation_1_1_0.onnx` inside `buildDaytimeStressSeries`, so this plan adds **no new ONNX model**. The model is a **two-stage, stateful** pipeline: (1) `estimate_daily_indices` turns one day's daytime-stress series + that night's contributors into three scalar daily indices `{daily_stress, daily_restorative_time, daily_sleep_recovery}`; (2) `estimate_resilience_level` fits a PCA plane over the trailing 14-day window of those indices to produce the resilience level. We persist each day's three indices to `oura_daily_derived` (the rolling-state store — no in-memory accumulator survives across rollups) and read the trailing 13 back to form the window.

**Tech Stack:** TypeScript; new `lib/health/stress-resilience.ts` (port + orchestrator); `lib/health/daytime-stress.ts` (existing daytime series), `lib/health/readiness-composite.ts` (the unblock — our own `hrvBalance`/`recoveryIndex`/`restingHeartRate` contributors), `lib/health/sleep-score.ts`; the rollup `aggregateOuraRawSamples` in `lib/data/postgres/adapter.ts`; `oura_daily_derived` (Drizzle repo + one additive migration); `app/api/readiness-score/route.ts`; `components/health/`; vitest + a vendored golden fixture in `lib/oura-models/onnx/__fixtures__/`.

---

## Why now

The backlog lists `stress_resilience` (`remaining §4` / P-E P3) under **⛔ Frozen Oura Cloud** (`docs/implementation-backlog.md:165-167`): *"both need Cloud-frozen readiness/vo2max/contributors → **derive-ours-or-gate first** (this is the real blocker, not the model)."* That blocker is now **resolved**. As of the readiness-composite work, we compute our own baseline-calibrated `hrvBalance` and `recoveryIndex` contributors (the two inputs that were pinned to the frozen Cloud), plus `restingHeartRate` and `previousNight` — all in `lib/health/readiness-composite.ts`, driven by the per-signal baselines in `oura_daily_summary` (migration 116). The daytime-stress half also landed (`buildDaytimeStressSeries`, dhrv ONNX). So every input the resilience model needs is now produced by our own pipeline, and the health recovery/stress surface can show a **live** resilience level again instead of the frozen Cloud string.

**Branch:** `feat/stress-resilience`

**Lane:** the **Oura-derivation SERIAL track** (`docs/implementation-backlog.md:137-149`) — one implementer at a time, do **not** parallelise. This PR edits two of the cluster god-files (`lib/data/postgres/adapter.ts` rollup, `app/api/readiness-score/route.ts`) plus `slices/oura.ts` + `repository.ts`, which nearly the whole cluster also edits. Land it as its own sequential PR; expect `package.json`/`lib/changelog.ts` conflicts with sibling lanes and re-bump on freshly-fetched `main`.

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Verbatim TS port + captured golden vector, NOT an ONNX export.** `stress_resilience_2_2_1` has `Trainable parameters: 0`, `Parameter tensors: 0`, `Buffers: 0` — the whole graph is control flow, saturation-table lookups, weighted sums and a PCA plane fit (constants vendored in `lib/oura-models/constants/stress_resilience_2_2_1.constants.json`). `scripts/oura-models/export-onnx.py` rebuilds *neural cores* from a `state_dict`; there is no core here to export, and the README documents torch's TorchScript→ONNX path is broken for these graphs anyway. The parity requirement is kept in full — a golden input/output vector captured from the original `.pt` (owner-run harness) is asserted against the TS port to `< 1e-3`, mirroring how `daytimeStressLevel` is golden-tested against `stress_daytime_sensing_1_1_0.pt`. Fixture lives in `lib/oura-models/onnx/__fixtures__/` for locality with the other model vectors. **Do not** try to produce a `stress_resilience_2_2_1.onnx`.
2. **Inputs come from OUR derived pipeline, never a frozen Cloud column.** The 15 forward inputs map as: `sleep_score` ← `computeSleepScore` (0–100); `hrv_balance` ← readiness-composite `hrvBalance` contributor (0–100); `recovery_index` ← readiness-composite `recoveryIndex` contributor (0–100); `resting_heart_rate` ← readiness-composite `restingHeartRate` contributor (0–100, **the 0–100 contributor score, not the raw bpm** — the model's validator bounds it 0–100, error codes 2/3/4 in the constants); `sleep_start/end_timestamps` ← `sleep_sessions.sleepStart/sleepEnd`; `stress` + `stress_timestamps` ← `buildDaytimeStressSeries` output; the `stress_lim`/`recovery_lim`/`saturation_*` scaling params ← the same night-HRV-baseline saturation tables already in `daytime-stress.ts`; `daily_*_list` ← the trailing 13 persisted daily indices. **Never** read `oura_daily.resilience_level`/`resilienceLevel` (the frozen Cloud value) as an input.
3. **Two-stage, DB-backed rolling state — no in-memory accumulator.** The `.pt` threads `daily_*_list` (length-13) through its `forward`; we don't keep that state in a process. Instead the rollup computes today's three daily indices and **persists** them; the window is reconstructed each run by reading the trailing 13 days of persisted indices via `getOuraDailyDerived`. This is idempotent (re-running the rollup recomputes and re-upserts the same indices) and survives restarts. `resilience_window_min_length = 5`: fewer than 5 non-null indices in the 14-day window → resilience is `null` (the model's `default_error_value` is NaN → we surface null, never fabricate).
4. **Graceful degradation is layered and every layer gates to null, never a fabricated number.**
   (a) The composite contributors are `provisional`/neutral until `BASELINE_MIN_NIGHTS` (14) nights of `oura_daily_summary` history — feeding a neutral 50 into resilience would invent a level, so a day whose `hrvBalance`/`recoveryIndex` are still provisional produces a **null** daily index (skipped from the window), not a real one.
   (b) The daytime `stress` series needs `min_hours_of_stress_available_in_daytime = 4` of coverage; the ring power-gates when worn-idle at a desk, so many days have too little — those days also yield a null daily index (the preprocessor's `Insufficient stress` branch).
   (c) `< 5` valid days in the window → null resilience level.
   Result: a cold user, or a user with sparse daytime wear, simply has no resilience surfaced until enough history accrues — exactly like the readiness composite's `learning` behaviour.
5. **Compute in the rollup, alongside `illness_radar` — read live in the route.** Resilience needs the daytime-stress series the rollup already assembles from raw BLE (`temp`/`met`/`hr`), so it's a new `resilience` step in `aggregateOuraRawSamples` (its own `step(...)` so a failure can't block the summary/illness writes), persisting to `oura_daily_derived`. `app/api/readiness-score/route.ts` **reads** the latest persisted `resilience_level` (+ its band label) and returns it — it does not recompute (the daytime series isn't available there). This mirrors the illness split (rollup persists, route consumes) and keeps the god-file route edit tiny.
6. **`cumulative_stress_1_2_2` is a documented follow-on, NOT in this PR.** It's the other half of the "§4 cumulative/resilience" pair, but materially bigger: 27 forward inputs including menstrual-cycle phase, a `temp_skin` timeseries with timestamps, `sleep_phase_30_sec`, and a `Processor` with `cluster_centroids` + contributor cluster-probabilities (chronic-stress clustering) — a separate multi-input assembly and its own golden-verify. Its persistence columns already exist (`chronic_stress_score`, `chronic_stress_contributors` in migration 123). This plan adds a backlog entry for it rather than doubling the surface area of one PR (per the "split large specs" rule).

## Verified current state (2026-07-16)

- **Model card:** `docs/oura-models/readable/stress_resilience_2_2_1.md` — top-level `forward` inputs + the daily-indices → window → resilience-level control flow. **Traced source (authoritative for the port):** `scripts/oura-models/_source/stress_resilience_2_2_1/___torch_mangle_{4,8,9,10}.py` (the `Validator`/`Preprocessor`/`Processor` submodule `forward`s). **Constants (vendored, SHA-pinned):** `lib/oura-models/constants/stress_resilience_2_2_1.constants.json` — key attrs: `sleep_score_weight 0.4`, `hrv_balance_weight/recovery_index_weight/resting_heart_rate_weight 0.2`, `resilience_window_length 14`, `resilience_window_min_length 5`, `resilience_today_weight 2`, `resilience_last_period_weight 1`, `daytime_recovery_weight 0.3`, `sleep_recovery_weight 0.7`, `resilience_plane_fit_coef [−0.00179, −0.19129, 65.391]`, `pca_minor_axis_length 16`, `resilience_level_multipier [−0.9,−0.3,0.3,0.9]` (the 4 cut-points → 5 bands), `min_hours_of_stress_available_in_daytime 4`, `resolution_minutes 10`, `default_error_value NaN`. Already imported in `lib/oura-models/constants/index.ts:32,68` — add a typed `getResilienceConstants()` loader beside `getDaytimeStressConstants()` (`index.ts:150`).
- **The unblock — our contributors:** `lib/health/readiness-composite.ts` → `computeReadinessComposite(...)` returns `contributors.{hrvBalance, recoveryIndex, restingHeartRate, previousNight, ...}` each `{score 0-100, provisional}`. `BASELINE_MIN_NIGHTS = 14`. Inputs assembled in `app/api/readiness-score/route.ts:258-269` from `illnessZScores(priorSummary, latestSummary)` + `computeSleepScore` + `latestSummary.recoveryIndexHours`/`nHistory`. The rollup has the same summary rows (`computeDailySummaries` → `summaryRows`, `adapter.ts:4408`).
- **Daytime-stress series:** `lib/health/daytime-stress.ts` → `buildDaytimeStressSeries(temp, met, hr, baselines, fromMs, toMs)` returns `StressPoint[] { t, dhrv, stressLevel ∈ [−1,1] }`; `daytimeStressLevel(...)` holds the `STRESS_SAT_*`/`REC_SAT_*` saturation tables that also supply the resilience preprocessor's `stress_lim`/`recovery_lim`/`saturation_*` scaling. The rollup already assembles daytime `temp`/`met`/`hr` from raw BLE (see the `metByDay`/`nightInputsByDate` assembly, `adapter.ts:4387-4405`, and the HR/temp series used for sleep).
- **Sleep score + sessions:** `computeSleepScore(session, tz)` (`lib/health/sleep-score.ts`); `sleep_sessions.sleepStart/sleepEnd` (`schema.ts:306`), listed via `repo.listSleepSessions`.
- **Persistence:** `oura_daily_derived` (migration 123) already has `resilience_level DOUBLE PRECISION`, `daytime_stress_scaled`, `stress_high_minutes`, `recovery_high_minutes`, `chronic_stress_score`, `chronic_stress_contributors`. It is **missing** columns for the three per-day rolling indices, the confidence, and the granular level — those are the additive migration below. Repo boundary: `OuraDailyDerivedRow`/`OuraDailyDerivedPatch` (`repository.ts:868-900`), column map `DERIVED_COLS` (`slices/oura.ts:630-641`), Drizzle table (`schema.ts:792-826`), row mapper (`slices/oura.ts:660-690`). Rollup persists illness via `step('illness_radar', ...)` → `upsertOuraDailyDerived` (`adapter.ts:4415-4424`) — the template for the new `resilience` step. Server-side only table (no local-SQLite mirror, not device-synced).
- **Surface (frozen today):** `app/api/readiness-score/route.ts:363` returns `resilienceLevel: ouraToday?.resilienceLevel ?? null` (the Cloud string, frozen). Rendered in `components/health/health-score-detail.tsx` (default at `:133`). `stressHigh`/`recoveryHigh` also come from frozen `ouraToday` (`route.ts:377-378`). Oura's band labels are `'exceptional'|'strong'|'adequate'|'limited'|'low'` (`lib/oura/types.ts:181`).
- **Migration numbering:** tree max is `124_rr_intervals.sql`; **`125` is reserved** for item 10b respiratory (`docs/implementation-backlog.md:119`). Claim **`127`** for this plan — record it in the backlog row so a parallel lane doesn't collide.
- **onnxruntime-node** is server-only and already a dependency (used by dhrv/illness); the resilience port itself needs no runtime — its only ONNX touch is the existing `buildDaytimeStressSeries`.

## File structure

**Create:**
- `lib/health/stress-resilience.ts` — the verbatim port (`estimateDailyIndices`, `estimateResilienceLevel`) + the `computeResilienceForDay` orchestrator + the `resilienceLevelToBand()` label map.
- `lib/health/__tests__/stress-resilience.test.ts` — golden-vector parity + unit tests (banding, gates, null propagation).
- `lib/data/postgres/migrations/127_oura_daily_resilience.sql` — additive columns on `oura_daily_derived`.
- `lib/oura-models/onnx/__fixtures__/stress_resilience_2_2_1_inputs.bin` + `..._outputs.bin` — captured golden vector (owner-run harness).

**Modify:**
- `lib/oura-models/constants/index.ts` — `getResilienceConstants()` typed loader.
- `lib/data/postgres/schema.ts` — new columns on the `ouraDailyDerived` table.
- `lib/data/repository.ts` — new fields on `OuraDailyDerivedRow` (patch derives from it via `Partial<Omit<…>>`).
- `lib/data/postgres/slices/oura.ts` — new entries in `DERIVED_COLS` + the row mapper.
- `lib/data/postgres/adapter.ts` — new `resilience` step in `aggregateOuraRawSamples`.
- `app/api/readiness-score/route.ts` — read + return `ownResilienceLevel`/`ownResilienceBand` (+ response type).
- `components/health/health-score-detail.tsx` (+ a new `components/health/` child if the section grows past the file's size budget) — render our derived resilience, preferring it over the frozen Cloud string.
- `scripts/oura-models/export-onnx.py` (or a sibling capture note) — add the resilience golden-vector capture (owner-run; documented, not run in-sandbox).
- `lib/changelog.ts` + `package.json` version, journal + `projectOverview.md` index, backlog removal + cumulative-stress follow-on entry (final task).

---

### Task 1: Additive migration + repo/schema plumbing for the rolling-state columns

**Files:**
- Create: `lib/data/postgres/migrations/127_oura_daily_resilience.sql`
- Modify: `lib/data/postgres/schema.ts`, `lib/data/repository.ts`, `lib/data/postgres/slices/oura.ts`

The rolling window is reconstructed from persisted per-day indices, so those three indices need durable columns; `resilience_level` (existing) holds the banded level, and we add confidence + the granular (pre-band) level for display/analysis. All nullable, COALESCE-upserted like every other derived column.

- [ ] **Step 1: Write the migration** (idempotent `ADD COLUMN IF NOT EXISTS`, no PRAGMA, all nullable):

```sql
-- Stress-resilience (stress_resilience_2_2_1, Sub-plan E P3). The three per-day indices are the
-- durable rolling-window state the resilience level is fitted over; confidence = valid-days/14;
-- granular = the continuous pre-band level. resilience_level (banded 1.0-5.0) already exists (mig 123).
ALTER TABLE oura_daily_derived
  ADD COLUMN IF NOT EXISTS resilience_daily_stress          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_daily_restorative_time DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_daily_sleep_recovery   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_granular               DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_confidence             DOUBLE PRECISION;
```

- [ ] **Step 2: Mirror in Drizzle** (`schema.ts`, in the `ouraDailyDerived` table beside `resilienceLevel: doublePrecision('resilience_level')`):

```typescript
  resilienceDailyStress:           doublePrecision('resilience_daily_stress'),
  resilienceDailyRestorativeTime:  doublePrecision('resilience_daily_restorative_time'),
  resilienceDailySleepRecovery:    doublePrecision('resilience_daily_sleep_recovery'),
  resilienceGranular:              doublePrecision('resilience_granular'),
  resilienceConfidence:            doublePrecision('resilience_confidence'),
```

- [ ] **Step 3: Extend the repo row + column map.** Add the five fields to `OuraDailyDerivedRow` (`repository.ts:868-897`, `number | null` each — `OuraDailyDerivedPatch` picks them up automatically via `Partial<Omit<…>>`); add them to `DERIVED_COLS` (`slices/oura.ts:630-641`) and to the row mapper in `getOuraDailyDerived` (`slices/oura.ts:666-690`).

- [ ] **Step 4: Apply + typecheck + commit**

Run: `pnpm db:local && npx tsc --noEmit 2>&1 | head -5`
Expected: migration 127 applies (idempotent re-run safe); typecheck clean.

```bash
git add lib/data/postgres/migrations/127_oura_daily_resilience.sql lib/data/postgres/schema.ts lib/data/repository.ts lib/data/postgres/slices/oura.ts
git commit -m "Add rolling stress-resilience index columns to oura_daily_derived"
```

---

### Task 2: Constants loader + capture the golden vector

**Files:**
- Modify: `lib/oura-models/constants/index.ts`, `scripts/oura-models/export-onnx.py`
- Create: `lib/oura-models/onnx/__fixtures__/stress_resilience_2_2_1_inputs.bin`, `..._outputs.bin`

- [ ] **Step 1: Typed constants loader** (`index.ts`, beside `getDaytimeStressConstants` at `:150`):

```typescript
export interface ResilienceConstants {
  sleepScoreWeight: number
  hrvBalanceWeight: number
  recoveryIndexWeight: number
  restingHeartRateWeight: number
  windowLength: number        // 14
  windowMinLength: number     // 5
  todayWeight: number         // 2
  lastPeriodWeight: number    // 1
  daytimeRecoveryWeight: number
  sleepRecoveryWeight: number
  planeFitCoef: [number, number, number]
  pcaMinorAxisLength: number
  levelMultiplier: number[]   // [-0.9,-0.3,0.3,0.9] cut-points
  minDaytimeStressHours: number
  resolutionMinutes: number
}

/** `stress_resilience_2_2_1` — weights, window params + PCA plane-fit coefficients. */
export function getResilienceConstants(): ResilienceConstants { /* read getAttributes('stress_resilience_2_2_1').values */ }
```

(Read each `attributes[k].values[0]` scalar / `.values` array, exactly as the sleep-staging loader does. `verifyConstantsIntegrity` already covers the SHA pin.)

- [ ] **Step 2: Capture the golden vector (OWNER-RUN — document, do not run in sandbox).** Extend `scripts/oura-models/export-onnx.py` (or a sibling `capture-resilience-golden.py`) to load the decrypted `stress_resilience_2_2_1.pt`, run its `forward` on a fixed synthetic input (a mature 14-day window with a realistic daytime-stress series + neutral-ish contributors), and dump the flattened input tuple and the 13-output tuple to the two `.bin` fixtures. Note in the PR that this half runs on the owner's machine (needs the owner-held `.pt` archive + LibTorch, same as the existing fixtures) — the TS port + parity test are what the sandbox verifies.

- [ ] **Step 3: Commit**

```bash
git add lib/oura-models/constants/index.ts scripts/oura-models/export-onnx.py lib/oura-models/onnx/__fixtures__/stress_resilience_2_2_1_inputs.bin lib/oura-models/onnx/__fixtures__/stress_resilience_2_2_1_outputs.bin
git commit -m "Add resilience constants loader + captured golden vector"
```

---

### Task 3: Port stage 1 — `estimateDailyIndices` (daily stress / restorative-time / sleep-recovery)

**Files:**
- Create: `lib/health/stress-resilience.ts`
- Test: `lib/health/__tests__/stress-resilience.test.ts`

Port `Preprocessor.preprocess` (10-minute-resolution quantization of the daytime `stress` series into moderate/high/low buckets, gated on `min_hours_of_stress_available_in_daytime`) and `Processor.estimate_daily_indices` (weights the quantized daytime stress + the four nightly contributors into the three scalar indices) **verbatim from the traced source** `scripts/oura-models/_source/stress_resilience_2_2_1/___torch_mangle_{8,9}.py`, using the vendored constants. Infallible: insufficient stress or a provisional/absent contributor → the day's indices are `null` (mirrors the `.pt` `Insufficient stress`/`default_error_value` branches).

- [ ] **Step 1: Define the input contract + types** (top of `stress-resilience.ts`):

```typescript
export interface ResilienceNight {
  day: string                     // local day (wake date)
  sleepStartMs: number; sleepEndMs: number
  sleepScore: number | null       // 0-100 (computeSleepScore)
  hrvBalance: number | null       // 0-100 readiness-composite contributor (null if provisional)
  recoveryIndex: number | null    // 0-100 (null if provisional)
  restingHeartRate: number | null // 0-100 contributor score (NOT raw bpm; null if provisional)
  stressSeries: { tMs: number; level: number }[]  // buildDaytimeStressSeries StressPoint[] (level ∈ [-1,1])
  nightHrvBaselineMs: number | null                // scales the saturation limits
}

export interface DailyIndices { dailyStress: number; dailyRestorativeTime: number; dailySleepRecovery: number }
```

- [ ] **Step 2: Write the failing golden + unit tests** (`__tests__/stress-resilience.test.ts`): read the `..._inputs.bin`/`..._outputs.bin` fixtures (same `readF32` helper shape as `inference/__tests__/dhrv.test.ts`), run the ported pipeline on the fixture input, assert each of the 13 outputs matches to `< 1e-3`. Plus unit cases: a null/provisional contributor → `null` daily indices; a daytime series with `< min_hours_of_stress_available_in_daytime` coverage → `null`.

- [ ] **Step 3: Implement `estimateDailyIndices(night: ResilienceNight, c: ResilienceConstants): DailyIndices | null`** per the source. Run: `npx vitest run lib/health/__tests__/stress-resilience.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/health/stress-resilience.ts lib/health/__tests__/stress-resilience.test.ts
git commit -m "Port stress-resilience stage 1: daily stress/restorative/sleep-recovery indices"
```

---

### Task 4: Port stage 2 — `estimateResilienceLevel` (PCA-plane fit + banding) + orchestrator

**Files:**
- Modify: `lib/health/stress-resilience.ts`, `lib/health/__tests__/stress-resilience.test.ts`

Port `Processor.estimate_resilience_level` (`___torch_mangle_9.py`) verbatim: over the trailing 14-day window of the three daily-index lists it computes long-term restorative-time/sleep-recovery/recovery/stress (weighted by `resilience_today_weight`/`resilience_last_period_weight`), fits the `resilience_plane_fit_coef` plane with `pca_minor_axis_length`, and maps to a level via `resilience_level_multipier` (the 4 cut-points → bands 1–5). Confidence = `valid_days / resilience_window_length`.

- [ ] **Step 1: Failing tests** — extend the golden test to cover the stage-2 outputs (`resilience_level`, `granular_resilience_level`, `confidence`); add unit cases: `< resilience_window_min_length (5)` valid days in the window → `null` level (the model's `default_error_value`); confidence = `count/14`.

- [ ] **Step 2: Implement**

```typescript
export interface ResilienceResult {
  level: number          // 1.0-5.0 banded
  granular: number       // continuous pre-band
  confidence: number     // validDays / 14
  dailyIndices: DailyIndices  // today's, to persist into the rolling state
}

/** Full model: today's night + the trailing ≤13 persisted daily indices → resilience. null when the
 *  window has < resilience_window_min_length valid days or today's indices can't be computed. */
export function computeResilience(
  today: ResilienceNight, priorIndices: DailyIndices[], c: ResilienceConstants,
): ResilienceResult | null

/** 1.0-5.0 → Oura's band label, matching the frozen-Cloud vocabulary so the UI copy is unchanged. */
export function resilienceLevelToBand(level: number): 'low' | 'limited' | 'adequate' | 'solid' | 'strong'
```

Run: `npx vitest run lib/health/__tests__/stress-resilience.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/health/stress-resilience.ts lib/health/__tests__/stress-resilience.test.ts
git commit -m "Port stress-resilience stage 2: window fit, banding, orchestrator"
```

---

### Task 5: Input assembly + rollup wiring (compute + persist in `aggregateOuraRawSamples`)

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

Add a `resilience` step after the existing `illness_radar` step (`adapter.ts:4415-4424`), inside `aggregateOuraRawSamples`, its own `step(...)` so a failure can't block the summary/illness writes.

- [ ] **Step 1: Assemble today's `ResilienceNight`** from data the rollup already holds:
  - `sleepStart/EndMs`, `sleepScore` ← the night's sleep session + `computeSleepScore`.
  - `hrvBalance`/`recoveryIndex`/`restingHeartRate` ← `computeReadinessComposite(...)` for the night (same inputs the readiness route builds from `illnessZScores(priorSummary, latestSummary)` + `recoveryIndexHours`/`nHistory`); take each contributor's `score`, but pass `null` when `contributor.provisional` is true (design decision 4a — a provisional 50 must not become a real input).
  - `stressSeries` ← `buildDaytimeStressSeries(temp, met, hr, baselines, dayStartMs, dayEndMs)` from the day's raw BLE temp/met/hr (the rollup already gathers these; reuse, don't re-query).
  - `nightHrvBaselineMs` ← `summaryRow` baseline.

- [ ] **Step 2: Read the trailing window + compute.** `const prior = await this.getOuraDailyDerived(userId, <day − 13>, <day − 1>)`, map each row's `resilienceDailyStress/…RestorativeTime/…SleepRecovery` (dropping rows where any is null) into `DailyIndices[]`, then `computeResilience(today, priorIndices, getResilienceConstants())`.

- [ ] **Step 3: Persist** (COALESCE upsert, only the resilience columns — never `source`/`model_versions`, same discipline as the illness step):

```typescript
await step('resilience', async () => {
  const res = computeResilience(today, priorIndices, c)   // null while learning/insufficient
  if (!res) return
  await this.upsertOuraDailyDerived(userId, today.day, {
    resilienceLevel: res.level,
    resilienceGranular: res.granular,
    resilienceConfidence: res.confidence,
    resilienceDailyStress: res.dailyIndices.dailyStress,
    resilienceDailyRestorativeTime: res.dailyIndices.dailyRestorativeTime,
    resilienceDailySleepRecovery: res.dailyIndices.dailySleepRecovery,
  })
})
```

Note: the daily indices are persisted **even on days the level itself can't yet be produced** (so the window fills) — restructure so `estimateDailyIndices` persists whenever it returns non-null, and the level fields are written only when `computeResilience` returns a result. Keep both in the one step.

- [ ] **Step 4: Typecheck + rollup smoke + commit**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: clean. (Live rollup verification is the Task-8 psql smoke — the BLE raw-sample path isn't exercisable in the sandbox.)

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Compute and persist stress-resilience in the Oura rollup"
```

---

### Task 6: Readiness route — expose the derived resilience (read-only)

**Files:**
- Modify: `app/api/readiness-score/route.ts`

- [ ] **Step 1: Fetch the latest persisted derived row.** The route already reads `dailySummaries`; add `repo.getOuraDailyDerived(userId, from7dIso, todayIso)` to the top `Promise.all` (`route.ts:121-129`), take the latest row whose `resilienceLevel != null`.

- [ ] **Step 2: Add response fields** to `ReadinessScoreResponse` (beside the frozen `resilienceLevel: string | null` at `:33`):

```typescript
  // Our own derived resilience (stress_resilience_2_2_1) — supersedes the frozen Cloud
  // resilienceLevel above when present. null until enough history accrues (never fabricated).
  ownResilienceLevel: number | null   // 1.0-5.0
  ownResilienceBand: 'low' | 'limited' | 'adequate' | 'solid' | 'strong' | null
  ownResilienceConfidence: number | null
```

and populate them in the returned object (`ownResilienceBand` via `resilienceLevelToBand`). Leave the frozen `resilienceLevel` field in place (other consumers may still read it) — the UI prefers `ownResilience*` when non-null.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "readiness-score" || echo clean` → `clean`.

```bash
git add app/api/readiness-score/route.ts
git commit -m "Return the derived stress-resilience level from the readiness route"
```

---

### Task 7: Surface — health recovery/stress section shows the live resilience

**Files:**
- Modify: `components/health/health-score-detail.tsx` (extract a `components/health/resilience-tile.tsx` child if the file is near its size budget)

The recovery/stress area currently reads the frozen Cloud `resilienceLevel` string. Render our derived resilience instead when present: the band label (`ownResilienceBand`, capitalized) + the 1.0–5.0 level, with a confidence hint when `< 1`. State by icon + label, never colour alone (per the theme rules). When `ownResilienceLevel` is null, show the existing "learning"/empty affordance (do **not** fall back to the frozen Cloud string, which is misleadingly stale — prefer showing nothing).

- [ ] **Step 1: Implement the tile** (Lucide icon + band label + level; `React.memo`, stable props; tokens not hex; `pb-safe`/`pt-safe` only if it's a full-screen surface — it's inline content, so no new inset).
- [ ] **Step 2: Wire it** from the `readiness` response already held by the detail screen (no new fetch).
- [ ] **Step 3: Lint + typecheck + commit**

Run: `npx eslint components/health/health-score-detail.tsx && npx tsc --noEmit 2>&1 | head -5` → clean.

```bash
git add components/health/health-score-detail.tsx components/health/resilience-tile.tsx
git commit -m "Surface the derived stress-resilience level in the health recovery section"
```

---

### Task Final: Gate + dev-server smoke + version/docs + follow-on

- [ ] **Step 1: Full gate** — `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`. Expected: all green (the golden-vector parity + unit tests run; DB tests hit local Postgres with migration 127 applied).

- [ ] **Step 2: Dev-server / psql smoke against the local DB** (`pnpm dev`, `test@local.dev` / `testpass123`). The rollup's BLE path isn't exercisable in the sandbox, so seed the persisted layer directly (psql on 5433, `trainingai_dev`; `:uid` = test user id) to prove the read/surface seams:

```sql
-- Seed a mature 14-day window of resilience daily indices + a produced level for "today".
-- (Values illustrative — the point is exercising the read path + banding + UI, not model parity,
--  which the golden test covers.)
INSERT INTO oura_daily_derived (user_id, day, resilience_daily_stress, resilience_daily_restorative_time,
  resilience_daily_sleep_recovery)
SELECT :uid, CURRENT_DATE - g, 0.1, 0.2, 0.6 FROM generate_series(1, 13) g
ON CONFLICT (user_id, day) DO UPDATE SET
  resilience_daily_stress = excluded.resilience_daily_stress,
  resilience_daily_restorative_time = excluded.resilience_daily_restorative_time,
  resilience_daily_sleep_recovery = excluded.resilience_daily_sleep_recovery;
INSERT INTO oura_daily_derived (user_id, day, resilience_level, resilience_granular, resilience_confidence,
  resilience_daily_stress, resilience_daily_restorative_time, resilience_daily_sleep_recovery)
VALUES (:uid, CURRENT_DATE, 4.0, 0.42, 1.0, 0.1, 0.2, 0.6)
ON CONFLICT (user_id, day) DO UPDATE SET resilience_level = excluded.resilience_level,
  resilience_granular = excluded.resilience_granular, resilience_confidence = excluded.resilience_confidence;
```

Checks: (1) `GET /api/readiness-score` → `ownResilienceLevel: 4`, `ownResilienceBand: "solid"`, `ownResilienceConfidence: 1`. (2) Health recovery section at the S25 viewport (412×915) → the resilience tile shows "Solid" + the level, not the frozen Cloud string; delete the `CURRENT_DATE` row → tile hides (does NOT show the stale Cloud value). (3) With `< 5` non-null index rows in the window, `computeResilience` returns null → tile hidden (unit-tested; note in PR if not seedable end-to-end).

- [ ] **Step 3: Version + changelog + journal + index + backlog.** Bump `package.json` **minor** (user-visible resilience tile). `lib/changelog.ts`: "Your stress-resilience level is back — computed from your own sleep and recovery signals plus daytime stress, instead of the frozen Oura Cloud value." Append the session note to the current `docs/overview/history-*.md`; update `projectOverview.md` (status; strike/annotate the resilience row); **remove this plan's backlog entry** from `docs/implementation-backlog.md` and move `stress_resilience` off the ⛔-Frozen-Cloud holding pen (`:165-167`); **add a follow-on backlog entry for `cumulative_stress_1_2_2`** (the §4 pair — needs cycle-phase + temp-skin-timeseries assembly + the chronic-stress cluster processor; persists to the existing `chronic_stress_*` columns) at the priority you judge, on the same serial track. Add a one-line row to `docs/module-map.md` for `lib/health/stress-resilience.ts`.

- [ ] **Step 4: Push + PR** — `git push -u origin feat/stress-resilience`. Standard change (additive migration, no data-drop, no auth/security, no secrets) — merge on green per the CI/CD workflow once the gate + smoke pass. Do **not** run in parallel with another Oura-derivation-track PR.

---

## Verification summary

- **Automated (sandbox):** golden-vector parity of the full 13-output resilience pipeline vs the captured `.pt` reference (`< 1e-3`); unit tests for banding (`resilience_level_multipier` cut-points), the `< 5`-valid-day null gate, provisional-contributor → null-index propagation, and confidence = `count/14`; full gate (`lint`/`tsc`/`test`/`build`) with migration 127 applied.
- **Dev-server (sandbox):** readiness-route `ownResilience*` fields from seeded derived rows; health-section tile appear/disappear + band label; the frozen-Cloud fallthrough is NOT shown.
- **Deferred — state explicitly in the PR:**
  - **Live rollup + real physiology** — the resilience compute runs inside `aggregateOuraRawSamples` off raw BLE samples, which the sandbox can't drive; and a real level needs 14+ nights of mature `oura_daily_summary` baseline **and** ≥5 days with ≥4 h of daytime-stress coverage. The fresh local seed has neither, so live resilience is only observable on-device after history accrues. Add a `projectOverview.md` Known-Issues row marking it not-yet-device-verified if no device pass happens in-session.
  - **The golden vector itself** is captured on the owner's machine (owner-held decrypted `.pt` + LibTorch) — the sandbox verifies the port against the vendored fixture, not the `.pt` directly.
  - **Ring daytime power-gating** (worn-idle at a desk → no PPG/HR → sparse stress series) is firmware behaviour, not a bug — it's why the `min_hours_of_stress_available_in_daytime` gate exists; expect many real days to yield only a daily index and no fresh level.
  - No native/APK code changes — the whole feature is server-side rollup + route + WebView UI, ships via Railway with **no APK rebuild** (state this in the PR).

## Notes for the implementer

- **Port from the traced source, not from memory or Oura's public docs.** `scripts/oura-models/_source/stress_resilience_2_2_1/___torch_mangle_{4,8,9,10}.py` + the vendored constants are authoritative; pin every ported branch against the golden vector. This is the same rule that keeps `daytimeStressLevel` correct.
- **Never feed a provisional contributor as a real number.** A `provisional`/neutral-50 `hrvBalance` or `recoveryIndex` must become a `null` daily index, or the resilience level is fabricated during the 14-night learning period (design decision 4a). The readiness composite already flags provisional — read that flag, don't just read the score.
- **Never read the frozen Cloud `resilienceLevel` as an input** (design decision 2) — it's the value this feature replaces. Inputs come only from our own contributors + daytime series.
- **The rolling state lives in the DB, not memory** — the window is always reconstructed from `getOuraDailyDerived`; the rollup is idempotent. Don't add an in-process accumulator.
- **One PR, serial track.** Don't also build `cumulative_stress_1_2_2` here — it's a documented follow-on. If any line/symbol anchor above has drifted (the god-files move fast on this track), re-anchor by symbol name, not by re-designing.
- **No ONNX for this model** (design decision 1) — if you find yourself editing `export-onnx.py`'s core-rebuild path or adding a `stress_resilience_2_2_1.onnx`, stop; the only ONNX touch is the existing `buildDaytimeStressSeries` → `dhrv`.
