# Oura Sleep — Staging, Score, Times, Latency, Efficiency, Breathing (Sub-plan C)

**Date:** 2026-07-15 · **Status:** Planning (docs-only) · **Branch:** `feat/oura-sleep-feature-stack`
· **Runtime:** S25 APK (canonical), BLE-only ring · **Program:** Oura on-device-model reimplementation
(see `docs/superpowers/plans/2026-07-15-oura-models-program-master.md`).

> This is **Sub-plan C** of the program hub. It obeys the cross-cutting architecture in the master
> plan §4 (completed-form storage, vendored SHA-pinned constants, redecode replay, server-side
> compute, device gate, provenance). **Model math is NOT transcribed here** — it lives in the
> `oura-models` skill (`.agents/skills/oura-models/references/sleep-staging.md` + `SKILL.md`) and the
> extracted constants (`C:\Temp\oura_bundle_lite\oura_model_constants\sleepstaging_2_6_0.constants.json`).
> Read those first; this plan is the *plumbing* that wires them into our stager.

---

## 1. Goal & scope

Improve the sleep tier of the BLE-derived pipeline by porting Oura's **portable, 0-param
`sleepstaging_2_6_0` feature-engineering stack** and feeding its richer autonomic-shape features into
our existing stager, so REM stops being chronically under-detected. In the same effort, **persist the
sleep score in completed form** (it is currently recomputed live on every read and never stored for
BLE), and keep the (already-good) sleep-times / onset-latency / efficiency logic — which improves
automatically as stages improve.

**In scope:**
1. **Feature-stack port (primary, Phase 2)** — reimplement `sleepstaging_2_6_0`'s HRV + motion
   feature engineering (0-param) with Oura's rolling-window normalization + RobustScale, and feed it
   into our existing DEEP/REM/light/wake classifier (keep our Viterbi + smoothing + cutoffs).
2. **Optional Tier-B neural route** — if the feature stack still misses the REM baseline, run
   `sleepnet_bdi` (IBI-only, simplest) or `moonstone` (multi-sensor) server-side. Gated, heavier,
   documented but not built up front.
3. **Persist sleep score** to `sleep_sessions.sleep_score` (BLE) **and** to `oura_daily_derived`
   (`sleep_score` + `sleep_contributors`) — stop the live-recompute being the only path.
4. **Breathing rate** — reuse the same RSA/IBI signal but calibrate a night `respiratory_rate` bpm
   (currently discriminative-only, uncalibrated).
5. Keep the window/latency/efficiency derivation; verify it rides the improved stages.
6. Everything recomputes from stored `body_hex` via redecode replay.

**Out of scope:** steps/activity/energy (Sub-plan D), HRV/RHR median gating + readiness + illness
(Sub-plan E), the `oura_daily_derived` table *creation* and constants loader *scaffold* (Sub-plans A
and B respectively — this plan **consumes** them). Sub-plan C must not create either; it depends on
both landing first (master plan §7 ordering: B, A, then E-Phase1 + C).

**Success criteria:**
- On the owner's redecoded reference nights, REM% moves from the current 11–17% into the ~20–28%
  band the frozen Cloud baseline showed, without deep/light/wake regressing (fragmentation QC stable).
- `sleep_sessions.sleep_score` is non-null for every BLE night, and `readiness-score` reads the
  persisted score instead of recomputing it as its primary path.
- All outputs reproduce deterministically from `body_hex` on a redecode (pinned test-vector night).

---

## 2. Current state (cited)

**Stager — `lib/health/sleep-staging.ts` (whole file).** Our own heuristic: wake by actigraphy
(`WAKE_HR_DELTA`, `WAKE_MOVE_MULT`, `WAKE_MOVE_QUANTILE`), DEEP by a fixed per-night z-cutoff
(`DEEP_Z`), REM/light resolved by a 2-state Viterbi over candidate runs (`decodeRemLight`,
`REM_SWITCH`, `REM_Z`), then `smooth()`/`MIN_BOUT`. Inputs are **per-5-min-epoch means** of HR, HRV
(rMSSD), temp, plus two derived REM cues: within-epoch HR spread (`hrVar`) and breathing-rate CV
(`breathVar`). The file's own comments record the ceiling: REM plateaus at **11–17% vs the ~25%
baseline**; `REM_Z` has been dropped 1.0→0.35 across sessions 236–246 with diminishing returns, and
`W_BREATH` raised to 0.7 (session 249) as "the last untried heuristic lever before the SleepNet-model
route." The autonomic signal it keys on is **level** (mean HR/HRV z-scores), not autonomic **shape**.

