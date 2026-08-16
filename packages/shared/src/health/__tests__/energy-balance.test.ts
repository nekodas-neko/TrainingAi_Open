import { describe, it, expect } from 'vitest'
import { energyBalanceByDay, medianOf } from '@trainingai/shared/health/energy-balance'

describe('energyBalanceByDay', () => {
  it('maps date -> (calories - activeCalories), skipping days with no food logged', () => {
    const map = energyBalanceByDay([
      { date: '2026-07-01', calories: 2500, activeCalories: 400 },
      { date: '2026-07-02', calories: 2000, activeCalories: undefined }, // activity missing -> treat as 0
      { date: '2026-07-03', calories: undefined, activeCalories: 300 },  // no food -> skipped
    ])
    expect(map.get('2026-07-01')).toBe(2100)
    expect(map.get('2026-07-02')).toBe(2000)
    expect(map.has('2026-07-03')).toBe(false)
  })
})

describe('medianOf', () => {
  it('returns the median of an odd-length list', () => {
    expect(medianOf([2100, 2000, 2600])).toBe(2100)
  })
  it('averages the two middle values for an even-length list', () => {
    expect(medianOf([2000, 2100, 2200, 2600])).toBe(2150)
  })
  it('returns null for an empty list', () => {
    expect(medianOf([])).toBe(null)
  })
})
