// #2253 (owner, 2026-10-06): one expected-effort formula everywhere, the picker pre-filled with it,
// and an untouched value read as "went as planned". The replay that motivated it: 88% of logged RPEs
// were the untouched pre-fill, which sat 0.71 below `expectedRpe`, so they produced all six phantom
// "that felt easy" pushes, while the owner's real taps (all 65 higher than the pre-fill) were
// averaged away and no load cut ever came.
import { describe, it, expect } from 'vitest'
import {
  expectedRpe, expectedRpePrefill, perExerciseRpeDelta, rpeTrendFromSets, RPE_DELTA_MIN_RATED_SETS,
} from '../expected-rpe'
import { computeRpeAdjustment } from '../autoregulation'

const set = (rpe: number, rpeSource: 'expected' | 'rated' | null, over: Partial<{ reps: number; intensityPct: number }> = {}) =>
  ({ exerciseName: 'Cable Preacher Curl', rpe, rpeSource, reps: 6, intensityPct: 75, ...over })

describe('expectedRpePrefill — what the picker opens on', () => {
  it('is expectedRpe for the planned set, rounded onto the 6–10 picker', () => {
    expect(expectedRpePrefill(80, 5)).toBe(7)   // expectedRpe 7.11
    expect(expectedRpePrefill(85, 5)).toBe(9)   // 9.12
    expect(expectedRpePrefill(75, 8)).toBe(8)
    expect(expectedRpePrefill(60, 10)).toBe(6)  // light work clamps to the picker's lowest value
    expect(expectedRpePrefill(90, 8)).toBe(10)
  })
  it('opens on 7 when there is no % or no rep target to state an expectation from', () => {
    expect(expectedRpePrefill(undefined, 8)).toBe(7)
    expect(expectedRpePrefill(75, undefined)).toBe(7)
  })
})

describe('perExerciseRpeDelta — only ratings move the plan', () => {
  it('untouched pre-fills never produce a delta, so never a push', () => {
    const untouched = Array.from({ length: 9 }, () => set(6, 'expected'))
    expect(perExerciseRpeDelta(untouched).size).toBe(0)
  })

  it(`needs ${RPE_DELTA_MIN_RATED_SETS} rated sets; one is not enough`, () => {
    expect(perExerciseRpeDelta([set(10, 'rated'), set(8, 'expected'), set(8, 'expected')]).size).toBe(0)
  })

  it('two rated 9s among untouched sets are not diluted, and with reps missed they back the load off', () => {
    const sets = [set(9, 'rated'), set(9, 'rated'), set(8, 'expected'), set(8, 'expected'), set(8, 'expected')]
    const delta = perExerciseRpeDelta(sets).get('Cable Preacher Curl')
    expect(delta).toBeCloseTo(9 - expectedRpe(75, 6), 5)
    const adj = computeRpeAdjustment(
      { role: 'accessory', rpeDelta: delta!, rm1Trend: 'flat', repCompletionRate: 0.8 },
      { phase: 'normal', currentReps: 6, band: { repMin: 6, repMax: 8 } },
    )
    expect(adj.pctMultiplier).toBeLessThan(1)
  })

  it('a row logged before rpe_source existed still counts, as it did', () => {
    expect(perExerciseRpeDelta([set(9, null), set(9, null)]).size).toBe(1)
  })
})

describe('rpeTrendFromSets — the emergency-deload trend', () => {
  it('reads an untouched set as on plan, so one rated hard set among twelve stays under the 2.0 trigger', () => {
    const sets = [set(10, 'rated'), ...Array.from({ length: 11 }, () => set(7, 'expected'))]
    const trend = rpeTrendFromSets(sets)!
    expect(trend.delta).toBeLessThan(2)
    expect(trend.delta).toBeCloseTo((10 - expectedRpe(75, 6)) / 12, 5)
  })

  it('a rated set is read as reported', () => {
    const trend = rpeTrendFromSets([set(10, 'rated'), set(10, 'rated'), set(10, 'rated')])!
    expect(trend.avgActual).toBe(10)
  })
})