**Invocation — `lib/data/postgres/adapter.ts:3771–3839`** (inside `aggregateOuraRawSamples`, sig at
`adapter.ts:3585`). When no ring hypnogram exists (always, this ring — `phases.length === 0`), it bins
in-window samples into 5-min epochs (`EPOCH_DS = 5*60*10`), building `SleepEpoch{movement,hr,hrv,temp,
hrVar,breathVar}` at `adapter.ts:3803`, then calls `stageSleepDetailed` (`:3810`) and
`refineOnsetLatencySec` (`:3813`). Stage hours + `sleep_phase_5_min` string persisted at
`adapter.ts:3852–3874` (`stagesToPhase5Min`). Ring emits **no** hypnogram tags (`0x4b/0x4e/0x5a`
absent — the `phasesByTag` path at `:3722` is dormant), so we always self-stage.

**Sleep score — `lib/health/sleep-score.ts`.** `computeSleepScore()` uses open_health's recovered
ecore combiner weights (R²=0.9987) + contributor curves. **It is recomputed live on every read** at
`app/api/readiness-score/route.ts:145` and **never persisted for BLE** — `sleep_sessions.sleep_score`
(schema `lib/data/postgres/schema.ts:321`) is only filled by the frozen Cloud sync. **This is the
GAP.** The sleepRows push at `adapter.ts:3852` does not set `sleepScore`.

**Times / latency / efficiency — already solid.** Window derivation `adapter.ts:3628–3707`: bedtime
`0x76` fragments (rejected unless `>= MIN_BEDTIME_DS`) + clustered `0x72/0x75` sleep-only signals,
merged per night (`MERGE_GAP_DS`), then clamped to the dense-HR span (`clampToDenseSensing`,
`:3694–3707`). `refineOnsetLatencySec` (`sleep-staging.ts:325`) refines onset below the 5-min grid;
efficiency in `summarizeSleepStages` (`sleep-staging.ts:445`). Persisted at `adapter.ts:3866–3872`.
These improve automatically as stages improve — **keep them**.

**Breathing — `lib/health/breathing-rate.ts`.** `breathingFromIbi()` recovers the RSA tachogram and
returns `{rateBrpm, variability}`. Only `variability` (CV) feeds the stager today; `rateBrpm` is
"rough — for display/debug only, not calibrated to Oura" and the night `respiratory_rate`
(`schema.ts:322`) is a plain median of per-epoch rates (`adapter.ts:3804–3809`).

**Redecode replay** — `aggregateOuraRawSamples` is re-run over stored rows via
`app/api/oura-ble/samples/redecode/route.ts:49` (and on ingest, `app/api/oura-ble/samples/route.ts:78`).
Any change here must recompute cleanly from `body_hex`; existing regression tests live in
`lib/data/postgres/__tests__/oura-ble-sleep-*.test.ts`.

---

## 3. Inputs captured over BLE (all present; no capture gap)

| Signal | BLE tag(s) | Decoded field | Fetched at | Oura feature-stack use |
|---|---|---|---|---|
| Movement (actigraphy) | `0x72` sleep_acm_period | `acm_mad` | `adapter.ts:3611` (`sleepSignal`) | MAD_iqr/max/mean, dAngleZ, LIDS, rolling |
| IBI (beats) | `0x80`, `0x60` | `ibi_ms`, `hr_bpm` | `adapter.ts:3605` (`ibiRows`) | all HRV features (rMSSD/HF/LF/VLF/csi/BRV/rRR/ZCI…) |
| HRV | `0x5d` | `rmssd_ms` | `adapter.ts:3606` (`hrvRows`) | rMSSD cross-check / gap-fill |
| Skin temp | `0x75` sleep_temp, `0x46`/`0x69` | `temps_c` | `adapter.ts:3610–3611` | temp rolling features |
| Bedtime window | `0x76` | `bedtime_start_ds`/`end_ds` | `adapter.ts:3603` (`bedtimes`) | `bedtime_input` (window bounds) |

