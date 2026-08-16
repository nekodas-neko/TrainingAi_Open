import { describe, it, expect } from 'vitest'
import { weightedTrend } from '../metric-trend'

describe('weightedTrend', () => {
  it('recovers the exact slope of a perfectly linear series (weight-independent)', () => {
    // Collinear data fits with zero residual, so weighted LS returns the exact slope/intercept
    // regardless of the confidence weights.
    const t = weightedTrend([0, 1, 2, 3], [10, 12, 14, 16], [1, 1, 1, 1], 0.02)
    expect(t.valid).toBe(true)
    expect(t.nPoints).toBe(4)
    expect(t.slope).toBeCloseTo(2, 6)
    expect(t.startValue).toBeCloseTo(10, 6)
    expect(t.endValue).toBeCloseTo(16, 6)
    expect(t.totalChange).toBeCloseTo(6, 6)
    expect(t.significance).toBeGreaterThan(0.9)
  })

  it('a flat series has ~zero slope and low significance', () => {
    const t = weightedTrend([0, 1, 2, 3, 4], [50, 50, 50, 50, 50], [1, 1, 1, 1, 1], 0.02)
    expect(t.valid).toBe(true)
    expect(t.slope).toBeCloseTo(0, 6)
    expect(t.significance).toBeCloseTo(0, 6)
  })

  it('drops NaN rows before fitting', () => {
    const t = weightedTrend([0, 1, 2, 3], [10, NaN, 14, 16], [1, 1, 1, 1], 0.02)
    expect(t.valid).toBe(true)
    expect(t.nPoints).toBe(3)
    expect(t.slope).toBeCloseTo(2, 6)
  })

  it('invalid when too few points, no x-variance, or bad cv', () => {
    expect(weightedTrend([0, 1], [10, 12], [1, 1], 0.02).valid).toBe(false) // < minPoints
    expect(weightedTrend([5, 5, 5], [10, 12, 14], [1, 1, 1], 0.02).valid).toBe(false) // ss_xx == 0
    expect(weightedTrend([0, 1, 2], [10, 12, 14], [1, 1, 1], 0).valid).toBe(false) // cv <= 0
  })

  it('respects a minimum day-span guard', () => {
    const t = weightedTrend([0, 1, 2], [10, 12, 14], [1, 1, 1], 0.02, { minSpanDays: 10 })
    expect(t.valid).toBe(false)
  })
})
