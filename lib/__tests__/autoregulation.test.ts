import { describe, it, expect } from 'vitest'
import {
  computeRpeAdjustment,
  applyAutoregulation,
  clampPrescribedPct,
  type AutoregSignal,
  type AutoregContext,
} from '@trainingai/shared/ai-periodization/autoregulation'

const band = { repMin: 2, repMax: 8 } // powerbuilding compound band
const ctx = (over: Partial<AutoregContext> = {}): AutoregContext => ({
  phase: 'accumulation',
  currentReps: 6,
  band,
  ...over,
})
const sig = (over: Partial<AutoregSignal> = {}): AutoregSignal => ({
  role: 'primary',
  rpeDelta: 0,
  rm1Trend: 'flat',
  repCompletionRate: 1,
  ...over,
})

describe('computeRpeAdjustment — no-op cases', () => {
  it('does nothing without RPE data', () => {
    expect(computeRpeAdjustment(sig({ rpeDelta: null }), ctx())).toMatchObject({ pctMultiplier: 1, repDelta: 0, setDelta: 0 })
  })

  it('does nothing in baseline or deload phases', () => {
    expect(computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'down' }), ctx({ phase: 'deload' })).note).toBeNull()
    expect(computeRpeAdjustment(sig({ rpeDelta: -2 }), ctx({ phase: 'baseline' })).note).toBeNull()
  })

  it('high RPE alone (1RM still up) does NOT back off — the healthy hard session', () => {
    expect(computeRpeAdjustment(sig({ rpeDelta: 2.5, rm1Trend: 'up' }), ctx()).pctMultiplier).toBe(1)
  })

  it('1RM down alone (RPE on target) does NOT cut — reps math handles it', () => {
    expect(computeRpeAdjustment(sig({ rpeDelta: 0, rm1Trend: 'down' }), ctx()).pctMultiplier).toBe(1)
  })

  it('ignores a delta inside the ±1.5 dead-band', () => {
    expect(computeRpeAdjustment(sig({ rpeDelta: 1.0, rm1Trend: 'down' }), ctx()).pctMultiplier).toBe(1)
    expect(computeRpeAdjustment(sig({ rpeDelta: -1.0 }), ctx()).repDelta).toBe(0)
  })
})

describe('computeRpeAdjustment — back-off (RPE high AND 1RM down)', () => {
  it('cuts 5% when you missed by ~a rep (completion ≥ 0.95)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'down', repCompletionRate: 0.95 }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.95, 5)
    expect(r.note).toContain('5%')
  })

  it('cuts the full 10% when you missed badly (completion ≤ 0.70)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 3, rm1Trend: 'down', repCompletionRate: 0.6 }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.90, 5)
    expect(r.note).toContain('10%')
  })

  it('scales linearly in between (completion 0.825 → 7.5%)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'down', repCompletionRate: 0.825 }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.925, 5)
  })

  it('uses the mildest 5% cut when completion is unknown', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'down', repCompletionRate: null }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.95, 5)
  })

  it('never touches reps or sets on a back-off', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'down', repCompletionRate: 0.6 }), ctx())
    expect(r.repDelta).toBe(0)
    expect(r.setDelta).toBe(0)
  })
})