**Timestamps** are `ring_timestamp_ds` (deciseconds since ring epoch) — the plan works in ds and
converts to seconds/ms only where the feature math needs an even grid. Oura's InputValidator expects
ms epoch on a 30-s grid; our redecode already has a `(ringDs ↔ utc)` anchor. The ring emits no
hypnogram, so we always self-stage (Tier A/B classifier, never ring phases).

---

## 4. Model reference (pointers only — do NOT re-transcribe formulas)

- **Feature engineering & post-processing:** `.agents/skills/oura-models/references/sleep-staging.md`
  §1 (`sleepstaging_2_6_0`) — §1.2 HRV low-level features, §1.3 HRV high-level rolling features, §1.4
  motion features (incl. **LIDS**), §1.5 temp, §1.6 demographic, §1.7 time, §1.8 RollingFilters +
  **RobustScale(5,95)**, §1.9 Aggregate_30sec_to_5min + SleepPostprocessor smoothing + QC gates.
- **Gap rationale (why shape beats level for REM):** `SKILL.md` §2 "P2 — Sleep staging".
- **Neural route (Tier B):** `references/sleep-staging.md` §2 (`sleepnet_bdi_0_3_0/0_4_0`, IBI-only)
  and §3 (`sleepnet_moonstone_1_2_0`, multi-sensor) — architecture, scalar normalization, SQ gating.
- **Constants (SHA-pinned):** `sleepstaging_2_6_0.constants.json` — confirmed band edges
  `_hrv_low_model.{LF_BAND=[40,150], HF_BAND=[150,400], VLF_BAND=[3,40]}` in **mHz**
  (`use_millihz=true`); the full ordered feature vectors `_hrv_high_model.in_columnNames` (36 HRV
  cols) and `_sleep_model.all_columns` (motion + temp + demographic + time); QC-gate keys
  (`avg_ibiq`, `hyp_frag`, `p_scored_as_wake`, `rmssd_q95`, `p_ibiq_below85/95`, `p_mad_above_10`,
  `avg_model_conf`); demographic scalars (`demo_age/demo_bmi/demo_sex`); time-feature definitions
  (`time_cosine/decay/linear/hours`). Tier-B weights are in `sleepnet_bdi_*.constants.json` /
  `sleepnet_moonstone_1_2_0.constants.json`. Load all via the **Sub-plan B** typed loader
  (`lib/oura-models/constants/`) — never hardcode a number that exists in the bundle (master §4.2).
- **Caveat (from the skill):** the breathing biquad SOS coefficients (`_br_sosfilt`) are pickled
  buffers not in the readable source. Our existing `breathing-rate.ts` detrend/peak-pick is an
  acceptable substitute for `BR`/`BRV` (it already produces `variability`); the band edges above are
  now confirmed, so HF/LF/VLF power do **not** need the buffer.

---

## 5. Design decisions & algorithm (our plumbing around the ported features)

### 5.1 Grid decision — compute features on Oura's 30-s grid, aggregate to our 5-min epochs
Oura builds features on a **30-s epoch grid** with **1-min and 5-min HRV lookbacks** (≥20 IBIs/window
else NaN), normalizes with a **centered 15-min (window 31)** and **trailing 10-min (window 20)**
rolling mean/std, then **RobustScale(5,95)**, then `Aggregate_30sec_to_5min` (10→1, mode + priority,
force-wake threshold). Our classifier runs at **5-min epochs**.

