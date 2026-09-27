import { describe, it, expect } from 'vitest'
import { computeTrainingStress, type TrainingStressInputs } from '../training-stress'
import type { Vo2MaxInputs } from '../vo2max'

/**
 * LA-161 — the gate's two inputs are now returned, so production can say whether the grid it
 * built was short instead of leaving it to be argued from a replay.
 *
 * TN-79 spent five weeks on that argument: production gates `insufficient_met` on days whose
 * stored frames replay to a 1421-minute grid with 1073 valid minutes. One of those readings is
 * wrong and nothing persisted said which.
 */

const base: Omit<TrainingStressInputs, 'startTimestampMs' | 'metsPerMinute'> = {
  age: 33, sex: 'male' as const, rhr: 59, readiness: 44, readinessProvisional: false, tzChange: 0,
  vo2maxInputs: {
    restingHr: 59, measuredMaxHr: null, age: 33, sex: 'male',
    weightKg: 71.7, heightCm: 158, activityLevel: null,
  } satisfies Vo2MaxInputs,
}
const run = (metsPerMinute: (number | null)[], over: Partial<TrainingStressInputs> = {}) =>
  computeTrainingStress({ ...base, startTimestampMs: Date.parse('2026-09-23T00:00:00Z'), metsPerMinute, ...over })

describe('the grid dimensions the gate decided from (LA-161)', () => {
  it('counts a minute at exactly the validity threshold as valid', () => {
    // The floor is `v >= 0.9`. No fixture anywhere sits exactly on it, so `>=` → `>` survives
    // every other test in the repo. This is the case that kills it.
    expect(run(new Array(10).fill(0.9)).metValidMin).toBe(10)
    expect(run(new Array(10).fill(0.89)).metValidMin).toBe(0)
  })

  it('counts nulls as minutes seen but not as valid ones', () => {
    // A null is a real gap in the day, not an absent row: the grid is that long and that sparse,
    // and conflating the two is what makes a short grid indistinguishable from a patchy one.
    const mets = [1.2, null, 1.2, null] as (number | null)[]
    const r = run(mets)
    expect(r.metGridLen).toBe(4)
    expect(r.metValidMin).toBe(2)
  })

  it('reports the dimensions on gates that never reach the MET floors', () => {
    // `no_readiness` is checked first and says nothing about MET. Recording the grid anyway is
    // the point: it distinguishes "readiness missing on a fully-covered day" from "readiness
    // missing on a day the ring barely saw".
    const full = new Array(1440).fill(1.2)
    expect(run(full, { readiness: null })).toEqual({
      status: 'gated', reason: 'no_readiness', metGridLen: 1440, metValidMin: 1440,
    })
    expect(run(full, { rhr: null })).toEqual({
      status: 'gated', reason: 'no_profile', metGridLen: 1440, metValidMin: 1440,
    })
  })

  it('distinguishes the two floors that share the insufficient_met reason', () => {
    // Short but wholly valid.
    expect(run(new Array(700).fill(1.2))).toEqual({
      status: 'gated', reason: 'insufficient_met', metGridLen: 700, metValidMin: 700,
    })
    // Long but mostly invalid — same reason, different cause, and now visibly so.
    const sparse = new Array(1440).fill(0.5); for (let i = 0; i < 359; i++) sparse[i] = 1.2
    expect(run(sparse)).toEqual({
      status: 'gated', reason: 'insufficient_met', metGridLen: 1440, metValidMin: 359,
    })
  })

  it('an empty day reports zero rather than being absent', () => {
    const r = run([])
    expect(r.metGridLen).toBe(0)
    expect(r.metValidMin).toBe(0)
  })
})
