import { describe, it, expect } from 'vitest'
import { expectedRpe, maxRepsAtPct, pctForExpectedRpe, rpeTrendFromSets } from '@trainingai/shared/ai-periodization/expected-rpe'

describe('pctForExpectedRpe', () => {
  it('round-trips with expectedRpe (within 0.3 RPE) across rep ranges', () => {
    for (const targetRpe of [7, 8, 8.5, 9]) {
      for (const reps of [6, 8, 10, 12, 15]) {
        const pct = pctForExpectedRpe(targetRpe, reps)
        expect(Math.abs(expectedRpe(pct, reps) - targetRpe)).toBeLessThanOrEqual(0.3)
      }
    }
  })

  it('holds effort constant as reps rise — more reps => lighter load', () => {
    const at8 = pctForExpectedRpe(8, 8)
    const at12 = pctForExpectedRpe(8, 12)
    const at15 = pctForExpectedRpe(8, 15)
    expect(at8).toBeGreaterThan(at12)
    expect(at12).toBeGreaterThan(at15)
  })

  it('reproduces the reference case: RPE 8 @ 12 reps ≈ 66%', () => {
    expect(pctForExpectedRpe(8, 12)).toBeGreaterThan(63)
    expect(pctForExpectedRpe(8, 12)).toBeLessThan(69)
  })
})

describe('maxRepsAtPct', () => {
  it('is ~1 rep at 100% and grows as % drops', () => {
    expect(maxRepsAtPct(100)).toBeCloseTo(1, 1)
    expect(maxRepsAtPct(80)).toBeGreaterThan(maxRepsAtPct(90))
    expect(maxRepsAtPct(70)).toBeGreaterThan(maxRepsAtPct(80))
  })

  it('matches the common gym heuristics (~8 reps @ 80%, ~12 @ 70%)', () => {
    expect(maxRepsAtPct(80)).toBeGreaterThan(6)
    expect(maxRepsAtPct(80)).toBeLessThan(10)
    expect(maxRepsAtPct(70)).toBeGreaterThan(10)
    expect(maxRepsAtPct(70)).toBeLessThan(14)
  })
})

describe('expectedRpe', () => {
  it('rises as you do more reps at a fixed load (reps-aware)', () => {
    expect(expectedRpe(80, 3)).toBeLessThan(expectedRpe(80, 6))
    expect(expectedRpe(80, 6)).toBeLessThan(expectedRpe(80, 8))
  })

  it('expects a hard grind for a set taken to ~failure (AMRAP → ~10)', () => {
    // doing max reps at a load → RIR ≈ 0 → expected RPE ≈ 10
    const maxAt80 = Math.round(maxRepsAtPct(80))
    expect(expectedRpe(80, maxAt80)).toBeGreaterThanOrEqual(9)
  })

  it('an AMRAP set that hits max reps produces a delta ≈ 0 (no false "too hard")', () => {
    const maxAt80 = Math.round(maxRepsAtPct(80))
    const actualRpe = 10
    expect(actualRpe - expectedRpe(80, maxAt80)).toBeLessThanOrEqual(1)
  })

  it('a mid-set on target reads near its expected RPE', () => {
    // 6 reps @ 80% is a classic RPE ~8 working set
    expect(expectedRpe(80, 6)).toBeGreaterThanOrEqual(7)
    expect(expectedRpe(80, 6)).toBeLessThanOrEqual(9)
  })

  it('clamps to the 5–10 slider range', () => {
    expect(expectedRpe(40, 3)).toBeGreaterThanOrEqual(5)
    expect(expectedRpe(95, 3)).toBeLessThanOrEqual(10)
  })
})

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