**Decision:** port the feature stack at the native **30-s grid** (so the rolling windows and spectral
lookbacks match Oura's semantics), then **downsample each feature to our 5-min epoch** by mean (or the
feature's Oura aggregation where specified) to produce an enriched `SleepEpoch`. Computing directly at
5-min would collapse w31/w20 to windows of 3/2 epochs and destroy the normalization's meaning — call
that out as the **degraded fallback** only (§10 risk). Keep our stager's epoch as the classifier unit;
the feature stack is a richer *input builder*, not a replacement classifier.

### 5.2 New feature module — `lib/health/sleep-features.ts`
A new, self-contained, 0-param module (mirrors `breathing-rate.ts`'s shape and null-safety). Exports:
- `hrvFeaturesFromIbi(beats, gridSec)` → per-30-s-epoch HRV feature rows (rMSSD, HF/LF/VLF power via
  the confirmed mHz bands, HFamp/HFmaxf/LFmaxf, **csi** = SD2/SD1, cvNN, **BRV**, **rRR** = lag-1
  autocorr, meanZCI/cvZCI, iqrHR, medianHR, quality) at 1-min & 5-min lookbacks. Resample tachogram to
  4 Hz, periodogram nfft 400/1333, trapz band power — per `references/sleep-staging.md` §1.2. Return
  NaN rows below the ≥20-IBI floor.
- `motionFeaturesFromAcm(acmMad, gridSec)` → MAD_iqr/max/mean, dAngleZ stats, **LIDS**
  (`rolling_mean(1/(x+1))`), rolling median/max/std — §1.4.
- `rollingNormalize(series)` → centered-w31 + trailing-w20 mean/std then `robustScale(5,95)` — §1.3,
  §1.8. Shared `RollingFilters` + `RobustScale` primitives live here (One-Formula-One-Place).
- `enrichEpochs(rawSignals, window)` → the orchestrator: builds 30-s feature frames, normalizes,
  aggregates to 5-min, returns `EnrichedSleepEpoch[]`.

All spectral band edges, column order, and scaler ranges come from the **Sub-plan B constants
loader**, pinned to `sleepstaging_2_6_0.constants.json` — no magic numbers.

### 5.3 Feed the features into our existing classifier (Tier A)
Extend `SleepEpoch` (`sleep-staging.ts:12`) with the high-value REM-discriminating features the skill
names (`SKILL.md` §2): **csi**, **HF power** (low in REM), **BRV**/**rRR**, **meanZCI**/**cvZCI**, and
motion **LIDS**/**dAngleZ** rolling stats for sharper wake. The REM/deep score (`sleep-staging.ts:239,
241`) gains weighted terms for these (small weights, cardiac stays primary — same discipline as
`W_HRVAR`/`W_BREATH`). Because the new features are already RobustScaled per Oura, they enter the score
in normalized units; the existing per-night z-scoring stays for the legacy mean-based terms. **Wake
convention stays our internal `'awake'`** but we document the mapping to Oura's **stage 4** so the
`sleepnet` path (Tier B) and any future ring-phase path agree (skill: "Wake convention = stage 4").

Keep the Viterbi (`decodeRemLight`), `MIN_BOUT` smoothing, onset/offset trim, and mid-blip fold
unchanged in structure. The **hypothesis** (skill P2): richer autonomic-shape features (csi, low HF,
BRV, rRR) break the REM plateau where `REM_Z` alone could not. Re-tune `REM_Z`/`REM_SWITCH`/the new
weights against the pinned redecoded night; proportions still float with the data.

### 5.4 Optional Tier-B neural route (gated — do not build unless Tier A fails)
If, after Tier A + retune, REM still misses the ~20–28% band on the reference nights, add
`lib/health/sleepnet/` running `sleepnet_bdi_0_3_0` (IBI-only, simplest inputs, 291K params)
server-side. Weights ship per Sub-plan B; inference is **server-side only** (master §4.4 — no PyTorch
in the WebView), via ONNX (export TorchScript→ONNX offline, run `onnxruntime-node`) since the `.pt`
classifier is a custom native op. Demographic scalar normalization (age default 35 / clamp[10,100] /
round-5 / ÷100; bmi 26 / [10,80] / ÷100; sex {-1,0,1}; ring_model {3:-1,4:1}) and SQ gating (TST ≥ 180
min, IBI coverage ≥ 70%) per `references/sleep-staging.md` §2. `moonstone` (multi-sensor + apnea +
SpO₂) is the heavier fallback. **This is Phase 3** in the program; ship Tier A first, measure, then
decide. Tier B writes the same completed-form outputs (§6) with `stager: 'sleepnet_bdi'` provenance.

### 5.5 Breathing-rate calibration
Keep `breathingFromIbi` as the discriminative `variability` source. For the persisted night
`respiratory_rate`, continue medianing per-epoch `rateBrpm` but **document it as an uncalibrated
estimate** (provenance `ble-derived`, not Oura-parity) — the biquad kernel needed for Oura-exact bpm
is an unrecovered buffer (§4 caveat). No new calibration target is introduced; this is a
labelling/provenance clarification, not new math.

---

## 6. Storage (completed form)

Per master §4.1, every derived metric is persisted in completed form in the same PR that computes it —
recompute is only the backfill path.

**A. `sleep_sessions` (existing table).**
- **Write `sleep_score`** (`schema.ts:321`, currently Cloud-only) in the sleepRows push
  (`adapter.ts:3852`): call `computeSleepScore(builtSession, tz)` after building each night's row and
  set `sleepScore = result?.score ?? null`. Add `sleepScore` to the `OuraSleepUpsertRow` type and the
  upsert column list / `rowToX` mapper (guard against the "missed field fails silently" class,
  CLAUDE.md §AI-security). The Cloud upsert already sets it; use `COALESCE`-style precedence so a real
  Cloud value (frozen) is not clobbered by a BLE recompute for pre-re-key nights, but BLE nights
  (Cloud null) get the derived score.
- Stages / stage-hours / `sleep_phase_5_min` / efficiency / `onset_latency_sec` / `respiratory_rate`:
  already persisted — unchanged shape, improved values.

**B. `oura_daily_derived` (created by Sub-plan A).** Write per user per local day:
- `sleep_score` (int) and `sleep_contributors` (JSONB — the `components` map from
  `computeSleepScore`: totalSleep/efficiency/rem/deep/latency/timing/restfulness sub-scores).
- Provenance columns (master §4.6): `sleep_source` = `'ble-derived'`, `sleep_stager` =
  `'feature-stack-v1'` | `'sleepnet_bdi'`, `constants_version` from the loaded bundle.
- If Sub-plan A's schema does not yet have `sleep_score`/`sleep_contributors` columns, this PR adds the
  migration for them (claim the next migration number against the directory **and** open PRs/plans per
  CLAUDE.md; register any new local-SQLite mirror in `RECONCILE_TABLES`/`RECONCILE_COLUMNS`). These are
  additive nullable columns — non-destructive.

No raw feature frames are persisted (they are re-derivable from `body_hex`); only the finished score +
contributors + stage summary. This keeps the culling goal (master §5) intact.

---

## 7. Plumbing (rollup, read sites, cache, redecode)

**Rollup — `aggregateOuraRawSamples` (`adapter.ts`).**
1. Replace the inline epoch-mean builder (`adapter.ts:3781–3803`) with a call to
   `enrichEpochs(rawSignals, window)` from the new module, producing `EnrichedSleepEpoch[]`. The raw
   per-tag binning (movement `0x72`, IBI `0x80/0x60`, temp `0x75/0x46/0x69`, HRV `0x5d`) stays but now
   also feeds the 30-s feature frames. The existing `onsetSamples`, `debugNight` capture
   (`:3815–3838`), and dense-sensing clamp (`:3694–3707`) are untouched.
2. After `stageSleepDetailed` (`:3810`), build the `SleepSession`-shaped object and call
   `computeSleepScore` → set `sleepScore` on the pushed row (§6A) and stage the
   `oura_daily_derived` write alongside the existing `nightInputsByDate` accumulation (`:3902`).
3. Keep each write step isolated (`adapter.ts:3918` "Each write step is isolated") — a bad sleep-score
   compute must not wedge the rollup; wrap in try/`null`.

**Read sites.**
- `app/api/readiness-score/route.ts:145` — change from **compute** to **read** the persisted
  `sleep_score` (from `oura_daily_derived` / the sleep session), with `computeSleepScore` as the
  compute-and-persist fallback only when the day's row is missing (master §4.1). The internal 0–40
  sleep term (`:146–148`) reads the persisted score. This removes the per-paint recompute.
- Any Health sleep card / `sleep-sessions` reader already reads `sleep_sessions` — it now gets a
  non-null `sleepScore` for BLE nights automatically. Grep for other `computeSleepScore` callers and
  point them at the persisted value (sibling-surface sweep, CLAUDE.md §Process).

**Cache groups (`lib/cache-groups.ts`).** No new keys — sleep already invalidates via
`invalidateBiometricSync()` / the sleep/readiness group (`cache-groups.ts:88,117–125,146–162`:
`sleep-sessions`, `readiness-score`, `sleep-performance-correlation`, `oura-stats`). Confirm the
`oura_daily_derived` write is covered by the same group (Sub-plan A registers it); if not, add
`readiness-score` + `sleep-sessions` invalidation to the derived-table write in this PR.

**Redecode replay (master §4.3).** Because all of the above lives inside `aggregateOuraRawSamples`,
re-running `POST /api/oura-ble/samples/redecode` (`route.ts:49`) recomputes features → stages → score →
`oura_daily_derived` from stored `body_hex` with no re-drain. The score/contributor writes must be
**idempotent upserts** keyed on `(user_id, date)` so a redecode overwrites cleanly.

---

## 8. Phased task list

**Phase 0 — dependencies (must land first):** Sub-plan B (constants loader `lib/oura-models/constants/`)
and Sub-plan A (`oura_daily_derived` table + rollup write scaffold). Do not start C until both are on
`main`.

**Phase A1 — feature module (no behaviour change yet).**
1. `lib/health/sleep-features.ts`: `RollingFilters`, `RobustScale(5,95)`, `hrvFeaturesFromIbi`,
   `motionFeaturesFromAcm`, `rollingNormalize`, `enrichEpochs`. Load bands/columns/scalers from the
   Sub-plan B loader. Unit-test each primitive against a hand-computed vector.
2. Extend `SleepEpoch` (`sleep-staging.ts:12`) with the new optional feature fields (all nullable,
   self-neutralizing when absent — same pattern as `hrVar`/`breathVar`).

**Phase A2 — wire into stager + rollup.**
3. Add weighted REM/deep/wake terms for csi/HF/BRV/rRR/ZCI/LIDS in `sleep-staging.ts` (small weights;
   cardiac primary). Document wake↔stage-4.
4. Swap the inline epoch builder in `adapter.ts:3781–3803` for `enrichEpochs`.
5. Re-tune `REM_Z`/`REM_SWITCH`/new weights against the pinned redecoded reference night.

**Phase A3 — persist sleep score (completed form).**
6. Write `sleep_sessions.sleep_score` in the sleepRows push; add to `OuraSleepUpsertRow` + upsert cols
   + mapper.
7. Write `oura_daily_derived.sleep_score` + `sleep_contributors` + provenance; migration for the
   columns if absent.
8. Convert `readiness-score` (and any other `computeSleepScore` caller) to read-persisted-first,
   compute-fallback.

**Phase A4 — breathing provenance.**
9. Label `respiratory_rate` as uncalibrated `ble-derived`; no math change.

**Phase B (optional, gated on A results, Program Phase 3).**
10. Only if REM still misses baseline: `lib/health/sleepnet/` + TorchScript→ONNX export + server
    inference (`onnxruntime-node`), scalar normalization + SQ gating, provenance `sleepnet_bdi`.

Each phase is a self-contained commit on `feat/oura-sleep-feature-stack`; A1–A4 ship as one PR
(feature stack + score persistence together, since the retune needs the persisted comparison). Fold
the journal / `projectOverview.md` / version bump into the same PR before merge (CLAUDE.md).

---

## 9. Testing & verification

**Unit (Vitest, alongside `lib/data/postgres/__tests__/oura-ble-sleep-*.test.ts`):**
- Each feature primitive (`RobustScale`, rolling w31/w20, csi, HF/LF/VLF band power, LIDS, rRR) vs a
  hand-computed fixture; verify NaN-safety on sparse windows (<20 IBI).
- `computeSleepScore` persistence: rollup sets `sleep_sessions.sleep_score` and
  `oura_daily_derived.sleep_score` non-null for a synthetic BLE night; Cloud precedence preserved.
- `readiness-score` reads the persisted score (mock the derived row present) and only recomputes when
  absent.

**Pinned redecoded-night test vector (the load-bearing one, per master §4.5 + Oura-BLE decoder
discipline):** capture (or reuse an existing) real overnight `body_hex` volume for one of the owner's
reference nights, commit it as a fixture, and assert:
- REM% lands in the target band and deep/light/wake/fragmentation stay within tolerance of the manual
  expectation (guards the "did the feature stack actually break the plateau" claim — do not mark REM
  fixed from intent, CLAUDE.md §Communication).
- Full redecode reproduces byte-identical stage string + score from `body_hex` (idempotent replay).
- Boundary test at 23:59/00:01 user-local (date-arithmetic rule) for the night→wake-day assignment.

**Device gate (S25 APK — the only real target, master §4.5 + Canonical Runtime).** Sleep staging is
BLE + offline-first, so green `pnpm dev` is necessary-not-sufficient. Run
`docs/device-smoke-checklist.md` for the Health sleep ribbon + sleep score chip on the S25 after a
real night, OR add a `projectOverview.md` Known-Issues row marking the change **not device-verified
in-session**. State explicitly which surfaces were not exercised (native SQLite, real BLE volume,
WebView render) when presenting.

**Sandbox note:** the feature math and score persistence run in `pnpm dev` against the local Postgres,
but the *stage quality* claim can only be judged on real redecoded `body_hex` — the fresh local seed
has no representative overnight IBI density.

---

## 10. Risks

1. **REM still plateaus after Tier A.** Mitigation: the whole point of the richer features; if it
   fails, the pinned-vector test surfaces it and the gated Tier-B (sleepnet_bdi) is the fallback —
   documented, not forced. Do not over-tune weights to one night (overfit risk).
2. **30-s grid port cost.** Building the full feature stack at 30-s resolution is materially more code
   than the 5-min degraded fallback. Mitigation: land the primitives + tests first (A1) so the
   normalization is proven before wiring; if timeboxed, the 5-min fallback is a documented degraded
   path (worse REM, but not a regression vs today).
3. **Spectral band buffers.** HF/LF/VLF edges are now **confirmed** from the constants file (mHz), but
   the breathing biquad SOS is not — we substitute our existing detrend/peak-pick (acceptable, §4).
4. **Score double-write / Cloud clobber.** BLE recompute must not overwrite a frozen Cloud
   `sleep_score` for pre-re-key nights. Mitigation: precedence guard (§6A) + test.
5. **Redecode idempotency.** Non-idempotent derived-table writes would drift on replay. Mitigation:
   upsert on `(user_id, date)`; covered by the replay test.
6. **`oura_daily_derived` not yet shipped.** Hard dependency on Sub-plans A + B; C is blocked until
   both merge (do not stub the table in C).
7. **Tier-B server inference weight/latency.** ONNX model + `onnxruntime-node` adds bundle + cold-start
   cost server-side; gated to Phase 3 precisely to avoid paying it unless needed.

---

## 11. Backlog entry

`feat/oura-sleep-feature-stack` — Port Oura's `sleepstaging_2_6_0` 0-param feature stack (HRV
csi/HF/LF/VLF/BRV/rRR/ZCI + motion LIDS/dAngleZ, rolling w31/w20 + RobustScale) into
`lib/health/sleep-staging.ts` to break the REM plateau, persist the sleep score in completed form
(`sleep_sessions.sleep_score` + `oura_daily_derived`), and replay from `body_hex`. Depends on Sub-plans
A + B. Tier-B `sleepnet_bdi` neural route gated on Tier A missing the REM baseline.
