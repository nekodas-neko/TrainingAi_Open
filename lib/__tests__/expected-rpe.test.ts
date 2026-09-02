import { describe, it, expect } from 'vitest'
import { EXPECTED_RPE_MAX, EXPECTED_RPE_MIN, expectedRpe, isExpectedRpeRepresentable, maxRepsAtPct, pctForExpectedRpe, perExerciseRpeDelta, rawExpectedRpe, rpeTrendFromSets } from '@trainingai/shared/ai-periodization/expected-rpe'

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

// Q-514: the floor clamp splits the set population in two, and only one half carries a signal.
describe('rawExpectedRpe / isExpectedRpeRepresentable', () => {
  it('agrees with expectedRpe wherever the clamp does not bind', () => {
    for (const [pct, reps] of [[85, 5], [80, 6], [75, 8], [70, 8]] as const) {
      expect(isExpectedRpeRepresentable(pct, reps)).toBe(true)
      expect(rawExpectedRpe(pct, reps)).toBeCloseTo(expectedRpe(pct, reps), 6)
    }
  })

  it('rejects the ordinary accessory work the entry measured — 49.6-66.7% at 7-13 reps', () => {
    // Not warm-ups: the median case is 54.3% for 10 reps, ~19 reps to failure, so the model
    // expects ~0.6 and can only say 5. The owner reports 6.9 and the delta reads +1.9.
    expect(isExpectedRpeRepresentable(54.3, 10)).toBe(false)
    expect(rawExpectedRpe(54.3, 10)!).toBeLessThan(EXPECTED_RPE_MIN)
    expect(expectedRpe(54.3, 10)).toBe(EXPECTED_RPE_MIN)
  })

  it('goes negative where the clamp hides the most — the entry saw raw values near -10', () => {
    const raw = rawExpectedRpe(30, 10)!
    expect(raw).toBeLessThan(0)
    expect(expectedRpe(30, 10)).toBe(EXPECTED_RPE_MIN)
  })

  it('never reports the ceiling as clamped — RIR is floored at 0, so raw tops out at 10', () => {
    for (const [pct, reps] of [[100, 1], [95, 1], [90, 12]] as const) {
      expect(rawExpectedRpe(pct, reps)!).toBeLessThanOrEqual(EXPECTED_RPE_MAX)
    }
  })

  it('is null, and not representable, on inputs that cannot support an expectation', () => {
    expect(rawExpectedRpe(0, 10)).toBeNull()
    expect(rawExpectedRpe(70, 0)).toBeNull()
    expect(isExpectedRpeRepresentable(0, 10)).toBe(false)
    // expectedRpe keeps its own neutral for those, which callers still rely on.
    expect(expectedRpe(0, 10)).toBe(7)
  })
})

describe('perExerciseRpeDelta', () => {
  const set = (exerciseName: string, intensityPct: number | null, reps: number, rpe: number | null) =>
    ({ exerciseName, intensityPct, reps, rpe })

  it('drops floor-clamped sets, which is what removes the false back-off trigger', () => {
    // Three ordinary accessory sets at the entry's median case (54.3% × 10 reps, reported 6.9).
    // Clamped, each reads +1.9 and the exercise crosses RPE_DEAD_BAND = 1.5 into back-off.
    const clamped = [set('Lateral Raise', 54.3, 10, 6.9), set('Lateral Raise', 54.3, 10, 6.9), set('Lateral Raise', 54.3, 10, 6.9)]
    expect(perExerciseRpeDelta(clamped).has('Lateral Raise')).toBe(false)

    const naive = clamped.reduce((a, s) => a + (s.rpe! - expectedRpe(s.intensityPct!, s.reps)), 0) / 3
    expect(naive).toBeGreaterThan(1.5)
  })

  it('leaves representable sets exactly as they were', () => {
    const sets = [set('Bench Press', 80, 6, 9), set('Bench Press', 80, 6, 8), set('Bench Press', 80, 6, 8.5)]
    const expected = (9 + 8 + 8.5) / 3 - expectedRpe(80, 6)
    expect(perExerciseRpeDelta(sets).get('Bench Press')).toBeCloseTo(expected, 6)
  })

  it('applies the >=3 usable-set floor AFTER dropping, not before', () => {
    const mixed = [set('Row', 80, 6, 9), set('Row', 80, 6, 9), set('Row', 54.3, 12, 7), set('Row', 54.3, 12, 7)]
    expect(perExerciseRpeDelta(mixed).has('Row')).toBe(false)
  })

  it('ignores unrated sets and keeps exercises independent', () => {
    const sets = [
      set('Squat', 80, 6, 9), set('Squat', 80, 6, 9), set('Squat', 80, 6, 9), set('Squat', 80, 6, null),
      set('Curl', 54.3, 10, 7), set('Curl', 54.3, 10, 7), set('Curl', 54.3, 10, 7),
    ]
    const out = perExerciseRpeDelta(sets)
    expect(out.get('Squat')).toBeCloseTo(9 - expectedRpe(80, 6), 6)
    expect(out.has('Curl')).toBe(false)
  })
})
