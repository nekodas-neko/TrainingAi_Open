# Training Stress Score (OTS) + VO₂max Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Oura's **Training Stress Score** (OTS, model `training_stress_score_0_2_1`) as our own on-device compute — a whole-day training-load number derived from the ring's MET stream, weighted by RHR-fitness category / VO₂max category, gated by readiness. It was the last frozen-Cloud metric blocked purely on its two inputs (`readiness`, `vo2max`); both are now derivable ourselves, so this plan (1) adds a **VO₂max derivation module** (`lib/health/vo2max.ts`), (2) ports the **OTS core** to a golden-verified inference module, (3) adds the **input-assembly compute** that reads our persisted/derived readiness + derived VO₂max + the day's MET series and persists the result to `oura_daily_derived.training_load_ots`/`training_load_high` (columns already exist), and (4) **surfaces** a "Training Stress" number on the workout done-screen next to the calorie estimate and on the health Training-Load card — with graceful gating whenever readiness is still learning.

**Architecture:** OTS is a **0-trainable-parameter algorithmic TorchScript model** (validator → preprocessor → processor + a `vo2max_numeric_to_category` lookup + a MET-intensity weight norm — no weights, all control flow), so its parity proof is a faithful **TypeScript port pinned to a captured golden vector** from the original `.pt`, exactly the discipline the ONNX cores use (`lib/oura-models/onnx/README.md`: "Golden input/output vectors … the durable parity proof"). Its load-bearing constants are **already vendored** (`lib/oura-models/constants/training_stress_score_0_2_1.constants.json`, exposed via `getOtsConstants()`), and its two DB destination columns (`training_load_ots`, `training_load_high`) **already exist** on `oura_daily_derived` — so this plan adds **no migration**. Readiness comes from our own persisted composite (`oura_daily_derived.readiness_score`, `readinessSource: 'ble-derived'`, written by `/api/readiness-score`), never the frozen `oura_daily.readiness_score`. VO₂max is a new One-Formula-One-Place module; it is **explicitly optional** to the OTS core (the model's own validator states VO₂max "can be NaN", and the processor falls back to RHR-category weighting when the category is NaN) — so VO₂max still learning degrades to a slightly-less-personalised OTS, whereas readiness still learning **gates** OTS entirely (readiness is a hard-validated 0–100 input; NaN is rejected).

**Tech Stack:** TypeScript; `lib/health/vo2max.ts`, `lib/oura-models/inference/ots.ts`, `lib/health/training-stress.ts`, a `GET /api/training-stress` route, `components/workout/done-screen.tsx` + `app/health/health-sections.tsx`; vendored constants (`lib/oura-models/constants/index.ts`), Drizzle repo (`getOuraDailyDerived`/`upsertOuraDailyDerived`, `getOuraDaytimeSignals` for the MET stream), vitest with a golden `.bin` fixture.

---

## Why now

Backlog holding pen (`docs/implementation-backlog.md:165-167`): *"⛔ Frozen Oura Cloud: OTS training-stress (`remaining §2` / P-D) … need Cloud-frozen readiness/vo2max/contributors → derive-ours-or-gate first (this is the real blocker, not the model)."* Both blockers are now cleared:

- **Readiness is already derived + persisted.** `/api/readiness-score` computes `computeReadinessComposite` (`lib/health/readiness-composite.ts`) on the Cloud-null path and writes it to `oura_daily_derived` (`readinessScore`, `readinessSource: 'ble-derived'`, `route.ts:342-352`). `readinessDisplayScore` is the display value (`route.ts:312-314`).
- **VO₂max is derivable** — every input already lives in the DB (RHR, age via DoB, sex, HRmax via `hrMaxFromAge`, weight, height, activity level). No new profile field, no migration.

With the inputs solved, the model itself is trivial to run (it's an algorithm, constants already vendored). This is the last unblocked P-D derivation.

**Branch:** `feat/training-stress-score`

**Lane assignment — Oura-derivation SERIAL track (do NOT run as a parallel lane).** This is the **P-D derivations (OTS)** item at the tail of the serial track (`docs/implementation-backlog.md:137-149`). It edits the shared god-files (`app/api/readiness-score`-adjacent readiness read, `lib/data/postgres/adapter.ts`/`slices/oura.ts` for the MET read + derived upsert) and reads persisted readiness that other serial-track items write — so it must run **one implementer at a time**, after the readiness/illness/stress items ahead of it, never concurrently with another Oura-cluster session. The truly-parallel lanes (1–5) don't touch these files; this does. Sequence it **last** among the OTS-dependency chain (it consumes derived readiness + derived VO₂max, produces nothing others read).

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **OTS core = faithful TS port pinned to a golden vector, NOT a TorchScript→ONNX export.** OTS has **0 trainable parameters** — it is pure control flow (loops over the `[24×6]` VO₂max threshold table, RHR-percentile `argmin`, a 720-wide sliding window, `RaiseException` guards). The ONNX cores exist because they're *neural* (weights we can't otherwise run); the README already documents that torch's TorchScript→ONNX path is **broken for these graphs** and each neural core had to be *rebuilt native*. There are no weights to rebuild here — porting the algorithm to TS is both simpler and exact. The **golden-verify discipline is identical**: capture `(inputs → outputs)` from the original `.pt` (owner-run, decrypted archive) into `__fixtures__/`, and assert the TS port matches to `< 1e-3`, exactly as `energy.test.ts` asserts the ONNX head against its `.bin` reference. If a future maintainer insists on ONNX, `scripts/oura-models/export-onnx.py` is the place — but the golden fixture is the real parity proof either way.
2. **VO₂max lives once, in `lib/health/vo2max.ts` (One Formula, One Place).** **Uth–Sørensen** `VO₂max ≈ 15.3 × HRmax / HRrest` is the primary estimate (simple, ring-friendly — we always have RHR + an HRmax). **Jackson non-exercise** (age/sex/BMI + activity→PA-R) is the cross-check / fallback when RHR is missing. HRmax prefers a **measured** max from `activity_logs.max_hr` (latest non-null) and falls back to `hrMaxFromAge(age)` = 220−age (`lib/health/hr-zones.ts`). Output clamped to the OTS validator's `[10,100]` range. Because OTS only ever **buckets** VO₂max into a low/fair/high/peak category by age/sex (`vo2max_numeric_to_category`), absolute precision matters far less than landing in the right band — a documented reason the simple Uth–Sørensen estimate is adequate here.
3. **VO₂max is optional to OTS; readiness is mandatory.** Pass VO₂max as `NaN` when we can't derive it — the model's validator explicitly allows NaN (`error_code_to_message[9]`: "VO2max … can be NaN") and the processor falls back to `rhr_weights[rhr_category]` (`___torch_mangle_2.py:49-60`). Readiness is validated `0–100`, NaN rejected — so **if persisted readiness is null or still `provisional` (composite `nHistory < BASELINE_MIN_NIGHTS = 14`), gate OTS**: return `null` with a `reason`, never fabricate a readiness value. This is the "degrade gracefully (gate, don't fabricate)" rule.
4. **OTS persists to the existing derived columns, never to the Cloud-COALESCE row.** Write `trainingLoadOts` (the day's OTS value) + `trainingLoadHigh` (the model's `ots_high_low`, i.e. OTS above the high threshold) to `oura_daily_derived` via `upsertOuraDailyDerived` (COALESCE, best-effort — a persist failure must never fail the read). **Never** write `oura_daily.vo2_max` (that column is COALESCE-fed from Cloud and is frozen; our derived VO₂max, if we store it at all, goes only to `oura_daily_derived`).
5. **The surface is a single daily number, gated.** OTS is a whole-day rolling metric, not per-set — the done-screen shows it next to the existing `~kcal · intensity` line (both are "what did today's training cost you" readouts), and the health Training-Load card gets it too. When gated (readiness learning) the number simply doesn't render — no skeleton, no fabricated value, mirroring how the readiness chip hides itself when the composite isn't ready.
6. **MET series = the ring's 1-min 0x50 stream.** `getOuraDaytimeSignals` returns `met: {tsMs, value}[]` from tag `0x50`; the existing rollup treats consecutive 0x50 MET values as **1-minute-spaced** (`adapter.ts:3895`, `ds + i*600` deciseconds = +60 s). A full worn day yields ~1440 samples; OTS needs ≥720 in the window with ≥360 valid (`processor` NaN-gates below 360). Days with too little MET data → OTS `null` (gate), same as insufficient readiness.

## Verified current state (2026-07-16)

- **OTS model card:** `docs/oura-models/readable/training_stress_score_0_2_1.md`. `forward(start_timestamp, mets, age, biological_sex, rhr, no_ots, tz_change, readiness, vo2max)`. `tz_change==1` → raises (gate). Source: `scripts/oura-models/_source/training_stress_score_0_2_1/` — `_mangle_0` Validator (ranges: rhr∈[30,100], readiness∈[0,100], vo2max NaN-ok else [10,100], sex∈{-1,0,1}), `_mangle_1` Preprocessor (`get_age_group`, `get_rhr_category` via percentile `argmin`, `get_met_values_1min` = clean `<0.9`→NaN + 60 s-stride timestamps), `_mangle_2` Processor (720-window weighted mean ÷ `sum(met_weights)`, NaN if valid<360, × `vo2max_weights[cat]` or `rhr_weights[rhr_cat]` when VO₂max NaN, clamp ≥0.9), `_mangle_4` `vo2max_numeric_to_category` (`[24×6]` table: `[sex∈{0,1}, age_min, age_max, low_fair, fair_high, high_peak]`; female=-1→group 0, male/other→group 1; category 0/1/2/3 or NaN), `_mangle_5` `met_intensity_weight_norm` (clamp 1..10, `x=(met−1)/9`, `x^γ·(M−1)+1`).
- **Constants vendored:** `lib/oura-models/constants/training_stress_score_0_2_1.constants.json` (all tensors: `vo2max_thresholds` 24×6, `vo2max_weights` [1.2,1.133,1.067,1.0], `rhr_weights` [10], `met_weights` [720], `female/male/other_percentiles`, `female_and_male_age_groups`/`other_age_groups`, `min_met_value` 0.9, `high_ots_threshold` 4.0, `met_intensity_M` 8.0, `met_intensity_gamma` 1.0, `use_met_intensity_weights` true). Accessor: `getOtsConstants()` (`lib/oura-models/constants/index.ts:189-192`, doc-comment already warns "Window/resample contract must be pinned against a test vector before use").
- **ONNX/golden reference pattern:** `lib/oura-models/inference/energy.ts` + `__tests__/energy.test.ts` read a `.bin` fixture and assert `< 1e-3` vs a TorchScript-captured reference; fixtures in `lib/oura-models/onnx/__fixtures__/*.bin`.
- **Readiness inputs:** `/api/readiness-score` persists `oura_daily_derived.readiness_score` + `readinessSource: 'ble-derived'` (`route.ts:342-352`); composite is neutral/`provisional` until `BASELINE_MIN_NIGHTS = 14` nights (`readiness-composite.ts:15,74`). `readinessDisplayScore` at `route.ts:312-314`.
- **VO₂max inputs:** RHR `body_metrics.resting_heart_rate` (`schema.ts:213`); age `ageFromDob(users.date_of_birth, now)` (`lib/date-utils.ts:129`); sex `users.sex` ('male'|'female'|'other'|null, `types/user.ts:21`); HRmax `hrMaxFromAge(age)` (`lib/health/hr-zones.ts:9`); measured max `activity_logs.max_hr` (`schema.ts:287`); weight `body_metrics.weight_kg` (`schema.ts:205`); height `users.height_cm` (`types/user.ts` `heightCm`); activity `users.activity_level` (`ACTIVITY_LEVELS`, `types/user.ts:1`).
- **MET source:** `adapter.ts` `getOuraDaytimeSignals(userId, from, to)` → `{ temp, met: {tsMs,value}[] }` from tag `0x50` (`adapter.ts:3570-3605`); 1-min cadence (`adapter.ts:3895`).
- **Derived columns exist:** `oura_daily_derived.trainingLoadOts` (`doublePrecision`), `.trainingLoadHigh` (`boolean`) — `schema.ts:810-811`, `repository.ts:880-881`, mapped in `slices/oura.ts:635,678-679`. **No migration needed.** `OuraDailyDerivedPatch` is a `Partial<Omit<…,'day'>>` COALESCE upsert (`repository.ts:900`).
- **Surfaces:** done-screen already fetches `/api/workout-sessions/[id]/energy` and renders `~{kcal} kcal · {intensity} effort` (`done-screen.tsx:87,381-386`); health has a `trainingLoad: TrainingLoadResponse` card (`health-sections.tsx:105,585`) fed by `/api/training-load`. VO₂max already displays on `app/health/heart-rate/page.tsx:112-117` from `oura_daily.vo2Max` (Cloud) — leave that; our derived value is separate.
- **No existing OTS/VO₂max-derivation code:** `grep` finds only the vendored constants, the Cloud `vo2_max` webhook ingest, and the empty derived columns — nothing computes OTS or derives VO₂max today.

## File structure

**Create:**
- `lib/health/vo2max.ts` — VO₂max derivation (Uth–Sørensen primary + Jackson NEX cross-check) + `Vo2MaxResult` type.
- `lib/health/__tests__/vo2max.test.ts` — formula tests + boundary/clamp/missing-input cases.
- `lib/oura-models/inference/ots.ts` — OTS core port (`runTrainingStressScore`) + input type.
- `lib/oura-models/inference/__tests__/ots.test.ts` — golden-vector parity + no-data/gate cases.
- `lib/oura-models/onnx/__fixtures__/training_stress_score_0_2_1_input.json` + `…_output.json` — captured golden vectors (owner-run; see Task 3 Step 1).
- `lib/health/training-stress.ts` — input assembly (`computeTrainingStress`): reads readiness + VO₂max + MET, calls the core, returns `{ ots, high } | { gated: reason }`.
- `lib/health/__tests__/training-stress.test.ts` — assembly + gating tests.
- `app/api/training-stress/route.ts` — `GET ?date=` → assembles, persists to derived (best-effort), returns the value (+ SWR headers, rate limit matching siblings).
- `components/workout/training-stress-badge.tsx` — the done-screen number (self-hides when gated).

**Modify:**
- `lib/oura-models/constants/index.ts` — a typed `getOtsConstants()` unwrapper (tensor `values` → typed arrays) if the raw accessor is too loose for the port.
- `components/workout/done-screen.tsx` — fetch + mount the badge next to the energy line.
- `app/health/health-sections.tsx` (+ its data hook / `/api/training-load` or a small addition) — show the daily Training-Stress number on the Training-Load card.
- `lib/changelog.ts` + `package.json` version; journal + `projectOverview.md` index; remove the backlog entry (final task).

---

### Task 1: `lib/health/vo2max.ts` — the one VO₂max derivation

**Files:**
- Create: `lib/health/vo2max.ts`, `lib/health/__tests__/vo2max.test.ts`

One Formula, One Place: every VO₂max estimate in the app comes from here. Uth–Sørensen primary, Jackson non-exercise cross-check/fallback, clamped to the OTS-valid `[10,100]`.

- [ ] **Step 1: Write the failing tests** (`lib/health/__tests__/vo2max.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { deriveVo2Max, jacksonNonExercise, PA_R_BY_ACTIVITY } from '../vo2max'

describe('deriveVo2Max', () => {
  it('Uth–Sørensen: 15.3 × HRmax/HRrest when RHR + HRmax present', () => {
    // HRmax 185 (measured), RHR 50 → 15.3 * 185/50 = 56.61
    const r = deriveVo2Max({ restingHr: 50, measuredMaxHr: 185, age: 35, sex: 'male', weightKg: 80, heightCm: 180, activityLevel: 'moderate' })
    expect(r.method).toBe('uth-sorensen')
    expect(r.value).toBeCloseTo(56.6, 1)
  })

  it('falls back to age-predicted HRmax (220 − age) when no measured max', () => {
    const r = deriveVo2Max({ restingHr: 55, measuredMaxHr: null, age: 40, sex: 'female', weightKg: 65, heightCm: 165, activityLevel: 'light' })
    expect(r.method).toBe('uth-sorensen') // 15.3 * 180/55 = 50.07
    expect(r.value).toBeCloseTo(50.1, 1)
  })

  it('falls back to Jackson NEX when RHR is missing', () => {
    const r = deriveVo2Max({ restingHr: null, measuredMaxHr: null, age: 30, sex: 'male', weightKg: 78, heightCm: 178, activityLevel: 'active' })
    expect(r.method).toBe('jackson-nex')
    expect(r.value).toBeGreaterThan(30)
    expect(r.value).toBeLessThan(70)
  })

  it('returns null when neither model has enough inputs (age missing)', () => {
    expect(deriveVo2Max({ restingHr: null, measuredMaxHr: null, age: null, sex: null, weightKg: null, heightCm: null, activityLevel: null }).value).toBeNull()
  })

  it('clamps into the OTS-valid [10,100] range', () => {
    const r = deriveVo2Max({ restingHr: 30, measuredMaxHr: 210, age: 20, sex: 'male', weightKg: 70, heightCm: 180, activityLevel: 'extra_active' })
    expect(r.value! <= 100).toBe(true) // 15.3*210/30 = 107.1 → clamped 100
    expect(r.value).toBe(100)
  })
})

describe('jacksonNonExercise', () => {
  it('matches the published constants (male, PA-R for activity)', () => {
    // 56.363 + 1.921*PA_R - 0.381*age - 0.754*BMI + 10.987*sexMale
    const paR = PA_R_BY_ACTIVITY.moderate
    const bmi = 80 / (1.8 * 1.8)
    const expected = 56.363 + 1.921 * paR - 0.381 * 35 - 0.754 * bmi + 10.987 * 1
    expect(jacksonNonExercise({ age: 35, sex: 'male', bmi, activityLevel: 'moderate' })).toBeCloseTo(expected, 4)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/health/__tests__/vo2max.test.ts` → FAIL (module absent).

- [ ] **Step 3: Implement `lib/health/vo2max.ts`.** Encode the two formulas and the PA-R mapping as the module's single source; document the citations in comments (Uth et al. 2004; Jackson et al. 1990 non-exercise BMI model). Shape:

```typescript
import { hrMaxFromAge } from './hr-zones'
import type { ActivityLevel } from '@/lib/types/user'

/** Physical-Activity Rating (0–7) per self-reported activity level — the Jackson NEX
 *  PA-R term. These are THIS module's calibration constants (One Formula, One Place). */
export const PA_R_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 0, light: 2, moderate: 4, active: 5, extra_active: 7,
}

export interface Vo2MaxInputs {
  restingHr: number | null
  measuredMaxHr: number | null   // from activity_logs.max_hr (preferred over age-predicted)
  age: number | null
  sex: string | null            // 'male' | 'female' | 'other' | null
  weightKg: number | null
  heightCm: number | null
  activityLevel: ActivityLevel | null
}

export interface Vo2MaxResult {
  value: number | null           // ml/kg/min, clamped [10,100], or null if underivable
  method: 'uth-sorensen' | 'jackson-nex' | null
  crosscheck: number | null      // the OTHER model's value when both computable (for provenance/UI)
}

const clamp = (v: number) => Math.max(10, Math.min(100, v))

/** Jackson et al. (1990) non-exercise model (BMI form). sex: male=1 else 0. */
export function jacksonNonExercise(
  { age, sex, bmi, activityLevel }: { age: number; sex: string | null; bmi: number; activityLevel: ActivityLevel },
): number {
  const paR = PA_R_BY_ACTIVITY[activityLevel]
  const sexMale = sex === 'male' ? 1 : 0
  return 56.363 + 1.921 * paR - 0.381 * age - 0.754 * bmi + 10.987 * sexMale
}

export function deriveVo2Max(i: Vo2MaxInputs): Vo2MaxResult {
  // Uth–Sørensen: VO2max ≈ 15.3 × HRmax / HRrest. Prefer a measured max; else 220 − age.
  let uth: number | null = null
  if (i.restingHr != null && i.restingHr > 0 && i.age != null) {
    const hrMax = i.measuredMaxHr ?? hrMaxFromAge(i.age)
    uth = clamp(15.3 * (hrMax / i.restingHr))
  }
  // Jackson NEX: needs age, weight, height, activity.
  let jax: number | null = null
  if (i.age != null && i.weightKg != null && i.heightCm != null && i.heightCm > 0 && i.activityLevel != null) {
    const bmi = i.weightKg / ((i.heightCm / 100) ** 2)
    jax = clamp(jacksonNonExercise({ age: i.age, sex: i.sex, bmi, activityLevel: i.activityLevel }))
  }
  if (uth != null) return { value: uth, method: 'uth-sorensen', crosscheck: jax }
  if (jax != null) return { value: jax, method: 'jackson-nex', crosscheck: null }
  return { value: null, method: null, crosscheck: null }
}
```

- [ ] **Step 4: Run to verify + commit** — `npx vitest run lib/health/__tests__/vo2max.test.ts` → PASS.

```bash
git add lib/health/vo2max.ts lib/health/__tests__/vo2max.test.ts
git commit -m "Add VO2max derivation (Uth–Sorensen primary, Jackson non-exercise fallback)"
```

---

### Task 2: OTS core port — `lib/oura-models/inference/ots.ts`

**Files:**
- Create: `lib/oura-models/inference/ots.ts`
- Modify (if needed): `lib/oura-models/constants/index.ts` (typed OTS constants unwrapper)

Port `_mangle_0/1/2/4/5` faithfully against the vendored constants. This is a pure-function port — no `onnxruntime`. Structure it in the same infallible shape as the ONNX inference modules (return `null` on any gate/failure, never throw — the core's own `RaiseException` paths become `null` returns).

- [ ] **Step 1: Implement the port.** Read the five source files (`scripts/oura-models/_source/training_stress_score_0_2_1/___torch_mangle_{0,1,2,4,5}.py`) and translate line-for-line. Contract:

```typescript
export interface OtsInput {
  startTimestampMs: number
  mets: Float32Array          // 1-min MET series (get_met_values_1min cleans <0.9 → NaN)
  age: number
  biologicalSex: -1 | 0 | 1   // female=-1, other=0, male=1
  rhr: number                 // 30..100
  noOts: 0 | 1
  tzChange: 0 | 1
  readiness: number           // 0..100 (hard-validated; caller must not pass NaN)
  vo2max: number              // may be NaN → processor uses rhr_weights
}

/** Returns the day's OTS value + whether it exceeds the high threshold, or null when the
 *  model can't produce a result (validation failure, tz change, <360 valid MET minutes,
 *  no_ots short-circuit). Infallible: never throws. */
export function runTrainingStressScore(input: OtsInput): { ots: number; high: boolean } | null
```

Port notes (must match the source exactly — pin with the golden vector in Step 2):
- **Validator** (`_mangle_0`): sex∈{-1,0,1}; rhr∈[30,100]; readiness∈[0,100]; vo2max NaN-ok else [10,100]; `no_ots`/`tz_change`∈{0,1}. Any failure → `null`. `tz_change==1` → `null`.
- **`vo2max_numeric_to_category`** (`_mangle_4`): NaN vo2max → NaN category; sex −1→group 0 else group 1; scan the `[24×6]` table for the matching `(sex, age_min≤age≤age_max)` row; `cat = 0/1/2/3` by `low_fair/fair_high/high_peak`; no matching row → NaN category.
- **Preprocessor** (`_mangle_1`): `get_age_group` (sex 0 uses `other_age_groups` clamped 20..60; else `female_and_male_age_groups` clamped ≤80, floor to decade); `get_rhr_category` = `argmin(|percentiles[age_group] − rhr|)` on female/male/other percentiles by sex; `get_met_values_1min` = clean `<min_met_value(0.9)`→NaN, timestamps `arange(start_sec, start_sec + n*60, 60)`.
- **Processor** (`_mangle_2`): 720-wide stride-1 windows; if `use_met_intensity_weights` multiply each window by `met_intensity_weight_norm(window, γ=1, M=8)`; multiply by `met_weights` (720); `nansum` ÷ `sum(met_weights)`; NaN if `valid_met_count < 360`; timestamps = `met_timestamps_1min[719:]`; if `vo2max_category` or `vo2max_weights` NaN → `× rhr_weights[rhr_category]` else `× vo2max_weights[vo2max_category]`; clamp ≥ 0.9 (preserving NaN).
- **Top-level** (`forward`): `no_ots==1 && numel(mets)<720` → NaN OTS (single timestamp) → treat as `null`. Mask `ots_timestamps > start_sec`. `high_ots_threshold = 4.0`, `× 0.9 = 3.6` when `readiness < 60`. `ots_high_low = ots > threshold`. The reported single value = the **last non-NaN** OTS in the masked series (the day's rolling load at end-of-day); `high` = its `ots_high_low`. If the whole series is NaN/empty → `null`.

Use `getOtsConstants()` (`lib/oura-models/constants/index.ts`); if the tensor-wrapped `{kind:'tensor', values:[...]}` shape is awkward, add a small typed unwrapper there (`getOtsTypedConstants()`) returning plain `number[]`/`Float32Array` fields — keep it in that file (One Place for the constants).

- [ ] **Step 2: Capture golden vectors (owner-run) + write the parity test.** Generate `training_stress_score_0_2_1_input.json` / `…_output.json` by running the original `.pt` (decrypted archive, owner-held — same provenance as the ONNX fixtures) on a representative worn day: a full 1440-min MET series, realistic age/sex/rhr/readiness/vo2max, `no_ots=0`, `tz_change=0`. Save the model's `(ots, ots_timestamps, ots_high_low)` output. **Never trust a port that skips this** (`onnx/README.md`). Then:

```typescript
// lib/oura-models/inference/__tests__/ots.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import path from 'node:path'
import { runTrainingStressScore, type OtsInput } from '../ots'

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
const input = JSON.parse(fs.readFileSync(path.join(FIX, 'training_stress_score_0_2_1_input.json'), 'utf8'))
const ref   = JSON.parse(fs.readFileSync(path.join(FIX, 'training_stress_score_0_2_1_output.json'), 'utf8'))

describe('OTS core parity vs TorchScript', () => {
  it('matches the captured reference within 1e-3', () => {
    const out = runTrainingStressScore({ ...input, mets: Float32Array.from(input.mets) } as OtsInput)
    expect(out).not.toBeNull()
    expect(Math.abs(out!.ots - ref.ots)).toBeLessThan(1e-3)
    expect(out!.high).toBe(ref.high)
  })
  it('gates (null) on tz_change, out-of-range readiness, and <360 valid MET minutes', () => {
    const base = { ...input, mets: Float32Array.from(input.mets) } as OtsInput
    expect(runTrainingStressScore({ ...base, tzChange: 1 })).toBeNull()
    expect(runTrainingStressScore({ ...base, readiness: 120 })).toBeNull()
    expect(runTrainingStressScore({ ...base, mets: new Float32Array(720).fill(NaN) })).toBeNull()
  })
  it('accepts NaN vo2max (falls back to RHR weighting, still non-null)', () => {
    const out = runTrainingStressScore({ ...input, mets: Float32Array.from(input.mets), vo2max: NaN } as OtsInput)
    expect(out).not.toBeNull()
  })
})
```

> If the decrypted `.pt` is not available in-session, mark this step **⛔ owner-blocked**, land the port + a **numeric self-consistency** test (hand-computed small-window expected value) in this PR, and add a `projectOverview.md` Known-Issues row: "OTS core not yet golden-verified against TorchScript — pending owner `.pt` capture." Do **not** claim parity without the fixture.

- [ ] **Step 3: Run + commit** — `npx vitest run lib/oura-models/inference/__tests__/ots.test.ts`.

```bash
git add lib/oura-models/inference/ots.ts lib/oura-models/inference/__tests__/ots.test.ts lib/oura-models/onnx/__fixtures__/training_stress_score_0_2_1_*.json lib/oura-models/constants/index.ts
git commit -m "Port the OTS training-stress core to TypeScript, golden-verified vs TorchScript"
```

---

### Task 3: Input assembly + persistence — `lib/health/training-stress.ts` + `/api/training-stress`

**Files:**
- Create: `lib/health/training-stress.ts`, `lib/health/__tests__/training-stress.test.ts`, `app/api/training-stress/route.ts`

- [ ] **Step 1: `computeTrainingStress` assembly.** Pure function taking already-fetched inputs (keep DB access in the route — testable core). It builds the `OtsInput`, applies the gates, and returns a discriminated result:

```typescript
import { runTrainingStressScore } from '@/lib/oura-models/inference/ots'
import { deriveVo2Max, type Vo2MaxInputs } from '@/lib/health/vo2max'

export type TrainingStressResult =
  | { status: 'ok'; ots: number; high: boolean; vo2max: number | null; vo2maxMethod: string | null }
  | { status: 'gated'; reason: 'readiness_learning' | 'no_readiness' | 'insufficient_met' | 'no_profile' }

export interface TrainingStressInputs {
  startTimestampMs: number
  metsPerMinute: (number | null)[]     // day's 1-min MET series (nulls → NaN, cleaned by the core)
  age: number | null
  sex: string | null
  rhr: number | null                   // body_metrics.resting_heart_rate
  readiness: number | null             // persisted oura_daily_derived.readiness_score
  readinessProvisional: boolean        // true while composite baseline still learning
  vo2maxInputs: Vo2MaxInputs
  tzChange: 0 | 1
}

export function computeTrainingStress(i: TrainingStressInputs): TrainingStressResult {
  if (i.readiness == null) return { status: 'gated', reason: 'no_readiness' }
  if (i.readinessProvisional) return { status: 'gated', reason: 'readiness_learning' }
  if (i.age == null || i.sex == null || i.rhr == null) return { status: 'gated', reason: 'no_profile' }
  const validMin = i.metsPerMinute.filter(v => v != null && v >= 0.9).length
  if (i.metsPerMinute.length < 720 || validMin < 360) return { status: 'gated', reason: 'insufficient_met' }

  const vo2 = deriveVo2Max(i.vo2maxInputs)
  const biologicalSex = i.sex === 'female' ? -1 : i.sex === 'male' ? 1 : 0
  const out = runTrainingStressScore({
    startTimestampMs: i.startTimestampMs,
    mets: Float32Array.from(i.metsPerMinute.map(v => v == null ? NaN : v)),
    age: i.age, biologicalSex, rhr: i.rhr, noOts: 0, tzChange: i.tzChange,
    readiness: i.readiness, vo2max: vo2.value ?? NaN,
  })
  if (!out) return { status: 'gated', reason: 'insufficient_met' }
  return { status: 'ok', ots: out.ots, high: out.high, vo2max: vo2.value, vo2maxMethod: vo2.method }
}
```

- [ ] **Step 2: Tests** (`lib/health/__tests__/training-stress.test.ts`) — gate on null readiness, `readinessProvisional`, missing profile, `<720`/`<360` MET; and one `status:'ok'` case using the same MET series as the OTS golden fixture (assert it forwards the core's value). Follow the illness/vo2max test factory style.

- [ ] **Step 3: `GET /api/training-stress?date=YYYY-MM-DD` route.** Session auth; `normalizeDateParam` the `date` (default `todayInTz(session.user.timezone)` — never `toISOString().slice(0,10)`); rate limit + SWR headers matching sibling aggregate routes (`Cache-Control: private, max-age=60, stale-while-revalidate=120`). It fetches:
  - persisted readiness + provisional flag: read `repo.getOuraDailyDerived(userId, date, date)` for `readinessScore`; treat `readinessSource !== 'ble-derived'` or a missing row as `no_readiness`. For the provisional flag, read the day's `oura_daily_summary.n_history` (or recompute via the same path readiness uses) and compare to `BASELINE_MIN_NIGHTS`.
  - `body_metrics` latest `resting_heart_rate` / `weight_kg`; `users` age (`ageFromDob`), `sex`, `height_cm`, `activity_level`; `activity_logs.max_hr` latest.
  - MET: `getOuraDaytimeSignals(userId, dayStart, dayEnd)` → bucket `met` samples into a 1-min series across the local day (`todayMidnightUtc(tz)` boundaries — never `Date.now()−N×86400000`); `startTimestampMs` = local midnight.
  - Then `computeTrainingStress(...)`; on `status:'ok'` **best-effort** `upsertOuraDailyDerived(userId, date, { trainingLoadOts: ots, trainingLoadHigh: high })` inside try/catch (persist failure never fails the read), and return `{ status, ots, high, vo2max, vo2maxMethod }`. On `gated`, return `{ status: 'gated', reason }` (200 — the surface self-hides).

- [ ] **Step 4: Typecheck + commit** — `npx tsc --noEmit 2>&1 | grep "training-stress\|vo2max\|ots" || echo clean`.

```bash
git add lib/health/training-stress.ts lib/health/__tests__/training-stress.test.ts app/api/training-stress/route.ts
git commit -m "Assemble and persist the daily Training Stress Score from derived readiness + VO2max + MET"
```

---

### Task 4: Surface — done-screen badge + health Training-Load card

**Files:**
- Create: `components/workout/training-stress-badge.tsx`
- Modify: `components/workout/done-screen.tsx`, `app/health/health-sections.tsx` (+ its data hook)

- [ ] **Step 1: `TrainingStressBadge`.** `memo` component fetching `/api/training-stress?date=<today>` via `cachedFetch` (register a cache key in `lib/cache-ttl.ts`; invalidate on nothing new — it's derived read-only, but if a workout write should refresh it, add the key to `invalidateWorkoutSummaries()` in `lib/cache-groups.ts`). Renders `null` when `status:'gated'`. On `ok`, a compact readout beside the energy line: a Lucide icon (e.g. `Activity`/`Flame` — not an emoji), the OTS value, and a `high`/normal label — **never colour-alone** (pair the `high` state with a text label like "High load"). Copy the placement/typography of the existing `~kcal · intensity` block (`done-screen.tsx:381-386`). Seed from cache synchronously in a `useEffect` (never a `useState` initializer) for instant paint.

- [ ] **Step 2: Mount on the done-screen** next to the energy readout. Pass stable props (no inline objects/arrows — the memo must hold). `date = todayInTz()` (the user's tz, not `toISOString`).

- [ ] **Step 3: Health Training-Load card.** Add the daily Training-Stress number to the `trainingLoad` card (`health-sections.tsx:585`) — either extend `TrainingLoadResponse` (`app/api/training-load/route.ts`) with the persisted `trainingLoadOts` (read from `getOuraDailyDerived`) or read it via the same `/api/training-stress` key. Prefer reusing one key across both surfaces (per the cache-key reuse rule). Show the number with a short label; self-hide when null. Verify at the ≤640px S25 viewport; the card is normal-flow (no fixed positioning, no safe-area interaction).

- [ ] **Step 4: Lint + typecheck + commit** — `npx eslint components/workout/training-stress-badge.tsx components/workout/done-screen.tsx app/health/health-sections.tsx && npx tsc --noEmit 2>&1 | head -5`.

```bash
git add components/workout/training-stress-badge.tsx components/workout/done-screen.tsx app/health/health-sections.tsx app/api/training-load/route.ts lib/cache-ttl.ts lib/cache-groups.ts
git commit -m "Surface the daily Training Stress Score on the done-screen and health training-load card"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate** — `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build` (DB integration tests run against local Postgres).

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, log in as `test@local.dev` / `testpass123`). Seed (psql on port 5433, `trainingai_dev`; `:uid` = test user id):
  - a mature readiness composite for today: a persisted `oura_daily_derived` row with `readiness_score` set and `readiness_source = 'ble-derived'`, plus an `oura_daily_summary` row with `n_history >= 14` (so the provisional gate passes);
  - profile inputs: `users.date_of_birth`, `users.sex`, `users.height_cm`, `users.activity_level`; a `body_metrics` row with `resting_heart_rate` + `weight_kg` for today;
  - a day's worth of MET: insert ~1440 `oura_raw_samples` `0x50` rows (or the minimum ≥720 with ≥360 valid ≥0.9) so `getOuraDaytimeSignals` returns a full 1-min series. (If assembling raw BLE hex is impractical in-session, temporarily unit-drive `computeTrainingStress` with the golden MET series instead and **say so in the PR** — the raw-sample→MET decode path is the sandbox-unverifiable seam.)

  Exact checks:
  1. `GET /api/training-stress?date=<today>` → `status: "ok"`, a plausible `ots`, a `vo2max` + `vo2maxMethod`, and a persisted `oura_daily_derived.training_load_ots`/`training_load_high` (verify with psql).
  2. Set `n_history` to `10` (or clear the derived readiness row) → the route returns `status: "gated"`, `reason: "readiness_learning"` (or `no_readiness`); the done-screen badge and health number **disappear** (no fabricated value, no skeleton).
  3. Null `body_metrics.resting_heart_rate` but keep weight/height/activity → VO₂max method flips to `jackson-nex`; OTS still computes (RHR is still needed for the OTS `rhr` input, so this check is VO₂max-method-only — if RHR is truly null, expect `gated: no_profile`, which is correct).
  4. Done-screen (`/workout` → complete a session) at the S25 viewport (412×915) → the Training-Stress number renders next to `~kcal · effort`, with an icon + text label (not colour-alone).

- [ ] **Step 3: Version + changelog + journal + index.** Bump `package.json` **minor** (user-visible: a new daily metric on two surfaces). `lib/changelog.ts` top entry: "New: a daily Training Stress Score — your ring's movement (MET) over the day, weighted by your resting-HR fitness band and an estimated VO₂max, and scaled by readiness — now appears next to the workout calorie estimate and on the Health training-load card. It only shows once your readiness baseline has learned enough to be trustworthy." Append the session note to the current `docs/overview/history-*.md`; update `projectOverview.md` (status; add any Known-Issues row from Task 2 Step 2 if the golden fixture was owner-blocked); **remove this plan's backlog entry** (the P-D OTS item / the `⛔ Frozen Oura Cloud` OTS holding-pen line) in the same PR.

- [ ] **Step 4: Push + PR** — `git push -u origin feat/training-stress-score`. Standard change (no migration, no auth/security, no data-dropping) — merge on green per the CI/CD workflow once the smoke passes.

---

## Verification summary

- **Automated (sandbox):** VO₂max formulas + fallbacks/clamps (5), Jackson NEX constants (1); OTS core parity vs the captured golden vector + gating + NaN-VO₂max cases (3); training-stress assembly gating + ok-forward (≈5); full existing suites green; full gate.
- **Dev-server (sandbox):** `/api/training-stress` ok + persistence, the readiness-learning gate, VO₂max method fallback, done-screen badge render at the S25 viewport.
- **Deferred / not sandbox-verifiable — state in the PR:**
  - **The raw `0x50` MET decode → 1-min series** is a device-data seam (native BLE ingest); the sandbox has no real MET stream, so the assembly is exercised with seeded/golden MET, not live ring data. On-device is the authoritative check that a real worn day produces ≥720/≥360-valid minutes.
  - **The OTS golden fixture** requires the owner-held decrypted `.pt` — if unavailable in-session, the port ships with a self-consistency test + a Known-Issues row, not a parity claim (Task 2 Step 2).
  - **VO₂max accuracy** is not device-verifiable (no lab VO₂max to compare against) — but the model only *buckets* it by age/sex band, and the derivation is deterministic math, fully unit-tested. Real-value calibration is out of scope.
  - **On-device rendering** of the done-screen badge (Samsung WebView) — normal-flow content, no fixed positioning/safe-area, so web-viewport verification is the intended check; eyeball on the S25 at next opportunity (no Known-Issues row needed unless the device pass is skipped and something looks off at the web viewport).
  - **Kotlin/native:** none — this PR is entirely JS/server, ships via Railway into the WebView with no APK rebuild.

## Notes for the implementer

- **Readiness source is our derived composite, never the frozen Cloud row.** Read `oura_daily_derived.readiness_score` (`readinessSource: 'ble-derived'`); never `oura_daily.readiness_score`. Gate (don't fabricate) while the composite is provisional (`n_history < 14`).
- **Never write `oura_daily.vo2_max`** — that column is Cloud-COALESCE and frozen. Derived VO₂max stays in memory (passed to OTS) or, if persisted at all, only in `oura_daily_derived`.
- **The OTS core is a line-for-line port pinned to a golden vector** — do not "improve" the algorithm, re-band the thresholds, or re-derive constants from memory; the vendored `constants.json` is the source (`getOtsConstants()`), and the `.pt`-captured fixture is the parity proof. If you touch the port, re-run the golden test.
- **VO₂max lives once** in `lib/health/vo2max.ts`; if you need it elsewhere later, import it — never re-implement `15.3 × HRmax/HRrest` or the Jackson constants at a second site.
- **Serial track:** this shares `adapter.ts`/`slices/oura.ts`/readiness read-path god-files — run it alone on the Oura-derivation track, after the readiness/illness/stress items ahead of it, never as a parallel lane (`docs/implementation-backlog.md:137-149`).
- If line numbers above have drifted at implementation time (the Oura cluster moves fast), re-anchor by **symbol name**, not by re-designing.
