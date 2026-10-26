// #2158 — every readiness z divides by a standard deviation, √(π/2) × the fold's mean absolute
// deviation, and the model version says so. Synthetic baselines only.
import { describe, it, expect } from 'vitest'
import { computeReadinessComposite, READINESS_MODEL, READINESS_MODEL_VERSION } from '../readiness-composite'
import { illnessZScores, type IllnessSummaryInput } from '../illness-radar'
import { MAD_TO_SD } from '../personal-baseline'

const empty = {
  tempZ: null, sleepBalanceZ: null, previousNightScore: null, prevDayActivityScore: null,
  activityBalanceScore: null, nHistory: 30,
}

describe('readiness z denominator (#2158)', () => {
  it('stamps v9 or later so the step in the stored trend can be traced to this change', () => {
    expect(Number(/^v(\d+):/.exec(READINESS_MODEL_VERSION)?.[1])).toBeGreaterThanOrEqual(9)
    expect(READINESS_MODEL.modelVersion).toBe(READINESS_MODEL_VERSION)
  })

  it('scores a contributor from a z in standard deviations', () => {
    // HRV baseline 50 ms with a mean absolute deviation of 8 ms (dev_x8 64), so σ ≈ 10.03 ms.
    // Tonight 60 ms: one σ above, z ≈ 1.0. The old rule read 10 / 8 = 1.25.
    const night = (hrv: number): IllnessSummaryInput => ({
      rhrBaseline: null, hrvBaseline: { meanX8: 400, devX8: 64 }, tempBaseline: null, breathBaseline: null,
      rhrLowBpm: null, hrvAvgMs: hrv, tempMeanC: null, breathAvgRpm: null, nHistory: 30,
    })
    const { hrvZ } = illnessZScores(night(50), night(60))
    expect(hrvZ).toBeCloseTo(10 / (8 * MAD_TO_SD), 10)
    expect(hrvZ).toBeCloseTo(0.997, 3)

    const hrv = computeReadinessComposite({ ...empty, rhrZ: null, hrvZ }).contributors.hrvBalance
    expect(hrv.input).toBe(hrvZ)
    // The same night under the old rule scored higher: z 1.25 is further up the curve.
    expect(hrv.score).toBeLessThan(computeReadinessComposite({ ...empty, rhrZ: null, hrvZ: 1.25 }).contributors.hrvBalance.score)
  })
})
