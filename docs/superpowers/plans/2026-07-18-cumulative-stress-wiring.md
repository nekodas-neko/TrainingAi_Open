# Cumulative-Stress (`cumulative_stress_1_2_2`) — rollup wiring + surface follow-on

> **⛔ DEFERRED — blocked on missing model inputs (investigated 2026-07-18).** Building this now was
> found to require **fabricating 2 of the model's 9 required series**. The pipeline investigation:
> **GAP 1 (30-sec hypnogram) is resolvable** — the rollup's `modelStages: SleepStage[]`
> (`adapter.ts` ~4178, the SleepNet staging output) IS the 30-sec array, downsampled to 5-min only at
> storage, so it's in-scope. **But GAP 2 is worse than assumed:** the pipeline computes **neither**
> `hrv_medianHR_5min` **nor** `hrv_quality_5min` — the per-5-min median-HR-gated HRV window series and
> its paired quality score (grep across `lib/health/**` + the adapter rollup found no such series). We
> hold raw IBI/rMSSD and a nightly median HRV, not Oura's per-5-min windowed HRV processing. Those two
> are among the model's nine `min_days_required`-gated series (validator error codes 4/5/7/8), so
> without them `can_produce_score = 0` (permanent NaN), and fabricating them as proxies feeds a
> golden-verified model that was trained on Oura's *real* versions → an **unvalidatable** score that is
> no longer the true ChronicStress. Per the plan's own contingency (§2.2: "if the quality series can't
> be resolved, stop and raise to the owner") and the "don't ship dead/unverifiable infrastructure" rule,
> this is deferred. **Unblock path:** either (a) add the per-5-min median-HR-gated HRV + quality-proxy
> series to the BLE rollup as their own work item (then this wiring's assembly can consume them), or
> (b) an explicit owner decision to accept proxy inputs, accepting the score is an approximation of
> Oura's ChronicStress rather than a faithful port. Until one of those, do not wire it. The mapping /
> rollup-step / surface design below stays valid for when the inputs exist.



> **This is the follow-on the port plan deferred.** The library port
> (`lib/oura-models/cumulative-stress.ts`, `runCumulativeStress`) is **shipped and golden-verified
> to `< 1e-3`** against the captured `.pt` vector. It is **not wired into anything** — no input
> assembly, no rollup step, no surface. This plan covers that wiring. The persistence columns
> `oura_daily_derived.chronic_stress_score` (INTEGER) and `chronic_stress_contributors` (JSONB)
> **already exist** from migration 123 — no migration is needed for the score/contributors
> themselves (see the intermediate-history decision in §3 for the one place a migration *might*
> enter).
>
> **Reference implementation to copy:** the **stress-resilience** rollup step
> (`lib/data/postgres/adapter.ts`, the `await step('resilience', …)` block, ~line 4672). It is the
> §4 sibling of this model and already solves the same shape of problem: per-night assembly over a
> bounded trailing window, its own COALESCE-only upsert step so a failure can't block the summary/
> illness writes, seeding a rolling window from persisted values, cold-start = write nulls. Read it
> and `computeResilienceForDay` first.

---

## Why this is a plan, not a same-session build

`runCumulativeStress` takes **27 inputs** and hard-gates on data sufficiency: `min_days_required = 21`
means **each of 9 required series needs ≥ 21 non-NaN days inside the 31-day window**, or
`can_produce_score = 0` and every output is NaN (the `default_error_value` path). Four of those series
(`norm_hrv_medianHR_5min`, `median_hrv_quality_5min`, `normalised_iqr`, `norm_temp_wake`) are
**per-night preprocessor-derived intermediates** — each history element is one night's feature-
engineered value, so building 30 of them means having run the latest-night feature engineering for the
prior 30 nights. This is **multi-night-stateful**, and a subtly-wrong assembly produces a
plausible-but-wrong score that **cannot be caught in the sandbox** — the dev seed has no granular Oura
BLE signals, and a real non-null score only appears against ≥ 21 nights of real ring data (owner /
on-device). That is precisely the CLAUDE.md "plan now, build later" case.

The **model itself is not the risk** (it's golden-verified). **The input assembly is the entire risk.**
This plan exists to pin every input → source mapping and surface the three genuine gaps *before* an
implementer writes code blind.

---

## 1. Input → source mapping (the core of the work)

Model input (see `CumulativeStressInput` in `lib/oura-models/cumulative-stress.ts`) → where it comes
from in the rollup. The rollup already assembles: `summaryRows = computeDailySummaries(nights)`
(per-night `DailySummaryRow`, `lib/health/daily-summary.ts`), `sleepRows` (sleep_sessions incl. bedtime
window + hypnogram), and the raw BLE streams `ibiRows`/`aohrRows` (HR + rMSSD), `tempRows`+the `0x75`
`sleepSignal` (skin temp °C + ts), `metRows` (MET). Ranges in the right column are the model's own
validator bounds (constants `error_code_to_message`) — an assembled value outside them means a mapping
bug.

### 1a. History series available directly from `DailySummaryRow` (31- or 30-day windows)

| Model input | Source | Notes / range |
|---|---|---|
| `lowestHeartRate` [31] | `summaryRows[].rhrLowBpm` | — |
| `restingHrAverage` [31] | `summaryRows[].rhrAvgBpm` | denominator of `normHrMin`; must be non-zero |
| `averageHrv` [31] | `summaryRows[].hrvAvgMs` | rMSSD ms |
| `temperatureAvg` [1] (**latest only**) | `summaryRows[last].tempMeanC` | denominator of `normTempWake` |
| `averageMetMinutes` [30] | `summaryRows[].metAvg` | fever-masked over the 30-window |
| `temperatureDev` [31] | `summaryRows[].tempDevC` | pairs with `temperatureDevBaseline` |
| `totalSleepDuration` [31] | `summaryRows[].sleepDurationHours × 3600` | seconds; `sufficient_sleep_check` ≥ 4 h |

### 1b. History series needing a small derivation (still from existing data)

| Model input | Derivation | Risk |
|---|---|---|
| `gotUps` [31] (wake-up count/night) | **Not stored.** Derive from the night hypnogram: count awakening runs (stage == 4 transitions), OR use `sleep_sessions.restless_periods` as a proxy. Pick one and pin it. | LOW — but the model's Huber scale on `gotUps` is sensitive; validate the choice against a night where the true wake count is known. |
| `longSleepHrv` [31] | Per-night average HRV of the **longest** sleep session (the model's "long_sleep" HRV). We store one `hrvAvgMs` per night already keyed to the main session — reuse it unless a night has multiple sessions, then take the longest. | LOW |
| `highestTemperature` [31] | **Not stored** (we store `tempMeanC`). Take `max(temp_skin °C)` over the night's `0x75`/temp rows. Only used by the fever mask (`> fever_limit 38`) and `enhanced_final_check`. | LOW — fever gate only |
| `temperatureDevBaseline` [31] | The per-night temperature-deviation baseline/limit. `lib/health/temperature-baseline.ts` already computes the deviation; expose the baseline it deviates from (the `temperature_dev_limit` before the luteal correction). | MED — confirm the baseline semantics match ecore's `temperature_dev_limit` |

### 1c. Cycle inputs — male user, all NaN (handled)

`cyclePhase` [31], `interpretedCyclePhase` [30], `nDaysToOvulation` [1], `nDaysToPeriod` [1]. We have no
menstrual-cycle data. Feed `NaN` (and `[NaN]` for the scalars). `determineCyclePhase` fills NaNs from
`cycle_phase[:-1]` then → 0, and `invalidCycle` (|ovulation|>40 ∨ |period|>40 ∨ NaN) selects the
`cycle_phase[last]` branch → `temperature_dev_limit` collapses to `temperature_dev_baseline` alone
(luteal correction × 0). **Verify against a `.pt` run fed all-NaN cycle inputs** that the score is
still produced (it should be — cycle is a temperature-limit nudge, not a gate).

### 1d. Latest-night raw series (the hard part — assembled once, for the most recent night)

| Model input | Source | **GAP?** |
|---|---|---|
| `sleepPhase30Sec` [M] (1=deep 2=light 3=rem 4=awake, **30-sec** epochs) | SleepNet staging pass | **⚠️ GAP 1** — we downsample to a **5-min** hypnogram (`phasesToPhase5Min`) before storage. Need the 30-sec per-epoch stage array (SleepNet runs on 30-sec epochs internally). |
| `hrvItems` [K] (rMSSD samples, 3..255 elems) | `ibiRows` decoded rMSSD for the night | LOW — already decoded for the resilience HR stream |
| `hrvMedianHR5min` [M2] (32..150) + `hrvQuality5min` [M2] (0..100) | per-5-min median-HR-gated HRV + a **quality** score | **⚠️ GAP 2** — we compute gated median HRV (`lib/health/…` median-gated path) but it is unclear we emit a per-5-min **quality** series. If absent, series 8 (`median_hrv_quality_5min`) is unavailable → 21-day gate fails → permanent NaN. |
| `tempSkin` [T] (20..42 °C) + `tempSkinTimestamps` [T] (unix ms) | night `0x75`/temp rows (value + ts) | LOW |
| `bedtimeStart` [1] (unix ms, −1 missing) | `sleepRows[latest].sleepStart.getTime()` | LOW |

### 1e. The four 30-day **intermediate** history series (the design decision — §3)

`sleepFragmentationIndex` [30], `normHrvMedianHR5min` [30], `medianHrvQuality5min` [30],
`normalisedIqr` [30], `normTempWake` [30]. Each element = one prior night's preprocessor output. See §3.

---

## 2. The three real gaps — resolve before/at build time

1. **30-sec hypnogram (GAP 1).** Find where the SleepNet pass holds the 30-sec per-epoch stage vector
   before it is downsampled to 5-min (`stagesToPhase5Min`/`phasesToPhase5Min` in
   `lib/health/hypnogram.ts`, called in the rollup ~line 4258). If the 30-sec array is available in
   scope at the staging site, thread it through to the cumulative-stress step. If only the 5-min form
   survives, either (a) re-expose the 30-sec array from the stager, or (b) upsample 5-min → 30-sec
   (10× repeat) — acceptable for `calculate_sfi` (transition counting is coarser at 5-min, a known
   approximation to note in the Known-Issue), less so for `normalise_temperature_wake`'s per-1-min wake
   matching. **Prefer (a).**
2. **`hrv_quality_5min` (GAP 2).** Determine whether the pipeline emits a per-5-min HRV *quality*
   series. If not, decide: derive a proxy quality (e.g. fraction of valid beats per 5-min bin, scaled
   0–100) — the model only takes its `nanmean/100`, so a coverage-based proxy is defensible — or accept
   that `median_hrv_quality_5min` stays NaN and the score never produces. **A proxy is the pragmatic
   choice; pin it and note it.** This is the single most likely reason a wired score would be
   permanently NaN, so resolve it first.
3. **21-day cold start.** The score is NaN until ≥ 21 complete nights exist in the 31-day window. This
   is expected (resilience has the same shape) — the surface must render a "learning" state, not a
   broken one. No fix needed, just correct empty-state handling.

---

## 3. Intermediate-history strategy — recompute-in-memory (no migration)

The four/five 30-day intermediate series (§1e) are per-night preprocessor outputs. Two options:

- **(A) Persist new columns** (`sfi_latest`, `norm_hrv_median_hr5_latest`, `median_hrv_quality5_latest`,
  `normalised_iqr_latest`, `norm_temp_wake_latest` on `oura_daily_derived`) — a migration, and every
  night's row must be backfilled. More moving parts; a stored-intermediate that can drift (the repo's
  "derive, don't store counters" rule leans against this).
- **(B) Recompute in-memory each rollup pass (RECOMMENDED).** For the trailing 31 nights, run **only the
  feature-engineering half** of the model (the `preprocess` stage's five "latest" outputs) per night
  from that night's raw signals, building the history arrays in memory, then call `runCumulativeStress`
  once for the most recent night with those histories. This mirrors `computeDailySummaries` (nights are
  always re-derived from source — nothing to drift) and needs **no migration**. Cost: ~31× per-night
  raw-signal assembly per rollup — bounded, and the rollup already iterates nights for resilience.
  **Blocker for (B):** it needs the preprocessor's per-night "latest" computation exposed as a callable
  that takes one night's raw signals. Add a small exported helper in `cumulative-stress.ts`
  (`computeNightIntermediates(nightRawSignals)` returning `{sfi, normHrvMedianHR5min,
  medianHrvQuality5min, normalisedIqr, normTempWake}`) — a thin wrapper over the existing (private)
  `preprocess` internals; keep the golden test green (the wrapper is a re-export of already-tested math,
  no algorithm change).

**Decision: (B).** If GAP 2 forces a stored quality proxy, that still lives in-memory. Only revisit (A)
if the 31×-per-pass recompute measurably slows the rollup (it won't at this data scale).

---

## 4. Rollup step (mirror the resilience step exactly)

Add `await step('chronic_stress', async () => { … })` immediately after the `resilience` step in
`aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts`). Contract, copied from resilience:

- **Own step** — a failure here never blocks the summary/illness/resilience/bdi writes.
- **Bounded window** — cap the recompute to the recent span that can actually produce a score
  (`min_days_required 21` + margin, e.g. `CHRONIC_STRESS_MAX_DAYS = 28`); older days keep whatever they
  had. Guard `if (summaryRows.length < 21) return` (can't produce a score below the gate).
- **COALESCE-only upsert** — write **only** `chronicStressScore` + `chronicStressContributors` via
  `upsertOuraDailyDerived`, never clobbering other derived columns (same as resilience writing only its
  `resilience_*` columns).
- **NaN → null** — `runCumulativeStress` returns NaN when it can't produce a score; map NaN → `null`
  before the upsert (the column is INTEGER; never write `NaN`). Store the 5 signed UI contributors
  (`uiFragmentation/uiHeart/uiSleepMotions/uiActivity/uiTemperature`, and/or the raw
  `contributor*`) in the JSONB.
- **Latest-night only** — the score/contributors are written for the most recent night; the in-memory
  histories feed it. (If you also want a per-night score history, loop — but the 21-day gate means only
  recent nights produce anything; start with latest-only.)

`invalidateOuraDaily`/the derived-scores cache group already fire on rollup; confirm the new columns are
read through the same cached read path as the resilience tile (no new cache key needed if the surface
reads `oura_daily_derived` via the existing readiness/derived route).

---

## 5. Surface (pairs with the resilience tile)

A **Chronic Stress** card on the Health page, sibling to the existing Stress-Resilience tile:

- Reads `chronic_stress_score` (0–100) + contributors from the existing derived-scores read path (the
  readiness route already returns `oura_daily_derived` fields — extend it, don't add a new route unless
  needed; match its SWR headers).
- **Colour + label always paired** (`scoreBand()` rule — never colour-only state). Note the polarity:
  higher chronic-stress = worse, opposite to readiness — invert the band mapping and label
  accordingly ("Elevated"/"Moderate"/"Low"), do not reuse readiness's high-is-good bands verbatim.
- Show the 5 UI contributors (fragmentation / heart / sleep-motions / activity / temperature) as the
  breakdown, mirroring how the readiness contributors render.
- **Learning state** for the 21-day cold start (score null) — an explicit "building your baseline
  (N/21 nights)" empty state, never a blank or a fabricated number.
- Safe-area / theme-token / instant-paint (cache-seed) rules apply as for any Health card.

---

## 6. Verification

- **Unit test** `lib/data/postgres/__tests__/…` or a pure assembly test: feed a **synthetic 31-night
  fully-populated** input through the assembly + `runCumulativeStress`, assert a **non-null** score in
  [0,100] and 5 contributors — this proves the assembly wiring produces a score when data is complete
  (the thing the sandbox otherwise can't show). Keep the existing golden test
  (`cumulative-stress.test.ts`) green — the new `computeNightIntermediates` wrapper must not change any
  model output.
- **Rollup smoke** on the local dev DB: the `chronic_stress` step runs without throwing and writes
  `null` (sparse seed data < 21 nights or missing granular signals) — proving the step is wired and
  fails safe, exactly like the resilience step does on the same seed.
- **NOT verifiable in-sandbox (state it in the PR + a Known-Issues row):** a real **non-null** chronic-
  stress score. It requires ≥ 21 nights of real ring data with granular hypnogram/HRV/temp-skin
  signals. **Owner / on-device is the only gate** for "the score is sane vs. Oura's own historical
  ChronicStress." Ship behind the learning-state until an owner worn-history dump confirms a plausible
  value — same posture as BDI's on-device-validation Known-Issue.

---

## 7. Sequencing / scope

Two shippable chunks (each its own PR is fine):

1. **Chunk 1 — rollup wiring (server, sandbox-buildable):** the `computeNightIntermediates` wrapper +
   input assembly + `chronic_stress` rollup step + the synthetic-full-data unit test + rollup smoke.
   Resolve GAP 1 (30-sec hypnogram) and GAP 2 (quality proxy) here. No user-visible change → no version
   bump; module-map row + journal entry. Known-Issue: non-null score not device-verified.
2. **Chunk 2 — surface (client):** the Health Chronic-Stress card + learning state + contributor
   breakdown, reading the derived columns. User-visible → version bump (minor) + changelog. Device-
   smoke (safe-area/theme/instant-paint) or a Known-Issues row per Canonical Runtime.

Do Chunk 1 first; Chunk 2 depends on it. If GAP 2 can't be resolved to a defensible quality proxy, stop
at Chunk 1 with the step wired-but-null and raise the gap to the owner rather than shipping a card that
never populates.

---

## Working rules (from CLAUDE.md)

- Develop on a fresh branch off `origin/main`; PR → 5 green checks → squash-merge. Chunk 1 is a standard
  non-destructive backend change (merge on green without asking); Chunk 2 is user-visible but still
  standard (device-verification gate per Canonical Runtime).
- Run the DB-integration suite before pushing:
  `export DATABASE_URL="postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" && npx vitest run`.
- One-formula rule: the model math lives once in `lib/oura-models/cumulative-stress.ts` — the wrapper
  re-exports it, never re-implements. Do not re-derive constants.
- State what was NOT verified (the non-null score) in the PR body + a `projectOverview.md` Known-Issues
  row.
- Remove the cumulative-stress-wiring backlog entry in the PR that completes Chunk 1 (or annotate it
  "Chunk 1 shipped, Chunk 2 remains" if split).
