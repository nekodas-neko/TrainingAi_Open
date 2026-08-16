import { describe, it, expect } from 'vitest'
import { computeSetAggregates, computeIntensityPct } from '../set-aggregates'

describe('computeSetAggregates', () => {
  it('computes volume as weight × reps summed across all sets', () => {
    const { volume } = computeSetAggregates([100, 100, 100], [8, 8, 7])
    expect(volume).toBe(2300)
  })

  it('computes avgReps as the mean, rounded to 1 decimal', () => {
    const { avgReps } = computeSetAggregates([100, 100, 100], [8, 8, 7])
    expect(avgReps).toBeCloseTo(7.7, 1)
  })

  it('falls back to the last weight for a ragged reps array longer than weights', () => {
    const { volume } = computeSetAggregates([100], [8, 8])
    expect(volume).toBe(1600)
  })
})

describe('computeIntensityPct', () => {
  it('computes weight as a percentage of the estimated 1RM, to 1 decimal', () => {
    expect(computeIntensityPct(75, 100)).toBeCloseTo(75, 1)
    expect(computeIntensityPct(82.5, 110)).toBeCloseTo(75, 1)
  })

  it('returns null when there is no usable 1RM estimate', () => {
    expect(computeIntensityPct(75, 0)).toBeNull()
    expect(computeIntensityPct(75, -5)).toBeNull()
  })
})
