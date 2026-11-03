import { describe, it, expect } from 'vitest'
import { WeightTrendDaysQuerySchema, WEIGHT_TREND_MAX_DAYS } from '../body-metrics'
import { weightTrendWindowStart } from '../../health/long-term-goal-progress'

describe('WeightTrendDaysQuerySchema (#2179)', () => {
  it('accepts whole days and clamps to the cap', () => {
    expect(WeightTrendDaysQuerySchema.parse('45')).toBe(45)
    expect(WeightTrendDaysQuerySchema.parse('99999')).toBe(WEIGHT_TREND_MAX_DAYS)
  })
  it.each(['0', '-1', 'x', '1.5', '', '1e3'])('rejects %j', v => {
    expect(WeightTrendDaysQuerySchema.safeParse(v).success).toBe(false)
  })
})

describe('weightTrendWindowStart days (#2179)', () => {
  it('defaults to 30 days, today included', () => {
    expect(weightTrendWindowStart('2026-03-31')).toBe('2026-03-02')
  })
  it('counts calendar days across a month', () => {
    expect(weightTrendWindowStart('2026-03-31', 1)).toBe('2026-03-31')
    expect(weightTrendWindowStart('2026-03-31', 90)).toBe('2026-01-01')
  })
})
