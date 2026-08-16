import { describe, it, expect } from 'vitest'
import { targetsForRunType } from '../hr-targets'
import type { FitnessSnapshot } from '../types'

const fit: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: null,
  weeklyBaseMinutes: 90, source: 'baseline',
}

describe('targetsForRunType', () => {
  it('easy = zones 1-2, band below aerobic threshold', () => {
    const t = targetsForRunType('easy', fit)
    expect(t.zoneIds).toEqual([1, 2])
    // reserve = 140; z1 low = 50, z3 low = 50 + 0.7*140 = 148 → easy upper is the z3 boundary
    expect(t.hrLowBpm).toBe(50)
    expect(t.hrHighBpm).toBe(148)
  })
  it('interval = zones 4-5, top band', () => {
    const t = targetsForRunType('interval', fit)
    expect(t.zoneIds).toEqual([4, 5])
    expect(t.hrLowBpm).toBe(50 + Math.round(0.8 * 140)) // z4 low = 162
  })
  it('recovery caps at zone 1', () => {
    const t = targetsForRunType('recovery', fit)
    expect(t.zoneIds).toEqual([1])
    expect(t.hrHighBpm).toBe(50 + Math.round(0.6 * 140)) // z2 low = 134
  })
})
