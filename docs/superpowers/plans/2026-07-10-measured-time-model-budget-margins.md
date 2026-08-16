# Measured Time Model + Budget Margins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session-duration planning uses the user's *measured* per-set times — work time keyed by reps, rest time keyed by %1RM band — instead of fixed constants, and the time budget reserves percentage-based warmup + finish-early margins so on-time execution lands ~10% under the configured budget.

**Architecture:** A new pure module `lib/workout/time-profile.ts` aggregates `set_logs` rows (already captured: `set_time_sec`, `rest_time_sec`, `intensity_pct`, `reps`) into per-exercise profiles: a measured sec-per-rep and a measured rest median per %1RM band, each gated on ≥10 outlier-excluded samples with a graceful fallback ladder (band median → exercise-overall median → today's constants/prescribed rest). `lib/workout/duration-model.ts` stays the One-Formula home: its estimate accepts optional measured overrides, and a new `workingBudgetMin()` replaces the flat "budget − 10 min warmup" with `budget × (1 − 15% warmup − 10% finish-early)`. `fitToBudget` and the prescribe route consume the measured values so trimming reflects real behaviour, not worst-case constants.

**Tech Stack:** TypeScript, Drizzle ORM (read-only query change — zero schema change), Vitest, existing `robustStats` outlier policy from `lib/workout/time-audit.ts`.

---

## Background — why (owner request, 2026-07-10)

- The owner's sessions overrun the 60-min budget when following recommended numbers, and wants them to finish ~5 min early instead.
- Root causes found in review: (a) `fitToBudget`/`estimateSessionDurationSec` use only the constant model (`10 + reps×4`, style rest) — the measured median reaches the AI *prompt* as advice but the deterministic enforcement ignores it; (b) the budget targets `budget − 10` exactly, with no finish-early margin; (c) the flat 10-min warmup allowance is wrong for short sessions.
- The lookback (`getAvgSetDurationPerExercise`) collapses all sets of an exercise into one median regardless of reps/pct — a 3×12 set and a 5×5 set read as the same duration. The owner explicitly wants time understood per set as `reps → work time` and `pct → rest time`.
- This implements the first bullet of spec `docs/superpowers/specs/2026-07-07-extended-metrics-capture-and-analysis-design.md` §B3 ("feed the measured rest-by-intensity back into `lib/workout/duration-model.ts` … Keep it One-Formula — extend the model, don't copy it"). The spec's other §B3 items (planned-pct snapshot, TUT capture, failure flag) are **out of scope** here.

**Locked decisions (owner-confirmed 2026-07-10):**
- Rest is bucketed by %1RM **band**, not exact pct: `light <70`, `moderate 70–80`, `heavy 80–90`, `max ≥90`. Band width absorbs the session-estimate drift in `intensity_pct` (spec §B5.1) — do not switch the divisor.
- Work time is `SET_SETUP_SEC + reps × measuredSecPerRep` — same functional form as the default, with the per-rep slope measured. Pooling all of an exercise's sets for the slope is deliberate (tempo is roughly rep-count-independent; reps scale the total).
- Measured values require **≥ 10 outlier-excluded sets** in the bucket (`MIN_PROFILE_SAMPLES = 10`); below that, fall back (band → overall → constants). Within a phase the pct band is stable, so ~2–3 sessions calibrate the band.
- Budget fractions: **15% warmup + 10% finish-early margin = 25% overhead**; working time = 75% of `time_budget_minutes` (60 min → 45 min working, 30 min → ~23 min working). Replaces the flat `SESSION_WARMUP_MIN = 10`.

**Nulls are dropped, never zero-filled** (spec §B5.3): a set logged without timing (phase skipped, older data) contributes nothing; a zeroed rest would look like a superset.

## File map

| File | Action | Responsibility |
|---|---|---|
| `lib/workout/time-profile.ts` | Create | Pct bands, `MIN_PROFILE_SAMPLES`, `buildTimeProfiles`, `resolveMeasuredRestSec` (pure) |
| `lib/__tests__/time-profile.test.ts` | Create | Unit tests for the above |
| `lib/workout/duration-model.ts` | Modify | `WARMUP_FRACTION`/`FINISH_EARLY_FRACTION`/`workingBudgetMin`, `effectiveSetWorkSec`, measured overrides in `DurationExercise`; remove `SESSION_WARMUP_MIN` |
| `lib/__tests__/duration-model.test.ts` | Modify | Tests for the above |
| `lib/ai-periodization/time-budget.ts` | Modify | `TimedExercise` measured fields; trim time-cost uses effective values |
| `lib/__tests__/time-budget.test.ts` | Modify | Test that measured values change trim outcomes |
| `lib/data/postgres/slices/periodization.ts` | Modify | Replace `getAvgSetDurationPerExercise` with `getSetTimingRows` (same baseline-date clamp) |
| `lib/data/repository.ts` | Modify | Interface: swap the method |
| `lib/data/postgres/adapter.ts` | Modify | Delegation: swap the method |
| `lib/ai-periodization/signals.ts` | Modify | Build profiles once; `timeProfile` per exercise; `workingBudgetMin` for `effectiveTimeBudgetMin` |
| `lib/ai-periodization/prompt.ts` | Modify | System-prompt formula mentions measured overrides; user prompt shows measured values |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | Modify | Pass measured fields into `fitToBudget` + duration estimate (normal + deload paths) |
| `app/api/generate-program/route.ts` | Modify | Sibling sweep: use `workingBudgetMin` |
| `app/api/builder-chat/route.ts` | Modify | Sibling sweep: use `workingBudgetMin` |
| `lib/__tests__/prompt-deload-awareness.test.ts`, `lib/__tests__/ai-dynamic.test.ts` | Modify | Fixtures gain `timeProfile: null` (run `tsc` to find all) |
| `docs/module-map.md` | Modify | One-line row for `lib/workout/time-profile.ts` |

No DB migration. No client/APK surface — this is server/planning logic only (dev-server verifiable; no on-device gate).

---

### Task 1: `lib/workout/time-profile.ts` — pure profile builder

**Files:**
- Create: `lib/workout/time-profile.ts`
- Test: `lib/__tests__/time-profile.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  MIN_PROFILE_SAMPLES, PCT_BANDS, pctBand,
  buildTimeProfiles, resolveMeasuredRestSec,
  type TimingRow,
} from '@/lib/workout/time-profile'
import { SET_SETUP_SEC } from '@/lib/workout/duration-model'

const row = (over: Partial<TimingRow> = {}): TimingRow => ({
  exerciseName: 'Bench Press', reps: 10, setTimeSec: 40, restTimeSec: 120, intensityPct: 75, ...over,
})
const rows = (n: number, over: Partial<TimingRow> = {}): TimingRow[] =>
  Array.from({ length: n }, () => row(over))

describe('pctBand', () => {
  it('maps pct to the four effort bands', () => {
    expect(pctBand(60)).toBe('light')
    expect(pctBand(69.9)).toBe('light')
    expect(pctBand(70)).toBe('moderate')
    expect(pctBand(79.9)).toBe('moderate')
    expect(pctBand(80)).toBe('heavy')
    expect(pctBand(89.9)).toBe('heavy')
    expect(pctBand(90)).toBe('max')
    expect(pctBand(102)).toBe('max')
  })
  it('band keys are exported in order', () => {
    expect(PCT_BANDS).toEqual(['light', 'moderate', 'heavy', 'max'])
  })
})

describe('buildTimeProfiles — secPerRep', () => {
  it('derives sec/rep as (setTime − setup) ÷ reps once ≥ MIN_PROFILE_SAMPLES good sets exist', () => {
    // 40s for 10 reps → (40 − 10) / 10 = 3 s/rep
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES))['Bench Press']
    expect(p.secPerRep).toBe((40 - SET_SETUP_SEC) / 10)
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('returns null below the sample gate but still reports the count', () => {
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES - 1))['Bench Press']
    expect(p.secPerRep).toBeNull()
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES - 1)
  })

  it('excludes runaway-timer outliers via the robustStats policy', () => {
    // 10 clean sets + one 400s "set" (40 s/rep vs median 3 — outside median×4)
    const p = buildTimeProfiles([...rows(MIN_PROFILE_SAMPLES), row({ setTimeSec: 400 })])['Bench Press']
    expect(p.secPerRep).toBe(3)
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('ignores rows with missing or non-positive setTimeSec / reps (never zero-fills)', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES),
      row({ setTimeSec: null }), row({ setTimeSec: 0 }), row({ reps: 0 }),
    ])['Bench Press']
    expect(p.secPerRepSamples).toBe(MIN_PROFILE_SAMPLES)
  })

  it('floors a sub-setup set time at 1 s/rep instead of going negative', () => {
    const p = buildTimeProfiles(rows(MIN_PROFILE_SAMPLES, { setTimeSec: 5, reps: 5 }))['Bench Press']
    expect(p.secPerRep).toBe(1)
  })
})

describe('buildTimeProfiles — rest by band', () => {
  it('buckets rest medians by intensity band, gated per band', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 75, restTimeSec: 120 }),
      ...rows(4, { intensityPct: 85, restTimeSec: 200 }), // heavy: under the gate
    ])['Bench Press']
    expect(p.restSecByBand.moderate).toBe(120)
    expect(p.restSecByBand.heavy).toBeNull()
    expect(p.restSamplesByBand.heavy).toBe(4)
    expect(p.restSecByBand.light).toBeNull()
  })

  it('overall rest pools every band AND null-pct rows', () => {
    const p = buildTimeProfiles([
      ...rows(6, { intensityPct: 75, restTimeSec: 100 }),
      ...rows(6, { intensityPct: null, restTimeSec: 100 }),
    ])['Bench Press']
    expect(p.restSecByBand.moderate).toBeNull()   // 6 < gate
    expect(p.restSecOverall).toBe(100)            // 12 ≥ gate
    expect(p.restSamplesOverall).toBe(12)
  })

  it('drops rows with missing/non-positive rest', () => {
    const p = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES, { restTimeSec: 120 }),
      row({ restTimeSec: null }), row({ restTimeSec: 0 }),
    ])['Bench Press']
    expect(p.restSamplesOverall).toBe(MIN_PROFILE_SAMPLES)
  })

  it('profiles are per exercise', () => {
    const out = buildTimeProfiles([
      ...rows(MIN_PROFILE_SAMPLES),
      ...rows(MIN_PROFILE_SAMPLES, { exerciseName: 'Squat', reps: 5, setTimeSec: 35 }),
    ])
    expect(out['Bench Press'].secPerRep).toBe(3)
    expect(out['Squat'].secPerRep).toBe((35 - SET_SETUP_SEC) / 5)
  })
})

describe('resolveMeasuredRestSec — fallback ladder', () => {
  const profile = buildTimeProfiles([
    ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 75, restTimeSec: 120 }),
    ...rows(MIN_PROFILE_SAMPLES, { intensityPct: 85, restTimeSec: 200 }),
  ])['Bench Press']

  it('band median when the prescribed pct lands in a populated band', () => {
    expect(resolveMeasuredRestSec(profile, 72)).toBe(120)
    expect(resolveMeasuredRestSec(profile, 85)).toBe(200)
  })

  it('falls back to the overall median for an unpopulated band', () => {
    // light band empty; overall = median of 10×120 + 10×200 = 160
    expect(resolveMeasuredRestSec(profile, 60)).toBe(160)
  })

  it('null when there is no profile or no data at all', () => {
    expect(resolveMeasuredRestSec(null, 75)).toBeNull()
    const thin = buildTimeProfiles(rows(3))['Bench Press']
    expect(resolveMeasuredRestSec(thin, 75)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/__tests__/time-profile.test.ts`
Expected: FAIL — `Cannot find module '@/lib/workout/time-profile'`

- [ ] **Step 3: Write the implementation**

```ts
// Measured per-set time profiles from logged history ("time based on sets + pct",
// owner request 2026-07-10; spec 2026-07-07-extended-metrics §B3). Read-time
// derivation only — nothing stored (Stored Counters rule). Work time scales with
// reps (measured sec/rep, pooled per exercise); rest scales with effort (%1RM
// band). intensity_pct is the session-estimate basis (spec §B5.1) — the 10-wide
// bands absorb that drift, so do not switch the divisor here.

import { SET_SETUP_SEC } from '@/lib/workout/duration-model'
import { robustStats } from '@/lib/workout/time-audit'

export const PCT_BANDS = ['light', 'moderate', 'heavy', 'max'] as const
export type PctBand = (typeof PCT_BANDS)[number]

export function pctBand(pct: number): PctBand {
  if (pct < 70) return 'light'
  if (pct < 80) return 'moderate'
  if (pct < 90) return 'heavy'
  return 'max'
}

// A measured median is only trusted once this many outlier-excluded sets back it
// (owner-chosen). A phase's working band accumulates this within ~2-3 sessions, so
// estimates calibrate mid-phase and revert to defaults when a new phase moves the pct.
export const MIN_PROFILE_SAMPLES = 10

export interface TimingRow {
  exerciseName: string
  reps: number
  setTimeSec: number | null
  restTimeSec: number | null
  intensityPct: number | null
}

export interface ExerciseTimeProfile {
  // Measured tempo: median of (setTimeSec − SET_SETUP_SEC) / reps, null under the gate.
  secPerRep: number | null
  secPerRepSamples: number
  restSecByBand: Record<PctBand, number | null>
  restSamplesByBand: Record<PctBand, number>
  // All rest samples pooled (including null-pct rows) — the band's fallback.
  restSecOverall: number | null
  restSamplesOverall: number
}

function gatedMedian(values: number[]): { median: number | null; samples: number } {
  const stats = robustStats(values)
  return {
    median: stats.count >= MIN_PROFILE_SAMPLES ? stats.median : null,
    samples: stats.count,
  }
}

export function buildTimeProfiles(rows: TimingRow[]): Record<string, ExerciseTimeProfile> {
  const byName = new Map<string, TimingRow[]>()
  for (const r of rows) {
    const arr = byName.get(r.exerciseName) ?? []
    arr.push(r)
    byName.set(r.exerciseName, arr)
  }

  const out: Record<string, ExerciseTimeProfile> = {}
  for (const [name, exRows] of byName) {
    const perRepValues = exRows
      .filter(r => r.setTimeSec != null && r.setTimeSec > 0 && r.reps > 0)
      .map(r => Math.max(1, (r.setTimeSec! - SET_SETUP_SEC) / r.reps))
    const perRep = gatedMedian(perRepValues)

    const restRows = exRows.filter(r => r.restTimeSec != null && r.restTimeSec > 0)
    const restSecByBand = {} as Record<PctBand, number | null>
    const restSamplesByBand = {} as Record<PctBand, number>
    for (const band of PCT_BANDS) {
      const banded = gatedMedian(
        restRows.filter(r => r.intensityPct != null && pctBand(r.intensityPct) === band)
          .map(r => r.restTimeSec!),
      )
      restSecByBand[band] = banded.median
      restSamplesByBand[band] = banded.samples
    }
    const overall = gatedMedian(restRows.map(r => r.restTimeSec!))

    out[name] = {
      secPerRep: perRep.median,
      secPerRepSamples: perRep.samples,
      restSecByBand,
      restSamplesByBand,
      restSecOverall: overall.median,
      restSamplesOverall: overall.samples,
    }
  }
  return out
}

// Fallback ladder: prescribed-pct band median → exercise-overall median → null
// (caller falls back to the planned/prescribed restSec).
export function resolveMeasuredRestSec(profile: ExerciseTimeProfile | null, pct: number): number | null {
  if (!profile) return null
  return profile.restSecByBand[pctBand(pct)] ?? profile.restSecOverall
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/__tests__/time-profile.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add lib/workout/time-profile.ts lib/__tests__/time-profile.test.ts
git commit -m "feat: measured per-set time profiles (work by reps, rest by %1RM band)"
```

---

### Task 2: duration-model — measured overrides + percentage budget margins

**Files:**
- Modify: `lib/workout/duration-model.ts`
- Test: `lib/__tests__/duration-model.test.ts`

- [ ] **Step 1: Update the tests (write failing first)**

In `lib/__tests__/duration-model.test.ts`:

1. Update the import to drop `SESSION_WARMUP_MIN` and add the new exports:

```ts
import {
  SECONDS_PER_REP, SET_SETUP_SEC,
  WARMUP_FRACTION, FINISH_EARLY_FRACTION, workingBudgetMin,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT, TRANSITION_SEC_DEFAULT,
  transitionSecForEquipment, setWorkSec, effectiveSetWorkSec, styleWorkSec, warmupRampSectionSec,
  estimateExerciseDurationSec, estimateSessionDurationSec, estimateSessionDurationMin,
} from '@/lib/workout/duration-model'
```

2. Replace the `it('warmup constant is exported for budget callers', …)` block with:

```ts
  it('working budget carves out warmup + finish-early fractions of the total', () => {
    expect(WARMUP_FRACTION + FINISH_EARLY_FRACTION).toBeCloseTo(0.25)
    expect(workingBudgetMin(60)).toBe(45)  // 60 − 9 warmup − 6 margin
    expect(workingBudgetMin(30)).toBe(23)  // short session gets a short warmup allowance
    expect(workingBudgetMin(10)).toBe(15)  // floor guards degenerate configs
  })

  it('measured values override the constants when present, per field', () => {
    expect(effectiveSetWorkSec(10, 3)).toBe(SET_SETUP_SEC + 10 * 3)
    expect(effectiveSetWorkSec(10, null)).toBe(setWorkSec(10))
    expect(effectiveSetWorkSec(10, undefined)).toBe(setWorkSec(10))
    const ex = { sets: 3, reps: 10, restSec: 90, transitionSec: 120, measuredSecPerRep: 3, measuredRestSec: 150 }
    expect(estimateExerciseDurationSec(ex)).toBe(3 * (SET_SETUP_SEC + 30) + 2 * 150 + 120)
    // rest override alone leaves work on the constant model
    expect(estimateExerciseDurationSec({ sets: 3, reps: 10, restSec: 90, transitionSec: 120, measuredRestSec: 150 }))
      .toBe(3 * setWorkSec(10) + 2 * 150 + 120)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts`
Expected: FAIL — `workingBudgetMin` / `effectiveSetWorkSec` not exported

- [ ] **Step 3: Write the implementation**

In `lib/workout/duration-model.ts`:

1. Replace `export const SESSION_WARMUP_MIN = 10` with:

```ts
// Budget overheads as fractions of the configured session budget (owner-set
// 2026-07-10): warmup scales with the session (a 30-min session doesn't need a
// 10-min warmup) and the finish-early margin makes on-time execution land ~10%
// under budget instead of exactly at it. Working time = the remaining 75%.
export const WARMUP_FRACTION = 0.15
export const FINISH_EARLY_FRACTION = 0.10

// Minutes of actual working time (sets + rest + transitions) a session budget buys.
export function workingBudgetMin(totalBudgetMin: number): number {
  return Math.max(15, Math.round(totalBudgetMin * (1 - WARMUP_FRACTION - FINISH_EARLY_FRACTION)))
}
```

2. After `setWorkSec`, add:

```ts
// Set work with a measured per-exercise tempo when one exists (lib/workout/time-profile.ts);
// the setup constant stays — the measured slope is derived net of it.
export function effectiveSetWorkSec(reps: number, measuredSecPerRep?: number | null): number {
  return SET_SETUP_SEC + reps * (measuredSecPerRep ?? SECONDS_PER_REP)
}
```

3. Extend `DurationExercise` and `estimateExerciseDurationSec`:

```ts
export interface DurationExercise {
  sets: number
  reps: number
  restSec: number
  transitionSec: number
  // Measured overrides from lib/workout/time-profile.ts — null/absent falls back
  // to the constant model (SECONDS_PER_REP / the planned restSec above).
  measuredSecPerRep?: number | null
  measuredRestSec?: number | null
}

export function estimateExerciseDurationSec(ex: DurationExercise): number {
  return ex.sets * effectiveSetWorkSec(ex.reps, ex.measuredSecPerRep)
    + Math.max(0, ex.sets - 1) * (ex.measuredRestSec ?? ex.restSec)
    + ex.transitionSec
}
```

(`setWorkSec`, `styleWorkSec`, `warmupRampSectionSec`, transitions all stay as-is.)

- [ ] **Step 4: Run tests + typecheck to find every `SESSION_WARMUP_MIN` consumer**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts && pnpm exec tsc --noEmit`
Expected: duration-model tests PASS; `tsc` FAILS in `app/api/generate-program/route.ts` and `app/api/builder-chat/route.ts` (fixed in Task 8 — if committing per-task, fix those two imports in this commit instead; see Task 8 for the exact code, then re-run `tsc`).

- [ ] **Step 5: Commit** (together with Task 8's two-file fix if `tsc` requires it)

```bash
git add lib/workout/duration-model.ts lib/__tests__/duration-model.test.ts app/api/generate-program/route.ts app/api/builder-chat/route.ts
git commit -m "feat: percentage-based warmup + finish-early budget margins; measured overrides in the duration model"
```

---

### Task 3: time-budget — trim decisions use measured values

**Files:**
- Modify: `lib/ai-periodization/time-budget.ts`
- Test: `lib/__tests__/time-budget.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/time-budget.test.ts` (match the file's existing fixture style):

```ts
describe('fitToBudget with measured time profiles', () => {
  it('a session that fits on constants gets trimmed when measured rest is longer', () => {
    const ex = {
      sessionExerciseId: 'a', role: 'accessory', sets: 4, reps: 10,
      restSec: 60, transitionSec: 120,
    }
    // Constants: 4×50 + 3×60 + 120 = 500s — fits a 10-min budget untouched.
    expect(fitToBudget([ex], 10)[0].sets).toBe(4)
    // Measured reality: 300s actual rest → 4×50 + 3×300 + 120 = 1220s > 600s.
    // Trimming must see the measured values, not the optimistic constants.
    const measured = { ...ex, measuredRestSec: 300 }
    expect(fitToBudget([measured], 10)[0].sets).toBeLessThan(4)
  })

  it('measured sec/rep flows into the estimate too', () => {
    const ex = {
      sessionExerciseId: 'a', role: 'accessory', sets: 4, reps: 10,
      restSec: 60, transitionSec: 120, measuredSecPerRep: 12, // slow tempo: 130s sets
    }
    // 4×130 + 3×60 + 120 = 820s > 600s → must trim.
    expect(fitToBudget([ex], 10)[0].sets).toBeLessThan(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/time-budget.test.ts`
Expected: the two new tests FAIL (sets stay 4 — `TimedExercise` lacks the fields, estimate ignores them)

- [ ] **Step 3: Write the implementation**

In `lib/ai-periodization/time-budget.ts`:

1. Add `effectiveSetWorkSec` to the import from `@/lib/workout/duration-model` (and re-export it alongside `setWorkSec` in the existing re-export block).

2. Extend `TimedExercise` (after `transitionSec`):

```ts
  // Measured overrides (lib/workout/time-profile.ts) — resolved by the caller from
  // the exercise's time profile + prescribed pct. Absent → constant model.
  measuredSecPerRep?: number | null
  measuredRestSec?: number | null
```

3. In `pickTrimTarget`, replace `byTimeCost` so the "which set removal frees the most time" comparison uses the same effective values as the estimate:

```ts
  const timeCost = (e: TimedExercise): number =>
    effectiveSetWorkSec(e.reps, e.measuredSecPerRep) + (e.measuredRestSec ?? e.restSec)
  const byTimeCost = <U extends TimedExercise>(best: U, e: U): U =>
    timeCost(e) > timeCost(best) ? e : best
```

(`estimateSessionDurationSec` already honours the fields via Task 2 — `TimedExercise` values pass straight through as `DurationExercise`s.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/__tests__/time-budget.test.ts`
Expected: PASS (existing tests untouched — absent fields preserve old behaviour exactly)

- [ ] **Step 5: Commit**

```bash
git add lib/ai-periodization/time-budget.ts lib/__tests__/time-budget.test.ts
git commit -m "feat: fitToBudget trims against measured set/rest times when available"
```

---

### Task 4: repository — raw timing rows replace the collapsed average

**Files:**
- Modify: `lib/data/postgres/slices/periodization.ts` (replace `getAvgSetDurationPerExercise`, ~line 290)
- Modify: `lib/data/repository.ts:586`
- Modify: `lib/data/postgres/adapter.ts:4184`

The aggregation moves out of SQL into the pure, unit-tested `buildTimeProfiles` — the slice just fetches rows. The `timing_baseline_date` clamp (pre-baseline learning-period exclusion) must be preserved exactly.

- [ ] **Step 1: Replace the slice function**

In `lib/data/postgres/slices/periodization.ts`, replace the whole `getAvgSetDurationPerExercise` function with:

```ts
export async function getSetTimingRows(db: Db, userId: string, exerciseNames: string[]): Promise<TimingRow[]> {
  if (exerciseNames.length === 0) return []
  const [userRow] = await db.select({ timingBaselineDate: s.users.timingBaselineDate }).from(s.users).where(eq(s.users.id, userId)).limit(1)
  const conditions = [
    eq(s.workoutSessions.userId, userId),
    inArray(s.exerciseLogs.exerciseName, exerciseNames),
  ]
  if (userRow?.timingBaselineDate) conditions.push(gte(s.workoutSessions.startedAt, dateStrMidnightInTz(userRow.timingBaselineDate)))
  return db
    .select({
      exerciseName: s.exerciseLogs.exerciseName,
      reps: s.setLogs.reps,
      setTimeSec: s.setLogs.setTimeSec,
      restTimeSec: s.setLogs.restTimeSec,
      intensityPct: s.setLogs.intensityPct,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
    .where(and(...conditions))
}
```

Add `import type { TimingRow } from '@/lib/workout/time-profile'` to the imports; remove the now-unused `robustAvgSetDurationsByExercise` import and the `isNotNull` import **only if** nothing else in the file uses it (check — other functions may).

- [ ] **Step 2: Swap the interface method**

In `lib/data/repository.ts`, replace line 586:

```ts
  getSetTimingRows(userId: string, exerciseNames: string[]): Promise<import('@/lib/workout/time-profile').TimingRow[]>
```

(or add a top-level `import type { TimingRow } from '@/lib/workout/time-profile'` and use it plainly, matching the file's existing import style.)

- [ ] **Step 3: Swap the adapter delegation**

In `lib/data/postgres/adapter.ts`, replace the `getAvgSetDurationPerExercise` delegation (~line 4184) with:

```ts
  async getSetTimingRows(userId: string, exerciseNames: string[]) { return period.getSetTimingRows(this.db, userId, exerciseNames) }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: FAILS only in `lib/ai-periodization/signals.ts` (the sole caller — fixed next task). No other callers exist (verified 2026-07-10: `getAvgSetDurationPerExercise` appears only in repository.ts, adapter.ts, periodization.ts, signals.ts).

- [ ] **Step 5: Commit** (fine to commit with the expected signals break fixed in the same commit as Task 5 — or hold this commit until Task 5 passes; implementer's choice, but never push a broken `tsc` state)

---

### Task 5: signals — per-exercise time profiles + fraction-based budget

**Files:**
- Modify: `lib/ai-periodization/signals.ts`
- Modify: `lib/__tests__/prompt-deload-awareness.test.ts`, `lib/__tests__/ai-dynamic.test.ts` (fixtures — plus any other file `tsc` flags)

- [ ] **Step 1: Wire the profiles in**

In `lib/ai-periodization/signals.ts`:

1. Imports:

```ts
import { transitionSecForEquipment, workingBudgetMin } from '@/lib/workout/duration-model'
import { buildTimeProfiles, type ExerciseTimeProfile } from '@/lib/workout/time-profile'
import { robustAvgSetDurationsByExercise } from '@/lib/workout/time-audit'
```

2. In the `PrescriptionSignals` exercises entry type, after `avgSetDurationSec: number` add:

```ts
    // Measured work/rest profile (null until history accrues) — see lib/workout/time-profile.ts.
    timeProfile: ExerciseTimeProfile | null
```

3. In the `Promise.all` (~line 105-117), replace `repo.getAvgSetDurationPerExercise(userId, exerciseNames)` with `repo.getSetTimingRows(userId, exerciseNames)` and rename the destructured `avgSetDurations` to `timingRows`.

4. After the `Promise.all`, derive both consumers from the one row set:

```ts
  const timeProfiles = buildTimeProfiles(timingRows)
  const avgSetDurations = robustAvgSetDurationsByExercise(
    timingRows.filter((r): r is typeof r & { setTimeSec: number } => r.setTimeSec != null),
  )
```

5. In the per-exercise return object (~line 166), the old slice defaulted missing exercises to 45 — that default moves here:

```ts
      avgSetDurationSec: avgSetDurations[ex.exerciseName] ?? 45,
      timeProfile: timeProfiles[ex.exerciseName] ?? null,
```

6. Replace line 401:

```ts
    effectiveTimeBudgetMin: workingBudgetMin(programSession.timeBudgetMinutes),
```

- [ ] **Step 2: Fix fixtures flagged by tsc**

Run: `pnpm exec tsc --noEmit`
Expected failures: test fixtures building `PrescriptionSignals['exercises']` entries. Add `timeProfile: null,` to each fixture exercise object in `lib/__tests__/prompt-deload-awareness.test.ts` (~line 15) and `lib/__tests__/ai-dynamic.test.ts` — plus any other file `tsc` names. Re-run until clean.

- [ ] **Step 3: Run the affected suites**

Run: `pnpm vitest run lib/__tests__/prompt-deload-awareness.test.ts lib/__tests__/ai-dynamic.test.ts`
Expected: PASS

- [ ] **Step 4: Commit** (include Task 4's files if held back)

```bash
git add lib/ai-periodization/signals.ts lib/data/postgres/slices/periodization.ts lib/data/repository.ts lib/data/postgres/adapter.ts lib/__tests__/prompt-deload-awareness.test.ts lib/__tests__/ai-dynamic.test.ts
git commit -m "feat: signals carry measured time profiles; budget margins are percentage-based"
```

---

### Task 6: prompt — tell the AI about the measured values

**Files:**
- Modify: `lib/ai-periodization/prompt.ts`

- [ ] **Step 1: System prompt — formula text**

In `buildSystemPrompt` (~line 92-99), replace the two formula lines:

```
Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (${SET_SETUP_SEC} + reps × ${SECONDS_PER_REP}) + (sets - 1) × rest_sec + transition_sec.
transition_sec is given per exercise in the exercise list (equipment-dependent: barbell setups cost more than machines).
```

with:

```
Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (${SET_SETUP_SEC} + reps × sec_per_rep) + (sets - 1) × rest + transition_sec.
sec_per_rep is the exercise's measured_sec_per_rep when given in the exercise list, else ${SECONDS_PER_REP}.
rest is the exercise's measured rest for the band your prescribed pct falls in (light <70%, moderate 70-80%, heavy 80-90%, max ≥90%) when measured_rest_by_band lists that band, else your prescribed rest_sec. Measured values are this user's real logged times — trust them over the defaults.
transition_sec is given per exercise in the exercise list (equipment-dependent: barbell setups cost more than machines).
```

- [ ] **Step 2: User prompt — measured values per exercise**

In `buildUserPrompt`, inside the `exerciseLines` map (~line 133-143), build the measured suffix and append it before the plateau suffix:

```ts
  const exerciseLines = signals.exercises.map(ex => {
    const musclesStr = ex.muscleAssignments.length > 0
      ? ex.muscleAssignments.map(ma => `${ma.muscle} (${ma.role})`).join(', ')
      : ex.muscleGroups.join(', ')
    const tp = ex.timeProfile
    const restBands = tp
      ? PCT_BANDS.filter(b => tp.restSecByBand[b] != null)
          .map(b => `${b} ${Math.round(tp.restSecByBand[b]!)}s`).join(', ')
      : ''
    const measuredStr =
      (tp?.secPerRep != null ? `, measured_sec_per_rep: ${tp.secPerRep.toFixed(1)}` : '') +
      (restBands ? `, measured_rest_by_band: [${restBands}]` : '')
    return `  - ${ex.name} (id: ${ex.sessionExerciseId}, role: ${ex.role}, muscles: ${musclesStr}, ` +
      `baseline_1rm: ${ex.baseline1rm ?? 'unknown'} kg [anchor only — do not use for trend], ` +
      `current_1rm: ${ex.current1rm ?? 'unknown'} kg, ` +
      `rm1_trend: ${ex.rm1Trend} ${ex.rm1ChangeKg > 0 ? '+' : ''}${ex.rm1ChangeKg.toFixed(1)} kg, ` +
      `avg_set_duration: ${ex.avgSetDurationSec}s, transition_sec: ${ex.transitionSec}${measuredStr})` +
      (ex.plateau ? ' [1RM flat ≥3 weeks — consider a stimulus change]' : '')
  }).join('\n')
```

Add `import { PCT_BANDS } from '@/lib/workout/time-profile'` to the imports.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run lib/__tests__/prompt-deload-awareness.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / clean (fixtures with `timeProfile: null` produce no measured suffix — old prompt text unchanged for no-data exercises)

- [ ] **Step 4: Commit**

```bash
git add lib/ai-periodization/prompt.ts
git commit -m "feat: expose measured per-rep and rest-by-band times to the prescription prompt"
```

---

### Task 7: prescribe route — enforcement consumes the measured values

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

This is the fix for "the measured average reaches the AI prompt but the enforcement math ignores it". Three sites, all in this file. The prescribed `ex.pct` (`PrescriptionSchema`: `pct` 0-100, `rest_sec`) picks the rest band via `resolveMeasuredRestSec`.

- [ ] **Step 1: Import + shared lookup**

Add to imports:

```ts
import { resolveMeasuredRestSec } from '@/lib/workout/time-profile'
```

- [ ] **Step 2: Main path — `fitToBudget` input (~line 316-337)**

In the `fitToBudget(parsed.exercises.map(ex => { … }))` mapper, after `transitionSec: sig?.transitionSec ?? 240,` add:

```ts
          measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
          measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
```

- [ ] **Step 3: Main path — duration estimate (~line 343-349)**

Replace the `transitionById`-based mapping with a signal-based one so the estimate carries the same measured fields:

```ts
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    parsed.exercises.map(ex => {
      const sig = sigById.get(ex.session_exercise_id)
      return {
        sets: ex.sets, reps: ex.reps, restSec: ex.rest_sec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
      }
    }),
  )
```

(Delete the now-unused `transitionById` if nothing else references it — grep the file.)

- [ ] **Step 4: Deload path — `buildWholeSessionDeloadPrescription` (~lines 43-72)**

Deload pct is fixed (`DELOAD_LOWER_PCT[goal] ?? 50` → typically the light band). In the `fitToBudget` input add after `transitionSec: ex.transitionSec,`:

```ts
        measuredSecPerRep: ex.timeProfile?.secPerRep ?? null,
        measuredRestSec: ex.timeProfile ? resolveMeasuredRestSec(ex.timeProfile, pct) : null,
```

And in that function's `estimateSessionDurationMin` mapping (~line 67-72), replace with the same signal-carrying shape:

```ts
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    exercises.map(ex => {
      const sig = sigById.get(ex.sessionExerciseId)
      return {
        sets: ex.sets, reps: ex.reps, restSec: ex.restSec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, pct) : null,
      }
    }),
  )
```

- [ ] **Step 5: Over-budget-at-floors note (main path only)**

`fitToBudget` never drops exercises and role floors are absolute, so a session with too many
exercises for its budget stays over even after maximal trimming — silently, today. The owner's
current program is known to overrun (2026-07-10), so this state WILL occur post-deploy; surface
it in the prescription instead of letting it fail quietly.

Immediately after the `estimatedSessionDurationMin` computation from Step 3, append a
deterministic sentence to the prescription's top-level `reasoning` (`AiPrescription.reasoning`
— confirm the field on the parsed object; `PrescriptionSchema` mirrors the type):

```ts
  if (estimatedSessionDurationMin > signals.effectiveTimeBudgetMin) {
    parsed.reasoning = `${parsed.reasoning} Note: even at minimum sets this session is estimated at ${estimatedSessionDurationMin} min against the ${signals.effectiveTimeBudgetMin}-min working budget — it has more exercises than the time budget fits. Consider removing an accessory from this session or raising its time budget.`
  }
```

Skip the deload path (fixed 2–3 sets at light load — it structurally fits; adding the note
there would fire only for absurd configs and muddy the deload messaging).

- [ ] **Step 6: Verify + commit**

Run: `pnpm exec tsc --noEmit && pnpm vitest run`
Expected: clean / all PASS

```bash
git add app/api/ai-periodization/session/[sessionId]/prescribe/route.ts
git commit -m "feat: budget enforcement trims against measured times, not just the constant model"
```

---

### Task 8: sibling sweep — program generator + builder chat use the same budget math

**Files:**
- Modify: `app/api/generate-program/route.ts:12,144,154`
- Modify: `app/api/builder-chat/route.ts:12,107`

(If Task 2's `tsc` step already forced these edits into that commit, verify they match and skip ahead.)

- [ ] **Step 1: generate-program**

Line 12: replace `SESSION_WARMUP_MIN` with `workingBudgetMin` in the import.
Lines 144 + 154:

```ts
    const workMin = workingBudgetMin(inputs.timePerSessionMinutes)
    const workTimeSec = workMin * 60
```

```ts
    targetExercises = `${inputs.timePerSessionMinutes} min session (working time after warmup + finish-early margins: ${workMin} min) → target ~${exerciseCount} exercises (${compounds} compounds + ${accessories} accessories). Use the style time estimates below to stay within budget.`
```

- [ ] **Step 2: builder-chat**

Line 12: swap `SESSION_WARMUP_MIN` → `workingBudgetMin` in the import.
Line 107: `const workTimeSec = workingBudgetMin(timePerSessionMinutes) * 60`

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean

```bash
git add app/api/generate-program/route.ts app/api/builder-chat/route.ts
git commit -m "feat: program generator and builder chat share the fraction-based working budget"
```

---

### Task 9: full gate, dev-server verification, bookkeeping

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build`
Expected: all clean. Fix anything that surfaces before proceeding.

- [ ] **Step 2: Dev-server verification (local dev DB)**

The seeded local DB (`test@local.dev` / `testpass123`, ~9 logged sessions with set timing) exercises the whole path:

1. `pnpm dev`, log in as the test user.
2. Trigger a prescription for today's session (the AI-periodization card on Home, or `POST /api/ai-periodization/session/<programSessionId>/prescribe` with the session cookie).
3. Confirm in the response: `estimatedSessionDurationMin ≤ workingBudgetMin(60) = 45` (was ≤ 50 before), and the prescription parses/renders normally.
4. Verify the measured path executes: add a temporary `console.log` of one exercise's `timeProfile` in signals (or inspect via the response's reasoning) — the seeded user should produce non-null profiles for exercises with ≥10 timed sets and `null` for the rest, both without error. Remove the log.
5. Regression: open the program builder (generate-program flow) and confirm a program still generates.
   NOTE: seeded timing data may be sparse — profiles being mostly `null` is a **correct** outcome (fallback ladder); the check is that both branches run clean, not that every exercise has measured data.

- [ ] **Step 3: Docs + release bookkeeping (same PR)**

1. `docs/module-map.md`: add a one-line row for `lib/workout/time-profile.ts` (measured per-set work/rest profiles; consumed by AI-periodization signals/enforcement) in the domain-formulas section.
2. `package.json`: **minor** version bump (user-visible planner behaviour change) + matching `lib/changelog.ts` entry, e.g. "Workout planning now learns your real per-set work and rest times (per exercise, per effort band) and reserves a finish-early margin — sessions are planned to end ~10% under your time budget."
3. Remove this plan's entry from `docs/implementation-backlog.md`.
4. Append the session journal entry to the newest `docs/overview/history-*.md` + update `projectOverview.md` (tick the item, note anything unverified).
5. State unexercised failure surfaces in the PR summary: real Gemini prescription output shape (sandbox uses the same schema but live model variance isn't reproduced), and prod data drift (local seed is clean — prod `set_logs` may hold null-heavy timing history; the null-dropping + gates are the defence).

- [ ] **Step 4: Commit + PR per CLAUDE.md (feature branch, green CI, merge-confirmation gate applies — this is a deploying code change)**

---

## Rollout notes — behaviour on existing data & programs (owner Q&A, 2026-07-10)

No migration, backfill, or cleanup is needed anywhere — everything derives at read time from
`set_logs` rows that already exist. These notes are expectation-setting for the first week, not
work items (except where they point at a plan task).

- **History activates the model on day one, not gradually.** The owner has months of timed sets,
  so the ≥10-set gates pass immediately for regular exercises' working bands. The first
  post-deploy prescription already uses measured times — expect a visible change in prescribed
  sets right away, not a slow drift.
- **`timing_baseline_date` is respected — check it once.** The new `getSetTimingRows` keeps the
  same clamp the old lookback had. If early history predates timer discipline (the
  timer-left-running era), the baseline is the reliable exclusion tool; the `robustStats` outlier
  filter is the backstop, not the primary defence.
- **Existing programs may be structurally oversized — this is the expected loud failure, not a
  bug.** Programs were sized under the old math (50 min of work assumed, optimistic constants);
  the new target is 45 min of *measured* work. `fitToBudget` only trims sets (never drops
  exercises, floors are absolute), so an oversized session pins every exercise at its floor and
  the estimate still exceeds the budget. Task 7 Step 5's note surfaces exactly this in the
  prescription. **The owner has confirmed their current program already overruns, so expect this
  note to fire post-deploy.** Adaptation is an owner decision, deliberately not automated:
  remove an accessory from the session (program editor), regenerate the program (the generator
  now sizes against `workingBudgetMin`), or raise `time_budget_minutes` if 60 was never the real
  constraint. Do NOT "fix" this by weakening floors or auto-dropping exercises.
- **Previously generated prescriptions need nothing** — they're superseded at the next prescribe
  call; nothing stale is stored that the new math reads.
- **Post-deploy watch (owner, first 2–3 sessions):** compare the prescription's estimated
  duration against actual (`completed_at − started_at`; the admin time-audit card decomposes any
  gap into warmup/rest/transition buckets). Two dials if reality disagrees: if warmup
  consistently over/undershoots the 15% allowance, replace `WARMUP_FRACTION` with the measured
  warmup median (natural first upgrade — the data is already in `warmup_ended_at`); if sessions
  don't land ~10% early, tune `FINISH_EARLY_FRACTION`. Both are single constants in
  `duration-model.ts`.
- **Known feedback property (accepted by owner):** measured rest reflects rest *taken*, not rest
  *needed* — habitual long rests are planned for (fewer sets fit), not corrected. The on-screen
  rest timer still shows the style target, which remains the tighten-up nudge.

## Self-review notes

- **Spec coverage:** per-set time keyed by reps+pct → Task 1; ≥10 good (outlier-excluded) sets before trusting, defaults until then → `MIN_PROFILE_SAMPLES` gate + ladder (Tasks 1, 5, 7); finish ~10%-of-budget early + percentage warmup → Task 2 fractions, consumed in Tasks 5/8; enforcement uses measured values → Tasks 3/7; AI sees the real times → Task 6.
- **Deliberately not done:** per-set-number granularity inside one exercise (fitToBudget models uniform sets — the AI prescribes one pct/reps/rest per exercise, so band-resolved rest per exercise is exact for its own prescription); planned-pct snapshot on `set_logs` (spec §B3 item 2 — separate plan); changing the `intensity_pct` divisor (§B5.1 — bands absorb it, documented in code).
- **One-Formula check:** all duration math stays in `duration-model.ts` (+ the new profile module it composes with); no re-derivation at call sites. `robustStats` is reused, not copied. The old SQL median moves to the existing `robustAvgSetDurationsByExercise` over the same rows — one query feeds both.
- **Type consistency:** `TimingRow`/`ExerciseTimeProfile`/`resolveMeasuredRestSec` (Task 1) are the names used in Tasks 4-7; `measuredSecPerRep`/`measuredRestSec` (Task 2) are the field names in Tasks 3 and 7; `workingBudgetMin` (Task 2) is the name in Tasks 5 and 8.