describe('computeRpeAdjustment — back-off (RPE high AND reps missed, 1RM NOT down)', () => {
  it('cuts load when reps fell short at high RPE even though 1RM is flat', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'flat', repCompletionRate: 0.89 }), ctx())
    expect(r.pctMultiplier).toBeLessThan(1)
    expect(r.repDelta).toBe(0) // reps held — only the load drops
    expect(r.setDelta).toBe(0)
    expect(r.note).toContain('fell short of the prescribed reps')
  })

  it('cuts load when reps fell short at high RPE even though 1RM is rising', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2.5, rm1Trend: 'up', repCompletionRate: 0.6 }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.90, 5) // missed badly → full 10% cut
    expect(r.note).toContain('fell short')
  })

  it('scales the cut by how far short the reps fell (0.825 → 7.5%)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: 2, rm1Trend: 'flat', repCompletionRate: 0.825 }), ctx())
    expect(r.pctMultiplier).toBeCloseTo(0.925, 5)
  })

  it('does NOT back off when every rep was completed at high RPE on a non-regressing lift', () => {
    // The healthy hard session: hard but clean and complete → left alone.
    expect(computeRpeAdjustment(sig({ rpeDelta: 2.5, rm1Trend: 'flat', repCompletionRate: 1 }), ctx()).pctMultiplier).toBe(1)
    expect(computeRpeAdjustment(sig({ rpeDelta: 2.5, rm1Trend: 'up', repCompletionRate: 1 }), ctx()).pctMultiplier).toBe(1)
  })

  it('does NOT back off on a missed rep target when RPE was on target (inside the dead-band)', () => {
    // A miss at normal RPE isn't a too-heavy signal — could be time/fatigue elsewhere.
    expect(computeRpeAdjustment(sig({ rpeDelta: 0.5, rm1Trend: 'flat', repCompletionRate: 0.7 }), ctx()).pctMultiplier).toBe(1)
  })
})

describe('computeRpeAdjustment — push (RPE low AND progressing AND reps met)', () => {
  it('+1 target rep when mildly easy (Δ ≈ −1.5)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -1.5, rm1Trend: 'up', repCompletionRate: 1 }), ctx({ currentReps: 6 }))
    expect(r.repDelta).toBe(1)
    expect(r.setDelta).toBe(0)
  })

  it('+2 target reps when very easy (Δ ≤ −2), clamped to the band ceiling', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -2.5, rm1Trend: 'flat', repCompletionRate: 1 }), ctx({ currentReps: 6 }))
    expect(r.repDelta).toBe(2) // 6 → 8 (ceiling), fits
  })

  it('does not push reps past the band ceiling', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -2.5, rm1Trend: 'up', repCompletionRate: 1 }), ctx({ currentReps: 7 }))
    expect(r.repDelta).toBe(1) // 7 → 8 only
  })

  it('accessory at the ceiling earns a set instead of more reps', () => {
    const r = computeRpeAdjustment(
      sig({ role: 'accessory', rpeDelta: -2, rm1Trend: 'up', repCompletionRate: 1.1 }),
      ctx({ currentReps: 8, band }),
    )
    expect(r.repDelta).toBe(0)
    expect(r.setDelta).toBe(1)
  })

  it('compound at the ceiling does nothing extra — the earned 1RM carries the load', () => {
    const r = computeRpeAdjustment(
      sig({ role: 'primary', rpeDelta: -2, rm1Trend: 'up', repCompletionRate: 1 }),
      ctx({ currentReps: 8, band }),
    )
    expect(r).toMatchObject({ pctMultiplier: 1, repDelta: 0, setDelta: 0 })
  })

  it('does not push when reps were NOT met (completion < 1)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -2, rm1Trend: 'up', repCompletionRate: 0.8 }), ctx())
    expect(r.repDelta).toBe(0)
  })

  it('does not push when completion is unknown (Q-299) — missing data must not read as met', () => {
    // Before the fix, `repCompletionRate ?? 1` treated no data as a completed set, so a low RPE
    // alone was enough to add load with zero rep-completion evidence — the mirror of the back-off
    // path, which already treats unknown completion as "not proven missed" rather than "missed".
    const r = computeRpeAdjustment(sig({ rpeDelta: -2.5, rm1Trend: 'up', repCompletionRate: null }), ctx())
    expect(r).toMatchObject({ pctMultiplier: 1, repDelta: 0, setDelta: 0 })
  })

  it('does not push reps in a low-rep peak (realisation)', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -2, rm1Trend: 'up', repCompletionRate: 1 }), ctx({ phase: 'realisation' }))
    expect(r.note).toBeNull()
  })

  it('does not push a regressing lift even if it felt easy', () => {
    const r = computeRpeAdjustment(sig({ rpeDelta: -2, rm1Trend: 'down', repCompletionRate: 1 }), ctx())
    expect(r.repDelta).toBe(0)
  })
})

