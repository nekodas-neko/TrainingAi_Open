# Batch C — Training Engine Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the real training-engine bugs from `docs/planned_upgrades.md` Batch C (items C1b–C10): one shared, style/BW_REF-aware 1RM estimator used by both the log and edit paths with PR reconciliation; a single 30-rep ceiling with the Brzycki blow-up removed; averaging-rule alignment across bodyweight/baseline paths (averaging is the confirmed design — do NOT switch to max); emergency deloads that don't mutate persisted phase state until accepted and don't re-trigger; one shared volume-load ACWR; deterministic confidence gating; no double-applied autoregulation; correct rep clamping; intensification/realisation ceilings; and the carried C10 items (target-pct from style, muscle normalizer, volume-scaled recovery, reps-aware rpeTrend, weighted-bodyweight inversion, schedule-derived volume divisor, MEV/MAV/MRV landmarks, todayWorkoutVolumeKg window test).

**Architecture:** Two PRs. **PR 1 `fix/shared-1rm-estimator`** (Tasks 1–7): all changes centre on `lib/1rm.ts` — a new exported `estimateOneRm()` becomes the single entry point; `lib/workout/log-exercise.ts`, `app/api/workout-entry/route.ts` (PATCH/DELETE) and `components/workout-screen.tsx` all call it; a new repo method `reconcilePersonalRecord` fixes stale PRs after edits. **PR 2 `fix/periodization-correctness`** (Tasks 8–20): new pure modules `lib/ai-periodization/{acwr,emergency-deload}.ts` and `lib/muscles.ts`; surgical changes to `signals.ts`, `confidence.ts`, `prompt.ts`, `autoregulation.ts`, `phase-guards.ts`, `expected-rpe.ts`, `volume-targets.ts`, `muscle-recovery.ts`, `lib/schedule-utils.ts`, the prescribe/respond routes, and `app/api/readiness-score/route.ts`. Everything testable is a pure function; routes only wire.

**Tech Stack:** TypeScript, Next.js 15 API routes, Drizzle/Postgres (`lib/data/postgres/`), Vitest (`pnpm test`), ESLint (`pnpm lint`), `pnpm exec tsc --noEmit`. Tests mirror `lib/__tests__/1rm.test.ts` / `lib/__tests__/autoregulation.test.ts` idioms exactly: `import { describe, it, expect } from 'vitest'`, plain `describe`/`it`, `toBe`/`toBeCloseTo`/`toMatchObject`, small builder helpers, arithmetic shown in comments.

---

## Scope, exclusions, and global flags

**Deliberate exclusions:**
- **C1's simple reorder** (`advancePhase` before `storePrescription` in the prescribe route) is in the **quick-wins plan, not here**. Task 11 (C1b) *supersedes* it by deleting the `advancePhase` call from the prescribe route entirely — if the quick-win already merged, Task 11 rebases over it; if not, Task 11 makes it moot.
- **No historical-data migration is performed.** Tasks flagged ⚠️ below change `estimated_1rm` / `target_80` values written on **future** logs (and `personal_records` only when an edit/delete triggers reconciliation). Existing rows are left as-is; the strength-trend comparison (`current PR vs previous PR`) tolerates the step change.
- **No new Postgres migrations.** All schema needed already exists (including the unused `session_periodization.pre_emergency_deload_phase` column — we deliberately do **not** start writing it; recording the pre-deload phase for later resume is out of scope).
- PATCH's existing data loss (`DELETE`+`INSERT` of `set_logs` drops `rpe`, `set_time_sec`, `use_for_1rm`, `set_start_ms`) is a pre-existing gap, noted but **not fixed here**.
- `runningEstimate1RM` (live widget) keeps its current semantics; during a baseline/AMRAP week the live number may differ slightly from the saved AMRAP-scaled estimate — verify on device, acceptable.