describe('applyAutoregulation — whole prescription', () => {
  const exercises = [
    { sessionExerciseId: 'bench', sets: 4, reps: 6, pct: 80 },
    { sessionExerciseId: 'raise', sets: 3, reps: 8, pct: 65 },
  ]

  it('applies a back-off cut to a hard, regressing compound and rounds pct to 0.5', () => {
    const signals = [
      { sessionExerciseId: 'bench', role: 'primary', rpeDelta: 2, rm1Trend: 'down' as const, repCompletionRate: 0.6 },
    ]
    const { exercises: out, notes } = applyAutoregulation(exercises, signals, 'powerbuilding', 'accumulation')
    const bench = out.find(e => e.sessionExerciseId === 'bench')!
    expect(bench.pct).toBe(72) // 80 × 0.90 = 72
    // Both signals present (1RM down + badly missed reps) — the note leads with the
    // more actionable missed-rep reason.
    expect(notes['bench']).toContain('fell short')
  })

  it('reports the 1RM-slip reason when the lift regressed but reps were completed', () => {
    const signals = [
      { sessionExerciseId: 'bench', role: 'primary', rpeDelta: 2, rm1Trend: 'down' as const, repCompletionRate: 1 },
    ]
    const { exercises: out, notes } = applyAutoregulation(exercises, signals, 'powerbuilding', 'accumulation')
    expect(out.find(e => e.sessionExerciseId === 'bench')!.pct).toBe(76) // 80 × 0.95 (mildest cut, reps met)
    expect(notes['bench']).toContain('slipped')
  })

  it('pushes reps on an easy, progressing accessory and marks an earned set at the ceiling', () => {
    const signals = [
      { sessionExerciseId: 'raise', role: 'accessory', rpeDelta: -2, rm1Trend: 'up' as const, repCompletionRate: 1.2 },
    ]
    // accessory band is 8–15; currentReps 8 is below ceiling → reps climb, no earned set yet
    const { exercises: out, earnedSetIds } = applyAutoregulation(exercises, signals, 'powerbuilding', 'accumulation')
    const raise = out.find(e => e.sessionExerciseId === 'raise')!
    expect(raise.reps).toBeGreaterThan(8)
    expect(earnedSetIds.has('raise')).toBe(false)
  })

  it('leaves exercises without a matching signal untouched', () => {
    const { exercises: out, notes } = applyAutoregulation(exercises, [], 'powerbuilding', 'accumulation')
    expect(out).toEqual(exercises)
    expect(Object.keys(notes)).toHaveLength(0)
  })

  it('a load-only back-off does not re-clamp an above-band rep prescription (C8)', () => {
    // bench prescribed at 10 reps, above the powerbuilding compound band ceiling (8) —
    // a pure load cut (repDelta 0) must leave that rep count alone, not snap it back into band.
    const aboveBand = [{ sessionExerciseId: 'bench', sets: 4, reps: 10, pct: 80 }]
    const signals = [
      { sessionExerciseId: 'bench', role: 'primary', rpeDelta: 2, rm1Trend: 'down' as const, repCompletionRate: 0.6 },
    ]
    const { exercises: out } = applyAutoregulation(aboveBand, signals, 'powerbuilding', 'accumulation')
    expect(out[0].reps).toBe(10)
  })
})

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

  it('ceilings the combined LLM+autoreg pct at the zone ceiling when pctMax is supplied', () => {
    // strength accumulation: pctMin 70, pctMax 77.5 (lib/ai-periodization/prompt.ts)
    expect(clampPrescribedPct(98, { pctMin: 70, pctMax: 77.5 })).toBe(77.5)
    expect(clampPrescribedPct(75, { pctMin: 70, pctMax: 77.5 })).toBe(75) // in-range, untouched
  })

  it('stays floor-only when pctMax is omitted (back-compat for callers with no zone ceiling)', () => {
    expect(clampPrescribedPct(500, { pctMin: 70 })).toBe(500)
  })
})