**⚠️ Tasks that change stored values on future writes:** Task 2 (21–30-rep sets), Task 3 (bodyweight + baseline estimates), Task 5 (`target_80` when the style's top pct ≠ 80), Task 6 (edited logs + `personal_records` via reconcile).

**Branching:** PR 1 on `fix/shared-1rm-estimator`, PR 2 on `fix/periodization-correctness` (branched off PR 1's branch or `main` after PR 1 merges). One commit per task. Commit messages: human-style, why-focused, **no AI attribution/session URLs** (repo rule).

---

## The shared contract (used verbatim in every task below)

Defined once in `lib/1rm.ts` (Task 1), consumed everywhere after. The app's `ExerciseType` is `'weighted' | 'bodyweight'` (`lib/types/program.ts:6`) — there is no `'assisted'` type; assisted work is a bodyweight lift with **negative** `weightKg` (the payload already allows `min(-100)`), handled by `Math.max(1, bwRef + weightKg)`.

```ts
export type OneRmExerciseType = 'weighted' | 'bodyweight'

export interface OneRmSetInput {
  weightKg: number   // bar weight; for bodyweight lifts the ADDED load (negative = assisted)
  reps: number
}

export interface OneRmEstimateOpts {
  exerciseType: OneRmExerciseType
  style?: RMStyleSet[] | null   // per-set { pct, reps, useFor1rm? }
  bwRef?: number                // default BW_REF (100) — reference weight for bodyweight lifts
  isBaseline?: boolean          // baseline/AMRAP week → AMRAP-scaled averaging path
  targetPct?: number            // default: derived from style (Task 5), else 80
}

export interface OneRmEstimate {
  estimated1rm: number
  target80: number    // estimated1rm × targetPct/100, mround 0.25 (name kept — matches the target_80 DB column)
  targetPct: number
}

export function estimateOneRm(sets: OneRmSetInput[], opts: OneRmEstimateOpts): OneRmEstimate
```

Also shared: `export const REP_CEILING = 30` (Task 2), `computeVolumeAcwr` / `AcwrResult` (Task 8), `computeConfidence` (Task 10), `shouldTriggerEmergencyDeload` (Task 11), `intensityZone` / `clampPrescribedPct` (Task 12), `normalizeMuscle` / `moodMuscleMatches` (Task 16), `sessionsRemainingThisWeek` (Task 18), `volumeLandmarks` (Task 19). Use these exact names in every task.

---

# PR 1 — `fix/shared-1rm-estimator` (C2, C3, C4, C10-partial)

## Task 1: Extract `estimateOneRm` (behaviour-preserving refactor)

No numeric behaviour changes in this task — it composes the three existing paths (`calculate1RM` style-averaging, `bodyweightOneRm` best-set, baseline first-set AMRAP) behind the shared signature, and rewires `lib/workout/log-exercise.ts` to call it. Tasks 2–3 then change the semantics with their own tests.

- [ ] **Write failing test** — append to `lib/__tests__/1rm.test.ts`:

```ts
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus, BW_REF, bodyweightOneRm, repMaxFromOneRm, estimateOneRm } from '../1rm'

describe('estimateOneRm — shared estimator (behaviour-preserving extraction)', () => {
  const generalStyle = [
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
    { pct: 60, reps: 12, useFor1rm: false },
  ]

  it('weighted + style: matches calculate1RM exactly', () => {
    // 20 × repFactor(12)=1.42 × prescriptionFactor(60,12)=1/(0.6×1.42) = 33.333 → mround 0.25 → 33.25
    const out = estimateOneRm(
      [{ weightKg: 20, reps: 12 }, { weightKg: 20, reps: 12 }, { weightKg: 20, reps: 12 }],
      { exerciseType: 'weighted', style: generalStyle },
    )
    expect(out.estimated1rm).toBe(33.25)
    expect(out.estimated1rm).toBe(calculate1RM([20, 20, 20], [12, 12, 12], generalStyle).estimated1rm)
    expect(out.target80).toBe(calculate1RM([20, 20, 20], [12, 12, 12], generalStyle).target80)
    expect(out.targetPct).toBe(80)
  })

  it('weighted, no style: 100kg × 5 reps → 114.5', () => {
    // Epley(5) = 1+5/30 = 1.16667 (pure Epley would give 116.67); Brzycki(5) = 36/32 = 1.125
    // this codebase averages them: repFactor(5) = 1.145833 → 100 × 1.145833 = 114.583 → mround 0.25 → 114.5
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted' }).estimated1rm).toBe(114.5)
  })

  it('bodyweight: adds bwRef to the added load, matches legacy best-set path (superseded by Task 3)', () => {
    // effective weights = BW_REF+0 = 100; best set is 10 reps: calc1RM(100,10) = 133.25
    const out = estimateOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(bodyweightOneRm([BW_REF, BW_REF], [6, 10]))
    expect(out.estimated1rm).toBe(133.25)
  })

  it('assisted bodyweight (negative added load) never produces a ≤0 effective weight', () => {
    const out = estimateOneRm([{ weightKg: -120, reps: 8 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBeGreaterThan(0) // effective = max(1, 100−120) = 1
  })

  it('baseline: first-set AMRAP path (superseded by Task 3)', () => {
    // calc1RM(100,10)=133.25 × amrapScaleFactor(10)=0.93 = 123.9225 → mround → 124.0; second set ignored (legacy)
    const out = estimateOneRm(
      [{ weightKg: 100, reps: 10 }, { weightKg: 100, reps: 8 }],
      { exerciseType: 'weighted', isBaseline: true },
    )
    expect(out.estimated1rm).toBe(124.0)
  })

  it('returns 0 for no sets', () => {
    expect(estimateOneRm([], { exerciseType: 'weighted' }).estimated1rm).toBe(0)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failure: `SyntaxError: ... does not provide an export named 'estimateOneRm'` (or TS error `'estimateOneRm' has no exported member`).
- [ ] **Implement** in `lib/1rm.ts` (below `repMaxFromOneRm`):

```ts
export type OneRmExerciseType = 'weighted' | 'bodyweight'

export interface OneRmSetInput { weightKg: number; reps: number }

export interface OneRmEstimateOpts {
  exerciseType: OneRmExerciseType
  style?: RMStyleSet[] | null
  bwRef?: number
  isBaseline?: boolean
  targetPct?: number
}

export interface OneRmEstimate { estimated1rm: number; target80: number; targetPct: number }

// Single entry point for saved 1RM estimates — the log path, the edit (PATCH) path and the
// client preview must all produce the same number for the same sets.
export function estimateOneRm(sets: OneRmSetInput[], opts: OneRmEstimateOpts): OneRmEstimate {
  const { exerciseType, style, bwRef = BW_REF, isBaseline = false } = opts
  const targetPct = opts.targetPct ?? 80
  const weights = sets.map(s => (exerciseType === 'bodyweight' ? Math.max(1, bwRef + s.weightKg) : s.weightKg))
  const reps = sets.map(s => s.reps)

  let estimated1rm: number
  if (exerciseType === 'bodyweight') {
    estimated1rm = bodyweightOneRm(weights, reps)
  } else if (isBaseline && weights[0] && reps[0]) {
    estimated1rm = mround(calc1RM(weights[0], Math.min(reps[0], 36)) * amrapScaleFactor(reps[0]), 0.25)
  } else {
    estimated1rm = calculate1RM(weights, reps, style).estimated1rm
  }
  return { estimated1rm, target80: mround(estimated1rm * targetPct / 100, 0.25), targetPct }
}
```

- [ ] **Rewire `lib/workout/log-exercise.ts`** — replace lines 136–148 (the `if (exerciseType === 'bodyweight') ... else if (isBaseline) ... else` block) with:

```ts
const { estimated1rm, target80 } = estimateOneRm(
  weights.map((w, i) => ({ weightKg: w, reps: reps[i] ?? 0 })),
  { exerciseType, style: progressionStyle, isBaseline },
);
```

Keep the `effectiveWeights` mapping above it — it still feeds `intensityPct` and the `Math.max(1, BW_REF + w)` expression must stay identical to the estimator's internal one. Update the import line to `import { mround, estimateOneRm, BW_REF } from '@/lib/1rm'` (drop now-unused `calc1RM`/`amrapScaleFactor`/`calculate1RM`/`bodyweightOneRm` imports).
- [ ] **Pass:** `pnpm test lib/__tests__/1rm.test.ts` then full `pnpm test` (all suites green — this is a pure refactor).
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Extract shared estimateOneRm so log and edit paths can share one 1RM rule`

## Task 2: ⚠️ C3 — one 30-rep ceiling + freeze Brzycki above 20 reps

`repFactor` currently averages in Brzycki `36/(37−reps)` up to rep 36 — `repFactor(30) = (2 + 36/7)/2 = 3.571`, so a 30-rep set at 100 kg "estimates" 357 kg. Fix: freeze the Brzycki term at 20 reps (above 20, growth comes from Epley alone — "Epley-only above 20" while staying **continuous and monotonic**, which `repMaxFromOneRm`'s scan and `maxRepsAtPct`'s interpolation both require; a hard switch to pure Epley at 21 would *drop* below `repFactor(20)` and break monotonicity). Introduce `REP_CEILING = 30` and use it in every clamp/scan.

- [ ] **Write failing test** — append to `lib/__tests__/1rm.test.ts`:

```ts
import { repFactor, REP_CEILING } from '../1rm' // extend the existing import line

describe('repFactor high-rep behaviour (C3)', () => {
  it('freezes the Brzycki term above 20 reps — no more blow-up', () => {
    // OLD repFactor(30) = (Epley 2.0 + Brzycki 36/7=5.1429)/2 = 3.5714 → calc1RM(100,30) = 357.25 (absurd)
    // NEW = (Epley(30)=2.0 + Brzycki(20)=36/17=2.11765)/2 = 2.05882 → 205.882 → mround 0.25 → 206
    expect(calc1RM(100, 30)).toBe(206)
    // NEW repFactor(25) = (1.83333 + 2.11765)/2 = 1.97549 → 197.549 → 197.5 (old: 241.75)
    expect(calc1RM(100, 25)).toBe(197.5)
  })

  it('is unchanged at and below 20 reps', () => {
    // repFactor(20) = (1.66667 + 36/17=2.11765)/2 = 1.89216 → 189.216 → 189.25
    expect(calc1RM(100, 20)).toBe(189.25)
    expect(calc1RM(100, 5)).toBe(114.5)
  })

  it('stays monotonic across the 20-rep boundary', () => {
    expect(repFactor(21)).toBeGreaterThan(repFactor(20))
    expect(repFactor(30)).toBeGreaterThan(repFactor(29))
  })
})

describe('REP_CEILING (C3)', () => {
  it('repMaxFromOneRm never prescribes more than 30 reps', () => {
    expect(repMaxFromOneRm(100_000)).toBe(REP_CEILING)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failures: missing exports `repFactor`... (already exported) → actual failure text: `expected 357.25 to be 206` and missing `REP_CEILING` export.
- [ ] **Implement** in `lib/1rm.ts`:

```ts
// One rep ceiling for every estimation path — formulas are meaningless past this.
export const REP_CEILING = 30

// Multiplier from weight to estimated 1RM. Average of Epley and Brzycki up to 20 reps;
// above 20 the Brzycki term is FROZEN at its 20-rep value so the curve grows on Epley
// alone — Brzycki's 36/(37−reps) blows up toward rep 36 (order-of-magnitude inflation)
// and freezing keeps the function continuous, monotonic and total.
export function repFactor(reps: number): number {
  const epley = 1 + reps / 30
  const brzycki = 36 / (37 - Math.min(reps, 20))
  return (epley + brzycki) / 2
}
```

(The old `if (reps >= 37) return epley` branch goes away — no singularity remains.) Then replace every hardcoded ceiling: `calculate1RM`'s `r > 30` → `r > REP_CEILING`; `bodyweightOneRm`'s `Math.min(r, 36)` → `Math.min(r, REP_CEILING)`; `repMaxFromOneRm`'s `r <= 40` → `r <= REP_CEILING`; Task 1's baseline `Math.min(reps[0], 36)` → `Math.min(reps[0], REP_CEILING)`.
- [ ] **Pass:** `pnpm test` — full run. Existing suites are unaffected (all existing expectations use reps ≤ 20 or compute expected values via `calc1RM` itself; `expected-rpe.test.ts` only asserts ranges at pct ≥ 70 where `maxRepsAtPct` ≈ 7.9/12.2, unchanged).
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Freeze the Brzycki term above 20 reps and enforce a single 30-rep ceiling — 31-36-rep sets were inflating 1RMs by up to 7x`

## Task 3: ⚠️ C4 + C3 — align bodyweight and baseline paths on AMRAP-scaled **averaging**

**AVERAGING is a confirmed design decision (user, session 176) — do not switch anything to max.** Bodyweight currently takes the *best single set*; baseline takes the *first set only*. Both move to the same rule: per-set AMRAP-scaled estimates (`calcAmrap1RM`, reps capped at `REP_CEILING`), honouring `useFor1rm` subset flags, then averaged — the same self-regulating shape as the barbell path. This also delivers C3's "apply AMRAP scaling in bodyweightOneRm". Known trade-off (state in test comments): the exact reps→estimate→reps round-trip via `repMaxFromOneRm` now only holds for ≤5-rep sets (scale factor 1.0); at moderate reps the REP MAX readout becomes ~2–3 reps conservative, which is the intended inflation control.

- [ ] **Write failing tests** — in `lib/__tests__/1rm.test.ts`, **replace** the `bodyweightOneRm` describe block and the two superseded Task-1 tests with:

```ts
describe('estimateOneRm — bodyweight/baseline AMRAP-scaled averaging (C3+C4)', () => {
  it('bodyweight averages per-set AMRAP-scaled estimates (was: max of best set)', () => {
    // set 1: calcAmrap1RM(100,6)  = mround(calc1RM(100,6)=118.0 × 0.97, .25) = mround(114.46) = 114.5
    // set 2: calcAmrap1RM(100,10) = mround(133.25 × 0.93, .25) = mround(123.9225) = 124.0
    // mean(114.5, 124.0) = 119.25 (old best-set rule: 133.25)
    const out = estimateOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(119.25)
  })

  it('a 34-rep bodyweight AMRAP is capped and scaled, not exploded', () => {
    // reps capped to 30: calc1RM(100,30) = 206 (Task 2) × amrapScaleFactor(30)=0.82 = 168.92 → mround → 169
    // OLD (clamp 36 + live Brzycki): repFactor(34)=(2.1333+36/3=12)/2=7.0667 → ~706.75 ≈ 7×BW_REF
    const out = estimateOneRm([{ weightKg: 0, reps: 34 }], { exerciseType: 'bodyweight' })
    expect(out.estimated1rm).toBe(169)
  })

  it('weighted bodyweight sets score higher than unweighted', () => {
    // calcAmrap1RM(120,6) = mround(calc1RM(120,6)=141.75 × 0.97, .25) = mround(137.4975) = 137.5
    expect(estimateOneRm([{ weightKg: 20, reps: 6 }], { exerciseType: 'bodyweight' }).estimated1rm).toBe(137.5)
  })

  it('honours useFor1rm subset flags like the weighted path', () => {
    const style = [
      { pct: 100, reps: 10, useFor1rm: true },
      { pct: 60, reps: 15, useFor1rm: false },
    ]
    // only set 1 counts: calcAmrap1RM(100,10) = 124.0
    const out = estimateOneRm([{ weightKg: 0, reps: 10 }, { weightKg: 0, reps: 15 }], { exerciseType: 'bodyweight', style })
    expect(out.estimated1rm).toBe(124.0)
  })

  it('baseline averages ALL sets (was: first set only)', () => {
    // set 1: 133.25 × 0.93 = 123.9225 → 124.0 ; set 2: calc1RM(100,8)=125.5 × 0.97 = 121.735 → 121.75
    // mean = 122.875 → mround 0.25 → 123.0 (old first-set-only rule: 124.0)
    const out = estimateOneRm(
      [{ weightKg: 100, reps: 10 }, { weightKg: 100, reps: 8 }],
      { exerciseType: 'weighted', isBaseline: true },
    )
    expect(out.estimated1rm).toBe(123.0)
  })
})
```

Also update the `repMaxFromOneRm` round-trip test: replace `expect(repMaxFromOneRm(bodyweightOneRm([BW_REF], [12]))).toBe(12)` with:

```ts
it('round-trips exactly for ≤5-rep sets; is deliberately conservative above (AMRAP scaling)', () => {
  // ≤5 reps: amrapScaleFactor = 1.0 → exact round trip: calcAmrap1RM(100,5)=114.5, repMax → 5
  expect(repMaxFromOneRm(estimateOneRm([{ weightKg: 0, reps: 5 }], { exerciseType: 'bodyweight' }).estimated1rm)).toBe(5)
  // 12 reps: estimate = calcAmrap1RM(100,12) = mround(142.0 × 0.93) = 132.0; largest r with
  // calc1RM(100,r) ≤ 132.5 is 9 (calc1RM(100,9)=129.25; calc1RM(100,10)=133.25) — conservative by design
  expect(repMaxFromOneRm(estimateOneRm([{ weightKg: 0, reps: 12 }], { exerciseType: 'bodyweight' }).estimated1rm)).toBe(9)
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failure: `expected 133.25 to be 119.25` etc.
- [ ] **Implement** in `lib/1rm.ts`: delete `bodyweightOneRm` (its only remaining callers move in this task) and add the shared averaging helper; rewrite `estimateOneRm`'s branch:

```ts
// Baseline weeks and all bodyweight sets: per-set AMRAP-scaled estimates, averaged.
// Same useFor1rm subset rule and per-set mround as calculate1RM.
function amrapAverage1Rm(weights: number[], reps: number[], style?: RMStyleSet[] | null): number {
  const flagged = style?.some(s => s.useFor1rm)
  const indices = reps.map((_, i) => i).filter(i => !flagged || style![i]?.useFor1rm)
  const perSet = indices
    .map(i => {
      const w = weights[i] ?? 0
      const r = Math.min(reps[i] ?? 0, REP_CEILING)
      return w > 0 && r > 0 ? calcAmrap1RM(w, r) : 0
    })
    .filter(v => v > 0)
  return perSet.length ? mround(perSet.reduce((a, b) => a + b, 0) / perSet.length, 0.25) : 0
}
```

and in `estimateOneRm`:

```ts
let estimated1rm: number
if (exerciseType === 'bodyweight' || isBaseline) {
  estimated1rm = amrapAverage1Rm(weights, reps, style)
} else {
  estimated1rm = calculate1RM(weights, reps, style).estimated1rm
}
```

- [ ] **Rewire the client preview** — `components/workout-screen.tsx:597-600`: replace the `effWeights`/`bodyweightOneRm` pair with `estimateOneRm(snapWeights.map((w, i) => ({ weightKg: w, reps: snapReps[i] ?? 0 })), { exerciseType: 'bodyweight', style: /* the exercise's progressionStyle variable in scope */ }).estimated1rm`, and update the import to `import { calculate1RM, estimateOneRm } from "@/lib/1rm"`. `lib/workout/log-exercise.ts` needs no change (already routed via `estimateOneRm` in Task 1).
- [ ] **Pass:** `pnpm test` (full run — update any other 1rm test now referencing the deleted `bodyweightOneRm` import).
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Align bodyweight and baseline 1RM paths on AMRAP-scaled set averaging — bodyweight lifts progressed on a jumpier best-set rule than barbell lifts`

## Task 4: C4 — PR-semantics decision + display-only best-single-set estimate

**Decision (record it, per the rescoped C4):** `personal_records` keeps storing the best *session average* — prescriptions stay on the average. We add a **display-only** best-single-set estimator so the UI *can* show "best set ever proved ~X kg" later, but we do **not** add a DB column or change any stored value in this task.

- [ ] **Write failing test** — append to `lib/__tests__/1rm.test.ts`:

```ts
describe('bestSetOneRm — display-only best-single-set estimate (C4 decision)', () => {
  it('returns the best single set where the session estimate averages', () => {
    // weighted, no style: per-set calc1RM = 114.5 (100×5) and 133.25 (100×10) → best = 133.25
    expect(bestSetOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' })).toBe(133.25)
    // the saved session estimate is the average — mean(114.5, 133.25)=123.875 → mround ... = 123.875×4=495.5→round 496 → 124.0
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 10 }], { exerciseType: 'weighted' }).estimated1rm).toBe(124.0)
  })

  it('uses AMRAP-scaled per-set values for bodyweight', () => {
    // per-set: 114.5 (6 reps) and 124.0 (10 reps) → best 124.0
    expect(bestSetOneRm([{ weightKg: 0, reps: 6 }, { weightKg: 0, reps: 10 }], { exerciseType: 'bodyweight' })).toBe(124.0)
  })

  it('returns 0 with no valid sets', () => {
    expect(bestSetOneRm([], { exerciseType: 'weighted' })).toBe(0)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failure: no export `bestSetOneRm`.
- [ ] **Implement** in `lib/1rm.ts` — `export function bestSetOneRm(sets: OneRmSetInput[], opts: Pick<OneRmEstimateOpts, 'exerciseType' | 'bwRef'>): number` computing max over per-set values (weighted: `calc1RM`, reps > `REP_CEILING` dropped; bodyweight: `calcAmrap1RM` on `max(1, bwRef + w)`, reps capped). Add a comment block documenting the decision: *PRs = best session average by design (self-regulating, v1.72.0 last-set-push builds on it; a +1-rep gain scales with 1/set-count so progression speed is coupled to programmed set volume — keep in mind when tuning autoregulation thresholds); this function is display-only and is NOT stored.*
- [ ] **Pass**, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] Also append the same decision note to `projectOverview.md`'s known-issues/notes area is **not** done here — the session-end journal handles docs (repo standing instruction).
- [ ] **Commit:** `Add display-only best-set 1RM estimate and document that PRs deliberately store the session average`

## Task 5: ⚠️ C10 — derive `target80` from the active style's pct (stop hardcoding 80%)

- [ ] **Write failing test** — append to `lib/__tests__/1rm.test.ts`:

```ts
describe('estimateOneRm targetPct from style (C10)', () => {
  it('uses the max pct of useFor1rm-flagged sets', () => {
    // single flagged top set 90 kg × 3 at (90%, 3): repFactor(3) = (1.1 + 36/34=1.05882)/2 = 1.07941
    // prescriptionFactor(90,3) = 1/(0.9 × 1.07941) = 1.02937 → 90 × 1.07941 × 1.02937 = 100.0 → est 100.0
    const style = [
      { pct: 90, reps: 3, useFor1rm: true },
      { pct: 70, reps: 8, useFor1rm: false },
    ]
    const out = estimateOneRm([{ weightKg: 90, reps: 3 }, { weightKg: 70, reps: 8 }], { exerciseType: 'weighted', style })
    expect(out.estimated1rm).toBe(100.0)
    expect(out.targetPct).toBe(90)
    expect(out.target80).toBe(90.0) // 100 × 0.9
  })

  it('falls back to the max style pct when nothing is flagged, and to 80 with no style', () => {
    const style = [{ pct: 70, reps: 8 }, { pct: 60, reps: 12 }]
    expect(estimateOneRm([{ weightKg: 70, reps: 8 }], { exerciseType: 'weighted', style }).targetPct).toBe(70)
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted' }).targetPct).toBe(80)
  })

  it('an explicit opts.targetPct always wins', () => {
    expect(estimateOneRm([{ weightKg: 100, reps: 5 }], { exerciseType: 'weighted', targetPct: 85 }).targetPct).toBe(85)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failure: `expected 80 to be 90`.
- [ ] **Implement** in `lib/1rm.ts`:

```ts
function styleTargetPct(style?: RMStyleSet[] | null): number | null {
  if (!style?.length) return null
  const flagged = style.filter(s => s.useFor1rm && s.pct > 0)
  const pool = flagged.length ? flagged : style.filter(s => s.pct > 0)
  return pool.length ? Math.max(...pool.map(s => s.pct)) : null
}
```

and in `estimateOneRm`: `const targetPct = opts.targetPct ?? styleTargetPct(style) ?? 80`. `calculate1RM`'s own internal `* 0.8` stays (legacy callers); the saved value now flows through `estimateOneRm`. **Flag:** future `target_80` values change for styles whose top pct ≠ 80 — the "Load the bar" card (`active-workout-screen.tsx:384-387`) and exercise summary now show the style's true working-weight target.
- [ ] **Pass**, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Derive the target-weight pct from the active style instead of hardcoding 80%`

## Task 6: ⚠️ C2 — PATCH edit path uses the shared estimator + PR reconcile (up AND down)

`app/api/workout-entry/route.ts` PATCH currently calls `calculate1RM(weights, reps)` raw — no style, no `BW_REF` (bodyweight added-load weights of 0 → estimate 0/garbage), and never touches `personal_records`, so correcting a fat-fingered set leaves an inflated PR forever. DELETE has the same stale-PR problem (removing the PR-setting log strands the record), so both get the reconcile call.

- [ ] **New repo method** (no unit-test harness exists for the DB layer — verified on the dev server below; the *estimator* behaviour is already unit-tested). Add to `lib/data/repository.ts`:

```ts
// Recompute the all-time PR for an exercise from surviving exercise_logs (excluding deload
// sessions, mirroring the log path's PR gate) — corrects PRs downward after an edit/delete.
reconcilePersonalRecord(userId: string, exerciseName: string): Promise<void>
```

Implement in `lib/data/postgres/adapter.ts` (or the records slice, following neighbours):

```ts
async reconcilePersonalRecord(userId: string, exerciseName: string): Promise<void> {
  const { rows } = await getPool().query(
    `SELECT el.estimated_1rm, el.logged_at
     FROM exercise_logs el
     JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE ws.user_id = $1 AND el.exercise_name = $2 AND el.estimated_1rm > 0
       AND (ws.phase_type = 'baseline'
            OR NOT (ws.phase_type = 'deload' OR COALESCE(ws.is_early_deload, false)))
     ORDER BY el.estimated_1rm DESC, el.logged_at ASC
     LIMIT 1`,
    [userId, exerciseName],
  )
  if (!rows.length) {
    await this.db.delete(s.personalRecords).where(and(
      eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
    return
  }
  await this.upsertPersonalRecord(userId, exerciseName, Number(rows[0].estimated_1rm))
}
```

(Adapt to the adapter's existing Drizzle style; check the real `workout_sessions` column names — `phase_type` / `is_early_deload` — in `lib/data/postgres/schema.ts` before writing SQL. `upsertPersonalRecord` already exists at `adapter.ts:1962` and sets value + `achieved_at` unconditionally — exactly the downward-capable write we need.)

- [ ] **Rewrite the PATCH body** in `app/api/workout-entry/route.ts`: before the transaction, load context and compute via the shared estimator:

```ts
import { estimateOneRm, BW_REF, type OneRmSetInput } from "@/lib/1rm";
import { getRepository } from "@/lib/data";

// inside PATCH, after ownership check:
const { rows: ctxRows } = await getPool().query(
  `SELECT el.exercise_name, el.style_id, ws.phase_type
   FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
   WHERE el.id = $1`, [exerciseLogId]);
const exerciseName = ctxRows[0].exercise_name as string;
const repo = await getRepository();
const exerciseType = await repo.getExerciseType(exerciseName);
const styles = await repo.listProgressionStyles(userId);
const style = styles.find(st => st.id === ctxRows[0].style_id)?.sets ?? null;
const isBaseline = ctxRows[0].phase_type === 'baseline';

const sets: OneRmSetInput[] = weights.map((w, i) => ({ weightKg: w, reps: reps[i] ?? 0 }));
const { estimated1rm, target80 } = estimateOneRm(sets, { exerciseType, style, isBaseline });
const effectiveWeights = exerciseType === 'bodyweight'
  ? weights.map(w => Math.max(1, BW_REF + w))
  : weights;
// intensity_pct insert uses effectiveWeights[i], not weights[i]
```

(Confirm `ProgressionStyle.sets` items carry `{ pct, reps, useFor1rm }` — they map onto `RMStyleSet`; adapt field access if the type nests differently.) After `COMMIT`, call `await repo.reconcilePersonalRecord(userId, exerciseName)`. In **DELETE**, capture `exercise_name` in the existing pre-delete SELECT and call the same reconcile after `COMMIT`.
- [ ] **Run existing tests:** `pnpm test` (no regressions; estimator behaviour covered by Tasks 1–5).
- [ ] **Dev-server verification (required — route + repo code):** `pnpm db:local`, `pnpm dev`, log in as `test@local.dev` / `testpass123`. (1) Log an exercise, note its PR in `personal_records` (`psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -c "SELECT * FROM personal_records"`). (2) PATCH the log downward via the edit-entry UI (or `curl -X PATCH http://localhost:3000/api/workout-entry -H 'Content-Type: application/json' --cookie <session> -d '{"exerciseLogId":"…","weights":[40],"reps":[5]}'`) → `estimated_1rm` sane and `personal_records` **drops** to the next-best log. (3) Edit a *bodyweight* exercise (seeded or created) → `estimated_1rm` is ~BW_REF-scale, not 0. (4) DELETE the PR-holding log → PR reconciles or the row disappears.
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Route set edits through the shared 1RM estimator and reconcile PRs after edits — bodyweight edits produced garbage 1RMs and inflated PRs were never corrected`

## Task 7: C10 — carry added load through the bodyweight rep-max inversion

`repMaxFromOneRm` always inverts at bare `BW_REF`, so a 1RM earned on **weighted** pull-ups, re-inverted at bare bodyweight and multiplied by pct (`exercise-summary-screen.tsx:199`), prescribes inflated rep targets for weighted sets.

- [ ] **Write failing test** — extend the `repMaxFromOneRm` describe in `lib/__tests__/1rm.test.ts`:

```ts
it('inverts at BW_REF + added load when addedKg is passed (C10)', () => {
  // 1RM proven at +20kg × 6: calc1RM(120,6) = mround(120 × 1.180645) = 141.75
  const est = calc1RM(120, 6)
  // at +20kg: calc1RM(120,6)=141.75 ≤ 142.25, calc1RM(120,7)=120×1.216667=146.0 > → 6 (clean round trip)
  expect(repMaxFromOneRm(est, 20)).toBe(6)
  // at bare bodyweight the same 1RM supports ~12 reps: calc1RM(100,12)=142.0 ≤ 142.25, calc1RM(100,13)=146.75 > → 12
  expect(repMaxFromOneRm(est)).toBe(12)
})
```

- [ ] **Run:** `pnpm test lib/__tests__/1rm.test.ts` — expected failure: TS arity error / `expected 12 to be 6`.
- [ ] **Implement:**

```ts
export function repMaxFromOneRm(oneRm: number, addedKg = 0): number {
  if (oneRm <= 0) return 0
  const ref = Math.max(1, BW_REF + addedKg)
  let best = 1
  for (let r = 1; r <= REP_CEILING; r++) {
    if (calc1RM(ref, r) <= oneRm + 0.5) best = r
    else break
  }
  return best
}
```

- [ ] **Rewire `components/workout/exercise-summary-screen.tsx`:** the REP MAX readouts at lines 67–68 stay at bare bodyweight (that is what "REP MAX" displays). Line 199's next-session rep target changes from `Math.floor((repMaxFromOneRm(newEst1rm) * s.pct) / 100)` to `repMaxFromOneRm(newEst1rm * s.pct / 100, <set's added load>)` — read the component's set-row shape first and pass the set's logged added weight (fall back to `0` if the row genuinely has no weight field), keeping the surrounding `Math.max(s.reps, Math.max(1, …))` floor intact.
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`. Spot-check the exercise summary screen for a bodyweight exercise on `pnpm dev`.
- [ ] **Commit:** `Carry added load through the bodyweight rep-max inversion so weighted variations stop prescribing inflated bodyweight reps`

**PR 1 wrap-up:** push `fix/shared-1rm-estimator`, open the PR, let CI run, test everything in the "After Every Change" checklist on the dev server, then **ask the user before merging** (auto-deploys).

---

# PR 2 — `fix/periodization-correctness` (C1b, C5–C9, C10-rest)

## Task 8: C5 — shared volume-load ACWR helper (+ C10 todayWorkoutVolumeKg window test)

`signals.ts:274-288` counts *sessions of one type* and divides the 28-day count by a flat 4 even when the program is 14–27 days old (ACWR inflated ~2× on new programs → spurious emergency deloads). `readiness-score/route.ts:147-187` already does volume-load ACWR with a real `dataSpanWeeks` divisor. Extract ONE helper; both use it.

- [ ] **Write failing test** — new file `lib/__tests__/acwr.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeVolumeAcwr, type AcwrSession } from '@/lib/ai-periodization/acwr'

// AEST midnight for 2026-07-01 as a UTC instant (GMT+10)
const todayMid = new Date('2026-06-30T14:00:00.000Z')
const daysAgo = (d: number, plusHours = 2) =>
  new Date(todayMid.getTime() - d * 86_400_000 + plusHours * 3_600_000)
const s = (startedAt: Date, volumeKg = 1000): AcwrSession => ({ startedAt, volumeKg })

describe('computeVolumeAcwr', () => {
  it('divides chronic load by the REAL data span, not a flat 4 weeks', () => {
    // 6 × 1000kg sessions spanning 21 days: earliest 21d ago → dataSpanWeeks = 3
    // chronic = 6000 / 3 = 2000 kg/wk; acute (last 7d) = sessions at 6d and 2d ago = 2000 kg
    // acwr = 2000 / 2000 = 1.0  (the old flat ÷4 rule would report 6000/4=1500 → 1.33)
    const sessions = [21, 18, 14, 10, 6, 2].map(d => s(daysAgo(d)))
    const r = computeVolumeAcwr(sessions, todayMid)
    expect(r.dataSpanWeeks).toBeCloseTo(3, 1)
    expect(r.chronicWeeklyAvgKg).toBeCloseTo(2000, 0)
    expect(r.acuteLoadKg).toBe(2000)
    expect(r.acwr).toBeCloseTo(1.0, 5)
  })

  it('returns a null ratio (but real loads) below 21 days of span or 6 sessions', () => {
    const young = [14, 10, 6, 2, 1, 0.5].map(d => s(daysAgo(d)))   // span 14d < 21d
    expect(computeVolumeAcwr(young, todayMid).acwr).toBeNull()
    const few = [21, 14, 7, 3, 1].map(d => s(daysAgo(d)))          // only 5 sessions
    expect(computeVolumeAcwr(few, todayMid).acwr).toBeNull()
    expect(computeVolumeAcwr(few, todayMid).acuteLoadKg).toBeGreaterThan(0)
  })

  it('returns null with a trivial chronic load (< 100 kg/wk) and with no sessions', () => {
    const tiny = [21, 18, 14, 10, 6, 2].map(d => s(daysAgo(d), 10)) // 60kg over 3wk = 20 kg/wk
    expect(computeVolumeAcwr(tiny, todayMid).acwr).toBeNull()
    expect(computeVolumeAcwr([], todayMid).acwr).toBeNull()
  })

  it('todayVolumeKg only counts sessions on or after local midnight (C10 date-window)', () => {
    const sessions: AcwrSession[] = [
      s(new Date('2026-06-30T13:59:00.000Z'), 500),  // 11:59pm June 30 AEST → yesterday, excluded
      s(new Date('2026-06-30T23:00:00.000Z'), 800),  // 9am July 1 AEST → today, included
      ...[21, 18, 14, 10, 6].map(d => s(daysAgo(d))),
    ]
    expect(computeVolumeAcwr(sessions, todayMid).todayVolumeKg).toBe(800)
  })

  it('typicalSessionVolumeKg is the median session volume', () => {
    const sessions = [s(daysAgo(10), 500), s(daysAgo(6), 1000), s(daysAgo(2), 3000)]
    expect(computeVolumeAcwr(sessions, todayMid).typicalSessionVolumeKg).toBe(1000)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/acwr.test.ts` — expected failure: `Cannot find module '@/lib/ai-periodization/acwr'`.
- [ ] **Implement** `lib/ai-periodization/acwr.ts`:

```ts
export interface AcwrSession { startedAt: Date; volumeKg: number }
export interface AcwrOptions { minSpanDays?: number; minSessions?: number; minChronicWeeklyLoadKg?: number }
export interface AcwrResult {
  acwr: number | null
  acuteLoadKg: number
  chronicWeeklyAvgKg: number
  dataSpanWeeks: number
  todayVolumeKg: number
  typicalSessionVolumeKg: number
}

// Volume-load acute:chronic workload ratio over ALL sessions (not one session type).
// Chronic load divides by the REAL data span in weeks, so a 3-week-old program is judged
// against 3 weeks of history, not an imaginary 4 — the flat ÷4 inflated ACWR ~2× on new
// programs and fired spurious emergency deloads.
export function computeVolumeAcwr(sessions: AcwrSession[], todayMid: Date, opts: AcwrOptions = {}): AcwrResult {
  const { minSpanDays = 21, minSessions = 6, minChronicWeeklyLoadKg = 100 } = opts
  const from7d = todayMid.getTime() - 7 * 86_400_000
  let acuteLoadKg = 0, chronicLoad = 0, todayVolumeKg = 0
  let earliest: number | null = null
  const vols: number[] = []
  for (const s of sessions) {
    const t = s.startedAt.getTime()
    chronicLoad += s.volumeKg
    if (t >= from7d) acuteLoadKg += s.volumeKg
    if (t >= todayMid.getTime()) todayVolumeKg += s.volumeKg
    if (s.volumeKg > 0) vols.push(s.volumeKg)
    if (earliest == null || t < earliest) earliest = t
  }
  const spanMs = earliest != null ? todayMid.getTime() - earliest : 0
  const dataSpanWeeks = Math.max(1, spanMs / (7 * 86_400_000))
  const chronicWeeklyAvgKg = chronicLoad / dataSpanWeeks
  const sorted = [...vols].sort((a, b) => a - b)
  const typicalSessionVolumeKg = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const gatesPass =
    spanMs >= minSpanDays * 86_400_000 &&
    sessions.length >= minSessions &&
    chronicWeeklyAvgKg > minChronicWeeklyLoadKg
  return {
    acwr: gatesPass ? acuteLoadKg / chronicWeeklyAvgKg : null,
    acuteLoadKg, chronicWeeklyAvgKg, dataSpanWeeks, todayVolumeKg, typicalSessionVolumeKg,
  }
}
```

- [ ] **Pass**, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Add a shared volume-load ACWR with a real data-span divisor — the session-count ACWR was near-degenerate and inflated ~2x on young programs`

## Task 9: C5 — wire the shared ACWR into signals + readiness-score, fix the prompt gate text

- [ ] **Rewire `lib/ai-periodization/signals.ts`** (lines 274–288): delete the session-count ACWR. Fetch all sessions and compute:

```ts
import { computeVolumeAcwr } from '@/lib/ai-periodization/acwr'
// …
const allRecent = await repo.getWorkoutSessionsFrom(userId, new Date(todayMid.getTime() - 28 * 86_400_000))
const load = computeVolumeAcwr(
  allRecent.map(ws => ({
    startedAt: ws.startedAt,
    volumeKg: ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0),
  })),
  todayMid,
)
const acwr = load.acwr
```

(`getWorkoutSessionsFrom` already exists on the repository — the readiness route uses it.)
- [ ] **Rewire `app/api/readiness-score/route.ts`** (lines 147–187): replace the inline loop with the helper; keep the route's extra program-age gate at the call site so its behaviour is preserved:

```ts
const load = computeVolumeAcwr(
  recentSessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0) })),
  todayMid,
)
const todayWorkoutVolumeKg = load.todayVolumeKg
const typicalSessionVolumeKg = load.typicalSessionVolumeKg
const programAgeMs = program?.startedAt ? todayMid.getTime() - new Date(program.startedAt).getTime() : Infinity
const acwr = programAgeMs >= 28 * 86_400_000 ? load.acwr : null
```

(The helper's 21d/6-session/100kg gates match the route's `hasEnoughHistory && chronicAvg > 100` exactly.)
- [ ] **Fix the prompt gate text** — `lib/ai-periodization/prompt.ts:143`: `ACWR: no data (program < 14 days old)` → `ACWR: no data (needs ≥3 weeks of session history)`.
- [ ] **Run** `pnpm test` (green) and **dev-server check:** `GET /api/readiness-score` returns identical `components.load` shape on the seeded local DB; `POST /api/ai-periodization/session/<id>/prescribe` no longer 500s and its user prompt (log it or inspect via the route response reasoning) shows the volume-based ACWR.
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Use the shared volume-load ACWR in both signals and readiness so the emergency-deload trigger stops firing on session counts`

## Task 10: C6 — deterministic confidence gates the card (cold-start base 0.3)

`prescribe/route.ts:261` stores the **LLM's self-reported** confidence; it then gates auto-apply (`:276`) and the card's low-confidence confirm (`ai-prescription-card.tsx:52,130`). A hallucinated 0.85 auto-applies. Also the engine's base `0.5 + sessions×0.1` can never drop below the 0.4 threshold.

- [ ] **Write failing test** — append to `lib/__tests__/confidence.test.ts`:

```ts
import { computeConfidence, COLD_START_CONFIDENCE_BASE } from '@/lib/ai-periodization/confidence' // extend import

describe('computeConfidence', () => {
  it('cold start sits BELOW the low-confidence threshold', () => {
    const r = computeConfidence({ recentSessionCount: 0, has1rmHistory: false, hasMoodOrSoreness: false, hasAcwr: false, hasSleepOrHrvTrend: false })
    expect(r.confidence).toBeCloseTo(0.3, 5) // base 0.3 + 0 sessions — was 0.5, unreachable gate
    expect(r.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD)
    expect(r.tier).toBe(1)
  })

  it('adds 0.1 per recent session up to 3', () => {
    // 0.3 + 3×0.1 = 0.6
    expect(computeConfidence({ recentSessionCount: 5, has1rmHistory: false, hasMoodOrSoreness: false, hasAcwr: false, hasSleepOrHrvTrend: false }).confidence).toBeCloseTo(0.6, 5)
  })

  it('tier 2 (+0.1) needs 1RM history AND mood/soreness; tier 3 (+0.1) needs ACWR AND a sleep/HRV trend', () => {
    const t2 = computeConfidence({ recentSessionCount: 3, has1rmHistory: true, hasMoodOrSoreness: true, hasAcwr: false, hasSleepOrHrvTrend: false })
    expect(t2).toMatchObject({ tier: 2 })
    expect(t2.confidence).toBeCloseTo(0.7, 5) // 0.3 + 0.3 + 0.1
    const t3 = computeConfidence(full)
    expect(t3).toMatchObject({ tier: 3 })
    expect(t3.confidence).toBeCloseTo(0.8, 5) // 0.3 + 0.3 + 0.1 + 0.1
  })
})
```

(`full` and `LOW_CONFIDENCE_THRESHOLD` already exist in this file — pass `full` as `ConfidenceInputs`; `computeConfidence` takes the same shape.)
- [ ] **Run:** `pnpm test lib/__tests__/confidence.test.ts` — expected failure: no export `computeConfidence`.
- [ ] **Implement** in `lib/ai-periodization/confidence.ts`:

```ts
export const COLD_START_CONFIDENCE_BASE = 0.3

export interface ConfidenceScore { confidence: number; tier: 1 | 2 | 3 }

// Deterministic engine confidence — the ONLY number that gates auto-apply and the card's
// low-confidence confirm. The LLM's self-reported confidence is never trusted for gating.
export function computeConfidence(i: ConfidenceInputs): ConfidenceScore {
  let confidence = COLD_START_CONFIDENCE_BASE + Math.min(i.recentSessionCount, 3) * 0.1
  let tier: 1 | 2 | 3 = 1
  if (i.has1rmHistory && i.hasMoodOrSoreness) { tier = 2; confidence += 0.1 }
  if (i.hasAcwr && i.hasSleepOrHrvTrend) { tier = 3; confidence += 0.1 }
  return { confidence: Math.min(0.95, confidence), tier }
}
```

- [ ] **Rewire `signals.ts`** (lines 322–338): replace the inline scoring with `const { confidence, tier: confidenceTier } = computeConfidence({ recentSessionCount: last5.length, has1rmHistory, hasMoodOrSoreness: soreMusclesInSession.length > 0 || soreMusclesOutOfSession.length > 0 || hasMoodData, hasAcwr: acwr != null, hasSleepOrHrvTrend: sleepTrend != null || hrvTrend != null })` (same inputs the `confidenceFactors` call already builds — reuse one object).
- [ ] **Rewire the prescribe route** — `aiPrescription.confidence: parsed.confidence` → `confidence: signals.confidence`. The LLM's number stays in the response schema but is otherwise ignored (input only). The auto-apply gate (`prescription.confidence >= 0.6`) and the card (`prescription.confidence`, `LOW_CONFIDENCE_THRESHOLD`) now run on the deterministic score with **zero UI changes**. Emergency deloads keep `confidence: 1.0` (deterministic; the card never gates deloads).
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Gate prescription auto-apply on the engine's deterministic confidence, not the model's self-reported number`

## Task 11: C1b — emergency deload must not mutate phase state until accepted, and must not re-trigger

`prescribe/route.ts:141-142` stores the emergency prescription then `advancePhase(...,'deload')` — which (a) wipes the prescription it just stored (`periodization.ts:87-88`), (b) flips the *persisted* phase before the user accepts anything, and (c) zeroes `sessionsInPhase`, and since the trigger is stateless it re-fires on every prescribe call, pinning the counter so the deload floor never accrues. **Supersedes quick-win #2's reorder** (see exclusions).

- [ ] **Write failing test** — new file `lib/__tests__/emergency-deload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldTriggerEmergencyDeload, type EmergencySignals, type EmergencyState } from '@/lib/ai-periodization/emergency-deload'

const calm: EmergencySignals = {
  consecutiveSessionDaysOfThisType: 1,
  hoursSinceLastSession: 72,
  soreMusclesInSession: [],
  acwr: 1.0,
  rpeTrend: null,
  repCompletionRate: null,
}
const idle: EmergencyState = { phase: 'accumulation', prescription: null, prescriptionStatus: 'none', prescriptionExpiresAt: null }
const now = new Date('2026-07-01T00:00:00Z')
const pendingEmergency = (expiresAt: Date): EmergencyState => ({
  phase: 'accumulation',
  prescription: { phase: 'deload', phaseAction: 'deload_recommended', exercises: [], estimatedSessionDurationMin: 30, weeklyVolumeContribution: {}, deload: true, reasoning: '', confidence: 1 },
  prescriptionStatus: 'pending',
  prescriptionExpiresAt: expiresAt,
})

describe('shouldTriggerEmergencyDeload', () => {
  it('fires on each overtraining condition independently', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, consecutiveSessionDaysOfThisType: 4 }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, hoursSinceLastSession: 20, soreMusclesInSession: ['a', 'b', 'c'] }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 1.6 }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, rpeTrend: { avgActual: 9.5, avgExpected: 7, delta: 2.5 } }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, repCompletionRate: 0.6 }, idle, now)).toBe(true)
  })

  it('does not fire on calm signals, and null signals never trigger', () => {
    expect(shouldTriggerEmergencyDeload(calm, idle, now)).toBe(false)
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: null, hoursSinceLastSession: null }, idle, now)).toBe(false)
  })

  it('never re-triggers while already in deload', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, { ...idle, phase: 'deload' }, now)).toBe(false)
  })

  it('never re-triggers while an unexpired emergency prescription is pending', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, pendingEmergency(new Date(now.getTime() + 86_400_000)), now)).toBe(false)
  })

  it('re-arms once the pending prescription expires or was dismissed', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, pendingEmergency(new Date(now.getTime() - 1)), now)).toBe(true)
    const dismissed = { ...pendingEmergency(new Date(now.getTime() + 86_400_000)), prescriptionStatus: 'dismissed' as const }
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, dismissed, now)).toBe(true)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/emergency-deload.test.ts` — expected failure: `Cannot find module '@/lib/ai-periodization/emergency-deload'`.
- [ ] **Implement** `lib/ai-periodization/emergency-deload.ts`:

```ts
import type { PrescriptionSignals } from './signals'
import type { SessionPeriodization } from '@/lib/types/ai-periodization'

export type EmergencySignals = Pick<PrescriptionSignals,
  'consecutiveSessionDaysOfThisType' | 'hoursSinceLastSession' | 'soreMusclesInSession' | 'acwr' | 'rpeTrend' | 'repCompletionRate'>
export type EmergencyState = Pick<SessionPeriodization,
  'phase' | 'prescription' | 'prescriptionStatus' | 'prescriptionExpiresAt'>

// Emergency deloads are OFFERED, not imposed: generating one must not mutate persisted
// phase state (that happens on acceptance), and while one is pending — or the user is
// already deloading — the stateless signal check is suppressed so it can't re-fire on
// every prescribe call and pin sessions_in_phase at 0.
export function shouldTriggerEmergencyDeload(signals: EmergencySignals, state: EmergencyState, now = new Date()): boolean {
  if (state.phase === 'deload') return false
  const p = state.prescription
  if (
    p?.deload && p.phaseAction === 'deload_recommended' &&
    state.prescriptionStatus === 'pending' &&
    state.prescriptionExpiresAt != null && state.prescriptionExpiresAt > now
  ) return false
  return (
    signals.consecutiveSessionDaysOfThisType >= 4 ||
    (signals.hoursSinceLastSession !== null && signals.hoursSinceLastSession < 36 && signals.soreMusclesInSession.length >= 3) ||
    (signals.acwr !== null && signals.acwr > 1.5) ||
    (signals.rpeTrend !== null && signals.rpeTrend.delta > 2.0) ||
    (signals.repCompletionRate !== null && signals.repCompletionRate < 0.7)
  )
}
```

- [ ] **Rewire the prescribe route** (`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`):
  1. Replace the inline `isEmergencyDeload` boolean (lines 80–85) with `shouldTriggerEmergencyDeload(signals, state)`.
  2. Before that check, short-circuit idempotently: if `state.prescription?.deload && state.prescription.phaseAction === 'deload_recommended' && state.prescriptionStatus === 'pending' && state.prescriptionExpiresAt && state.prescriptionExpiresAt > new Date()`, return the stored prescription (`{ prescription: state.prescription, prescriptionStatus: 'pending', estimatedSessionDurationMin: state.prescription.estimatedSessionDurationMin }`) without regenerating.
  3. **Delete** `await repo.advancePhase(userId, programSessionId, 'deload')` (line 142). `storePrescription` alone runs — the persisted phase and `sessionsInPhase` are untouched until acceptance, and the stored prescription now survives a reload.
- [ ] **Move `advancePhase` into the acceptance flow** — `app/api/ai-periodization/session/[sessionId]/respond/route.ts`, in the accept branch before `updatePrescriptionStatus`:

```ts
const p = state.prescription
if (body.action === 'accept' && p.deload && p.phaseAction === 'deload_recommended' && state.phase !== 'deload') {
  await repo.advancePhase(userId, sessionId, 'deload')
  // advancePhase nulls the prescription — re-store it so the accepted deload reaches the bar
  await repo.storePrescription(userId, sessionId, p, state.prescriptionExpiresAt ?? new Date(Date.now() + 7 * 86_400_000))
}
await repo.updatePrescriptionStatus(userId, sessionId, newStatus)
```

(We deliberately do **not** write `pre_emergency_deload_phase` — recording the pre-deload phase for resume is out of scope; the column stays unused.)
- [ ] **Pass** `pnpm test`. **Dev-server verification:** on the local DB, force a trigger (e.g. seed `set_logs` RPEs so `rpeTrend.delta > 2`, or 4 consecutive session days), then: (1) `POST …/prescribe` → response has the deload prescription, `session_periodization.phase` is **unchanged** and `sessions_in_phase` **not** reset (check via psql); (2) `POST …/prescribe` again → same stored prescription returned, no regeneration; (3) `POST …/respond {"action":"accept"}` → phase flips to `deload`, prescription still present (survives `GET` of session state / a reload); (4) dismiss path leaves phase untouched.
- [ ] `pnpm lint && pnpm exec tsc --noEmit`
- [ ] **Commit:** `Offer emergency deloads without mutating phase state until accepted, and stop the stateless trigger re-firing on every prescribe`

## Task 12: C7 — anti-double-apply: neutral in-zone pct from the LLM, deterministic autoreg owns the cut, clamp combined deviation

The prompt hands the model RPE/1RM trends (it picks a lower in-zone pct for a fatigued lift) and `computeRpeAdjustment` then cuts a further 5–10% for the same signals. Fix: (a) restructure `INTENSITY_ZONES` as data so zone bounds are machine-readable, (b) instruct the model to prescribe neutrally, (c) clamp the combined (LLM + autoreg) downward deviation to 10% below the phase-zone floor.

- [ ] **Write failing tests** — append to `lib/__tests__/prompt-zones.test.ts`:

```ts
import { buildSystemPrompt, intensityZone } from '@/lib/ai-periodization/prompt' // extend import

describe('intensityZone (machine-readable zones)', () => {
  it('exposes the same numbers the prompt renders', () => {
    expect(intensityZone('strength', 'accumulation')).toEqual({ pctMin: 70, pctMax: 77.5, repMin: 5, repMax: 8, setsMin: 4, setsMax: 5 })
    expect(intensityZone('powerbuilding', 'realisation')).toEqual({ pctMin: 85, pctMax: 92.5, repMin: 2, repMax: 4, setsMin: 3, setsMax: 4 })
  })
  it('falls back to strength for unknown goals', () => {
    expect(intensityZone('nonsense', 'deload')).toEqual(intensityZone('strength', 'deload'))
  })
})

describe('anti-double-apply instruction (C7)', () => {
  it('tells the model to prescribe neutral in-zone pct and leave fatigue cuts to the engine', () => {
    expect(buildSystemPrompt('strength')).toContain('do NOT pre-emptively lower pct')
  })
})
```

and to `lib/__tests__/autoregulation.test.ts`:

```ts
import { clampPrescribedPct, BACKOFF_MAX_PCT } from '@/lib/ai-periodization/autoregulation' // extend import

describe('clampPrescribedPct — combined-deviation clamp (C7)', () => {
  it('floors the combined LLM+autoreg cut at zone floor − 10%', () => {
    // strength accumulation floor 70 → clamp floor = 70 × (1 − 10/100) = 63.0
    expect(clampPrescribedPct(61, { pctMin: 70 })).toBe(63)
    expect(clampPrescribedPct(63, { pctMin: 70 })).toBe(63)
  })
  it('leaves in-range prescriptions alone', () => {
    expect(clampPrescribedPct(75, { pctMin: 70 })).toBe(75)
    expect(clampPrescribedPct(48, { pctMin: 50 })).toBe(48) // deload zone: floor 45
  })
})
```

- [ ] **Run** both files — expected failures: no export `intensityZone` / `clampPrescribedPct`.
- [ ] **Implement:**
  - `prompt.ts`: `export interface IntensityZone { pctMin: number; pctMax: number; repMin: number; repMax: number; setsMin: number; setsMax: number }`; convert `INTENSITY_ZONES` to `Record<string, Record<'accumulation'|'intensification'|'realisation'|'deload', IntensityZone>>` (transcribe the exact current numbers); `export function intensityZone(trainingGoal: string, phase: string): IntensityZone` with strength fallback; render the prompt block from the data as `\n    ${phase}: ${z.pctMin}-${z.pctMax}%, ${z.repMin}-${z.repMax} reps, ${z.setsMin}-${z.setsMax} sets` — the existing prompt-zones string assertions must stay green (template literals render `77.5` and `70` exactly as before).
  - Add to the system prompt (near the zone table): `Pick a neutral pct inside the phase zone for each exercise. do NOT pre-emptively lower pct for fatigue, RPE, soreness or recovery signals — a deterministic autoregulation layer applies those cuts after you, and lowering it yourself double-applies the reduction.`
  - `autoregulation.ts`: `export` the existing `BACKOFF_MAX_PCT`, and add:

```ts
// Combined-deviation clamp: whatever the model chose plus whatever autoregulation cut,
// the final working pct never lands more than one full back-off (10%) below the phase
// zone's floor. Rounded to 0.5 like all autoreg pcts.
export function clampPrescribedPct(pct: number, zone: { pctMin: number }): number {
  const floor = Math.round(zone.pctMin * (1 - BACKOFF_MAX_PCT / 100) * 2) / 2
  return Math.max(pct, floor)
}
```

  - Prescribe route: inside the autoreg merge loop (after `ex.pct = a.pct`), apply `ex.pct = clampPrescribedPct(ex.pct, intensityZone(signals.trainingGoal, parsed.phase))`.
- [ ] **Pass** `pnpm test` (all prompt-zones assertions green), `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Make the LLM prescribe neutral in-zone pct and clamp the combined cut — autoregulation was stacking on top of the model's own fatigue adjustment`

## Task 13: C8 — only clamp reps when `repDelta !== 0`

`autoregulation.ts:132` clamps reps into the goal band even when `repDelta = 0`, so a pure load back-off also chops a legitimately-higher rep prescription.

- [ ] **Write failing test** — append to `lib/__tests__/autoregulation.test.ts` (inside/next to the existing `applyAutoregulation` describes, reusing the file's `band`/`ctx`/`sig` helpers where present):

```ts
describe('applyAutoregulation — load-only back-off leaves reps alone (C8)', () => {
  it('does not re-clamp an above-band rep prescription when only pct is cut', () => {
    const exercises = [{ sessionExerciseId: 'x', sets: 4, reps: 10, pct: 80 }] // 10 > band.repMax 8
    const signals = [{ sessionExerciseId: 'x', role: 'primary', rpeDelta: 2, rm1Trend: 'down' as const, repCompletionRate: 0.95 }]
    const { exercises: out } = applyAutoregulation(exercises, signals, 'powerbuilding', 'accumulation')
    // back-off: 80 × 0.95 = 76.0 → pct cut applies…
    expect(out[0].pct).toBe(76)
    // …but repDelta is 0, so the 10-rep prescription must survive (old code clamped it to 8)
    expect(out[0].reps).toBe(10)
  })
})
```

- [ ] **Run:** `pnpm test lib/__tests__/autoregulation.test.ts` — expected failure: `expected 8 to be 10`.
- [ ] **Implement** — in `applyAutoregulation`:

```ts
const reps = adj.repDelta !== 0
  ? clamp(ex.reps + adj.repDelta, band.repMin, Math.min(band.repMax, 30))
  : ex.reps
```

- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Stop a load-only back-off from silently re-clamping the rep prescription`

## Task 14: C9 — intensification and realisation ceilings mirroring the accumulation guard

Only accumulation has a ceiling; the prompt claims "realisation→deload always after 2 sessions" but nothing enforces it — a lifter can sit at 87.5–92.5%/1–3 reps indefinitely on repeated `stay`.

- [ ] **Write failing test** — append to `lib/__tests__/phase-guards.test.ts`, mirroring the existing `applyAccumulationCeiling` test idioms in that file (read it first; same prescription-builder style):

```ts
import { applyIntensificationCeiling, INTENSIFICATION_CEILING, applyRealisationCeiling, REALISATION_CEILING } from '@/lib/ai-periodization/phase-guards' // extend import

describe('applyIntensificationCeiling', () => {
  it('forces transition_recommended → realisation at the cap when the AI says stay', () => {
    const out = applyIntensificationCeiling(stayPrescription, 'intensification', INTENSIFICATION_CEILING)
    expect(out.phase).toBe('realisation')
    expect(out.phaseAction).toBe('transition_recommended')
  })
  it('leaves non-stay actions and under-cap counts untouched', () => {
    expect(applyIntensificationCeiling(stayPrescription, 'intensification', INTENSIFICATION_CEILING - 1)).toBe(stayPrescription)
    expect(applyIntensificationCeiling(deloadPrescription, 'intensification', INTENSIFICATION_CEILING)).toBe(deloadPrescription)
    expect(applyIntensificationCeiling(stayPrescription, 'accumulation', INTENSIFICATION_CEILING)).toBe(stayPrescription)
  })
})

describe('applyRealisationCeiling', () => {
  it('forces transition_recommended → deload after 2 realisation sessions (the rule the prompt already promises)', () => {
    const out = applyRealisationCeiling(stayPrescription, 'realisation', REALISATION_CEILING)
    expect(out.phase).toBe('deload')
    expect(out.phaseAction).toBe('transition_recommended')
  })
})
```

(Reuse the fixture prescriptions the file already defines; if it builds them inline, copy that shape — do not invent a new builder.)
- [ ] **Run:** expected failure: no export `applyIntensificationCeiling`.
- [ ] **Implement** in `phase-guards.ts`, mirroring `applyAccumulationCeiling` exactly (same "only a plain stay is overridden" rule, same reasoning-prefix pattern): `INTENSIFICATION_CEILING = 5` (prompt allows transition from 3+; the ceiling is the hard stop, sitting above the minimum like accumulation's 6-over-4) and `REALISATION_CEILING = 2` (matches the prompt's "always after 2 sessions"). Wire the chain in the prescribe route:

```ts
const prescription = applyDeloadFloor(
  applyRealisationCeiling(
    applyIntensificationCeiling(
      applyAccumulationCeiling(aiPrescription, state.phase, state.sessionsInPhase),
      state.phase, state.sessionsInPhase),
    state.phase, state.sessionsInPhase),
  state.phase, state.sessionsInPhase,
)
```

(Guards are mutually exclusive by phase, so order is irrelevant — keep this order for readability.)
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Enforce intensification and realisation ceilings so peak blocks cannot run forever on repeated stay verdicts`

## Task 15: C10 — reps-aware `expectedRpe` drives the program-wide rpeTrend

`signals.ts:163` still feeds the coarse %-only `expectedRpeForPct` into the program-wide `rpeTrend` (the emergency-deload input), flagging honest AMRAP sets as "too hard".

- [ ] **Write failing test** — append to `lib/__tests__/expected-rpe.test.ts`:

```ts
import { expectedRpe, maxRepsAtPct, rpeTrendFromSets } from '@/lib/ai-periodization/expected-rpe' // extend import

describe('rpeTrendFromSets (reps-aware program-wide aggregate)', () => {
  it('computes actual/expected averages with the reps-aware model', () => {
    // 8 reps @ 80%: maxRepsAtPct(80) ≈ 7.89 < 8 → RIR 0 → expected RPE 10
    // three sets at actual RPE 9 → avgActual 9, avgExpected 10, delta −1
    // (the old %-only bucket said expected 8 → delta +1: a false "too hard" flag)
    const sets = [1, 2, 3].map(() => ({ rpe: 9, intensityPct: 80, reps: 8 }))
    const trend = rpeTrendFromSets(sets)
    expect(trend).not.toBeNull()
    expect(trend!.avgActual).toBeCloseTo(9, 5)
    expect(trend!.avgExpected).toBeCloseTo(10, 5)
    expect(trend!.delta).toBeCloseTo(-1, 5)
  })

  it('needs at least 3 rated sets and ignores sets missing rpe or pct', () => {
    expect(rpeTrendFromSets([{ rpe: 9, intensityPct: 80, reps: 8 }, { rpe: 9, intensityPct: 80, reps: 8 }])).toBeNull()
    expect(rpeTrendFromSets([
      { rpe: 9, intensityPct: 80, reps: 8 }, { rpe: null, intensityPct: 80, reps: 8 },
      { rpe: 9, intensityPct: null, reps: 8 }, { rpe: 9, intensityPct: 80, reps: 8 },
    ])).toBeNull() // only 2 usable
  })
})
```

- [ ] **Run:** expected failure: no export `rpeTrendFromSets`.
- [ ] **Implement** in `lib/ai-periodization/expected-rpe.ts`:

```ts
export interface RpeTrendInputSet { rpe: number | null; intensityPct: number | null; reps: number }

export function rpeTrendFromSets(sets: RpeTrendInputSet[]): { avgActual: number; avgExpected: number; delta: number } | null {
  const rated = sets.filter(s => s.rpe != null && s.intensityPct != null)
  if (rated.length < 3) return null
  const avgActual = rated.reduce((sum, s) => sum + s.rpe!, 0) / rated.length
  const avgExpected = rated.reduce((sum, s) => sum + expectedRpe(s.intensityPct!, s.reps), 0) / rated.length
  return { avgActual, avgExpected, delta: avgActual - avgExpected }
}
```

- [ ] **Rewire `signals.ts`:** replace the `withRpe.length >= 3` block (lines 160–164) with `rpeTrend = rpeTrendFromSets(setLogs)` and **delete `expectedRpeForPct`** (grep confirms no other caller remains).
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Drive the program-wide RPE trend with the reps-aware expected-RPE model so AMRAP sets stop reading as overtraining`

## Task 16: C10 — one canonical muscle-name normalizer with synonym fold

`muscle-heatmap.tsx:16-45`, `signals.ts:66-78` and `volume-targets.ts:21-24` each hand-roll their own synonym handling.

- [ ] **Write failing test** — new file `lib/__tests__/muscles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeMuscle, moodMuscleMatches } from '@/lib/muscles'

describe('normalizeMuscle', () => {
  it('lowercases, trims and folds synonyms to one canonical name', () => {
    expect(normalizeMuscle(' Pecs ')).toBe('chest')
    expect(normalizeMuscle('Deltoids')).toBe('shoulders')
    expect(normalizeMuscle('Quadriceps')).toBe('quads')
    expect(normalizeMuscle('gluteal')).toBe('glutes')
    expect(normalizeMuscle('Hamstring')).toBe('hamstrings')
    expect(normalizeMuscle('trapezius')).toBe('traps')
    expect(normalizeMuscle('forearm')).toBe('forearms')
    expect(normalizeMuscle('external oblique')).toBe('obliques')
  })
  it('keeps distinct regions distinct and passes unknowns through lowercased', () => {
    expect(normalizeMuscle('Lats')).toBe('lats')
    expect(normalizeMuscle('Lower Back')).toBe('lower back')
    expect(normalizeMuscle('Tibialis Anterior')).toBe('tibialis anterior')
  })
})

describe('moodMuscleMatches (broad mood-picker labels)', () => {
  it('"Back" covers all back regions; "Shoulders" covers delts', () => {
    expect(moodMuscleMatches('lats', 'Back')).toBe(true)
    expect(moodMuscleMatches('upper back', 'Back')).toBe(true)
    expect(moodMuscleMatches('rear deltoids', 'Shoulders')).toBe(true)
    expect(moodMuscleMatches('chest', 'Back')).toBe(false)
    expect(moodMuscleMatches('biceps', 'Back')).toBe(false)
  })
  it('exact canonical matches work for everything else', () => {
    expect(moodMuscleMatches('Pecs', 'chest')).toBe(true)
  })
})
```

- [ ] **Run:** expected failure: `Cannot find module '@/lib/muscles'`.
- [ ] **Implement** `lib/muscles.ts` — a `SYNONYMS: Record<string, string>` map (pecs→chest, deltoids/deltoid/delts→shoulders, quadriceps→quads, gluteal→glutes, hamstring→hamstrings, trapezius→traps, forearm→forearms, 'external oblique'→obliques, core→abs, rhomboids→'upper back' **only if** the heatmap already folds it — check `MUSCLE_TO_SLUG` and keep granularity the volume-targets table needs), `normalizeMuscle(raw)` = trim/lowercase then fold, and `moodMuscleMatches(exerciseMuscle, moodLabel)` porting `signals.ts`'s `matchesMoodMuscle` logic (broad `back`/`shoulders`/`chest` labels + substring fallback) on normalized inputs.
- [ ] **Rewire the three call sites:** `signals.ts` deletes `matchesMoodMuscle` and imports `moodMuscleMatches`; `volume-targets.ts` normalizes each muscle before the `LARGE_MUSCLES` lookup (and shrinks `LARGE_MUSCLES` to canonical names only — drop `quadriceps`, keep `quads`, etc.); `components/muscle-heatmap.tsx` replaces `norm(muscle)` with `normalizeMuscle(muscle)` and prunes `MUSCLE_TO_SLUG` to canonical keys plus genuinely distinct regions (`lats`/`upper back`/`lower back`/`back` all still map to their slugs). `lib/ai-periodization/muscle-recovery.ts`'s `normMuscle` also switches to `normalizeMuscle`.
- [ ] **Pass** `pnpm test` (including the existing `volume-targets.test.ts`), `pnpm lint && pnpm exec tsc --noEmit`. Spot-check the heatmap renders on `pnpm dev` (workout screen).
- [ ] **Commit:** `Fold muscle-name synonyms through one canonical normalizer instead of three divergent maps`

## Task 17: C10 — muscle-recovery time-constant scaled by session volume

`muscle-recovery.ts:33` uses a fixed 24 h time-constant regardless of how big the session was.

- [ ] **Write failing test** — new file `lib/__tests__/muscle-recovery.test.ts` (build minimal `WorkoutSession`/`ExerciseLibraryEntry` fixtures matching the types in `lib/types/log` and `lib/types/program` — copy field shape from `lib/health/__tests__/strength-progress.test.ts` fixtures if helpful):

```ts
import { describe, it, expect } from 'vitest'
import { computeMuscleRecovery } from '@/lib/ai-periodization/muscle-recovery'

const NOW = Date.parse('2026-07-01T00:00:00Z')
const library = [
  { id: 'e1', name: 'Bench Press', muscles: [{ muscle: 'chest', role: 'main' as const }], equipment: [], exerciseType: 'weighted' as const },
]
const session = (hoursAgo: number, volume: number) => ({
  id: `ws-${hoursAgo}`, startedAt: new Date(NOW - hoursAgo * 3_600_000),
  exercises: [{ exerciseName: 'Bench Press', volume }],
}) as never // cast to WorkoutSession-compatible; keep only the fields computeMuscleRecovery reads

describe('computeMuscleRecovery — volume-scaled time constant (C10)', () => {
  it('a typical-volume bout recovers on the 24h constant: 63% at 24h', () => {
    // ratio = latest bout 1000 / median 1000 = 1 → tau 24 → pct = 100×(1−e^(−24/24)) = 63.212 → 63
    const out = computeMuscleRecovery([session(24, 1000)], library, { now: NOW })
    expect(out).toEqual([{ muscle: 'chest', pct: 63, hoursAgo: 24 }])
  })

  it('a double-volume bout recovers slower', () => {
    // bouts [1000, 1000, 2000] → median 1000; latest bout 2000 → ratio 2 → tau = clamp(48,16,48) = 48
    // pct at 24h = 100×(1−e^(−24/48)) = 39.347 → 39
    const out = computeMuscleRecovery([session(24, 2000), session(96, 1000), session(168, 1000)], library, { now: NOW })
    expect(out.find(m => m.muscle === 'chest')!.pct).toBe(39)
  })

  it('a light bout recovers faster (tau floors at 16h)', () => {
    // latest 500 vs median 1000 → ratio 0.5 → tau = clamp(12,16,48) = 16 → 100×(1−e^(−24/16)) = 77.687 → 78
    const out = computeMuscleRecovery([session(24, 500), session(96, 1000), session(168, 1000)], library, { now: NOW })
    expect(out.find(m => m.muscle === 'chest')!.pct).toBe(78)
  })
})
```

- [ ] **Run:** expected failure: arity/`expected 63 to be 39` (current fixed-24h output) or TS error on the third argument.
- [ ] **Implement** — rewrite `computeMuscleRecovery(sessions, library, opts?: { now?: number })`: per muscle, collect every bout `{ trainedMs, volumeKg }` (sum of `ex.volume ?? 0` over that session's exercises whose library entry lists the muscle as `main`); latest bout wins as before; `typical` = median bout volume for that muscle across the window (`sorted[Math.floor(n/2)]`, the same upper-median the readiness route uses); `ratio = typical > 0 ? latestVolume / typical : 1`; `tau = Math.min(48, Math.max(16, 24 * ratio))`; `pct = Math.min(100, Math.round(100 * (1 - Math.exp(-hoursAgo / tau))))`; `now = opts?.now ?? Date.now()`. Keep the 168 h `hoursAgo` cap and the return shape (`MuscleRecovery`) unchanged — both callers (`app/api/muscle-recovery/route.ts:28`, `adapter.ts:1278`) need no changes.
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Scale muscle-recovery time constants by session volume instead of a flat 24h`

## Task 18: C10 — per-session volume divisor derived from the schedule

`signals.ts:262` divides the remaining weekly volume budget by `ceil(program.sessions.length / 2)` — unrelated to how many sessions are actually left this week.

- [ ] **Write failing test** — append to `lib/__tests__/schedule-utils.test.ts` (mirroring its existing fixture style for `Program`):

```ts
import { getScheduledSessionsPerWeek, sessionsRemainingThisWeek } from '@/lib/schedule-utils' // extend import

describe('sessionsRemainingThisWeek', () => {
  it('prorates the weekly cadence by days left in the week', () => {
    // weekly schedule, 5 training days: full week → 5; 3 days left → ceil(5×3/7)=3; last day → ceil(5/7)=1
    expect(sessionsRemainingThisWeek(fiveDayProgram, 7)).toBe(5)
    expect(sessionsRemainingThisWeek(fiveDayProgram, 3)).toBe(3)
    expect(sessionsRemainingThisWeek(fiveDayProgram, 1)).toBe(1)
  })
  it('handles rotation schedules via the derived weekly cadence', () => {
    // rotation restAfterN=3 → round(3×7/4)=5/wk → 3 days left → ceil(15/7)=3
    expect(sessionsRemainingThisWeek(rotationProgram, 3)).toBe(3)
  })
  it('never returns less than 1', () => {
    expect(sessionsRemainingThisWeek(noScheduleProgram, 0)).toBe(1)
  })
})
```

(Build `fiveDayProgram`/`rotationProgram`/`noScheduleProgram` fixtures the way the file already builds programs for `getScheduledSessionsPerWeek`.)
- [ ] **Run:** expected failure: no export `sessionsRemainingThisWeek`.
- [ ] **Implement** in `lib/schedule-utils.ts`:

```ts
// Sessions the user still has scheduled this week (including today) — divides the remaining
// weekly volume budget. Prorates the schedule-derived weekly cadence by days left rather
// than assuming half the program's session list runs every week.
export function sessionsRemainingThisWeek(program: Program, daysLeftInWeek: number): number {
  const perWeek = getScheduledSessionsPerWeek(program)
  return Math.max(1, Math.ceil(perWeek * Math.max(0, daysLeftInWeek) / 7))
}
```

- [ ] **Rewire `signals.ts`:** replace `const sessionsRemaining = Math.max(1, Math.ceil(program.sessions.length / 2))` with

```ts
const daysIntoWeek = Math.round((Date.parse(today) - Date.parse(weekStart)) / 86_400_000) // 0..6
const sessionsRemaining = sessionsRemainingThisWeek(program, 7 - daysIntoWeek)
```

(`weekStart`/`today` are the existing `yyyy-MM-dd` strings already in scope; `Date.parse` of two same-format date strings gives a clean day diff.)
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Divide the weekly volume budget by sessions actually remaining this week, derived from the schedule`

## Task 19: C10 — MEV/MAV/MRV landmarks per muscle

Builds on the live volume-targets: expose evidence-informed landmarks around the existing per-goal target (treated as MAV) and use them to (a) inform the model and (b) cap the deterministic per-session budget at MRV.

- [ ] **Write failing test** — append to `lib/__tests__/volume-targets.test.ts` (mirror its existing style):

```ts
import { computeDefaultVolumeTargets, volumeLandmarks } from '@/lib/ai-periodization/volume-targets' // extend import

describe('volumeLandmarks', () => {
  it('brackets the existing goal target (MAV) with MEV and MRV', () => {
    // hypertrophy large: MAV 18 → MEV round(18×0.5)=9, MRV round(18×1.4)=25
    expect(volumeLandmarks('hypertrophy', 'chest')).toEqual({ mev: 9, mav: 18, mrv: 25 })
    // strength small: MAV 8 → MEV max(4, round(4))=4, MRV round(11.2)=11
    expect(volumeLandmarks('strength', 'biceps')).toEqual({ mev: 4, mav: 8, mrv: 11 })
  })
  it('normalizes synonyms and falls back to strength for unknown goals', () => {
    expect(volumeLandmarks('hypertrophy', 'Quadriceps')).toEqual(volumeLandmarks('hypertrophy', 'quads'))
    expect(volumeLandmarks('nonsense', 'chest').mav).toBe(12)
  })
})
```

- [ ] **Run:** expected failure: no export `volumeLandmarks`.
- [ ] **Implement** in `lib/ai-periodization/volume-targets.ts`:

```ts
import { normalizeMuscle } from '@/lib/muscles'

export interface VolumeLandmarks { mev: number; mav: number; mrv: number }

// MEV/MAV/MRV weekly-set landmarks per muscle. The existing goal target IS the MAV; MEV/MRV
// bracket it so the engine can steer volume inside a band instead of one fixed number.
export function volumeLandmarks(trainingGoal: string, muscle: string): VolumeLandmarks {
  const landmarks = GOAL_VOLUME[trainingGoal] ?? GOAL_VOLUME.strength
  const mav = LARGE_MUSCLES.has(normalizeMuscle(muscle)) ? landmarks.large : landmarks.small
  return { mev: Math.max(4, Math.round(mav * 0.5)), mav, mrv: Math.round(mav * 1.4) }
}
```

- [ ] **Wire:** in `signals.ts`, cap each budget at the MRV headroom: `volumeBudgetPerMuscleGroup[mg] = Math.min(Math.ceil(Math.max(0, target - logged) / sessionsRemaining), Math.max(0, volumeLandmarks(program.trainingGoal, mg).mrv - logged))`. In `prompt.ts`'s volume lines, append the band: `` `… budget ${…} sets this session (MEV ${lm.mev} · MRV ${lm.mrv})` `` via `volumeLandmarks(signals.trainingGoal, mg)`.
- [ ] **Pass** `pnpm test`, `pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Commit:** `Bracket weekly volume targets with MEV/MAV/MRV landmarks and cap session budgets at MRV headroom`

## Task 20: Final verification + self-review

- [ ] `pnpm test` — full suite green. `pnpm lint` clean. `pnpm exec tsc --noEmit` clean. `pnpm build` succeeds.
- [ ] **Dev-server end-to-end** (`pnpm db:local && pnpm dev`, `test@local.dev`): log a full session (weighted + bodyweight exercise) → sane `estimated_1rm`/`target_80`; edit a set down → PR drops; hit `POST /api/ai-periodization/session/<id>/prescribe` → prescription stores, phase untouched, confidence equals the deterministic score; accept an emergency deload → phase flips only then; `GET /api/readiness-score` unchanged shape; heatmap + muscle-recovery cards render.
- [ ] **Self-review — every Batch-C sub-item has a task:** C1 reorder = excluded (quick-wins; superseded by Task 11) ✓ · C1b = Task 11 ✓ · C2 = Tasks 1, 6 ✓ · C3 = Tasks 2, 3 ✓ · C4 = Tasks 3, 4 (averaging confirmed, best-set display-only, 1/set-count property documented) ✓ · C5 = Tasks 8, 9 (incl. prompt gate text) ✓ · C6 = Task 10 ✓ · C7 = Task 12 ✓ · C8 = Task 13 ✓ · C9 = Task 14 ✓ · C10 = Tasks 5 (target80-from-style), 7 (weighted-BW inversion), 8 (todayWorkoutVolumeKg window test), 15 (reps-aware rpeTrend), 16 (muscle normalizer), 17 (recovery time-constant), 18 (schedule divisor), 19 (MEV/MAV/MRV) ✓.
- [ ] **Signature consistency check:** `estimateOneRm(sets: OneRmSetInput[], opts: OneRmEstimateOpts): OneRmEstimate` is the only estimator entry point used in Tasks 1–7; `REP_CEILING`, `computeVolumeAcwr`, `computeConfidence`, `shouldTriggerEmergencyDeload`, `intensityZone`, `clampPrescribedPct`, `rpeTrendFromSets`, `normalizeMuscle`, `sessionsRemainingThisWeek`, `volumeLandmarks` are named identically at definition and every use site.
- [ ] Update `projectOverview.md` roadmap ticks for shipped items; bump `package.json` version + `lib/changelog.ts` entry (minor — behaviour changes user-visible in prescriptions/1RMs) at merge time per standing instructions.
- [ ] **Ask the user before merging each PR** (auto-deploys to production).
