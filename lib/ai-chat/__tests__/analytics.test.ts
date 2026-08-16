import { describe, it, expect } from 'vitest'
import { pearsonCorrelation, averageByDayOfWeek, classifyTrend } from '../analytics'

describe('pearsonCorrelation', () => {
  it('returns 1 for perfectly correlated series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5)
  })
  it('returns -1 for perfectly inversely correlated series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5)
  })
  it('returns null for fewer than 2 pairs', () => {
    expect(pearsonCorrelation([1], [1])).toBeNull()
    expect(pearsonCorrelation([], [])).toBeNull()
  })
  it('returns null when one series has zero variance', () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull()
  })
})

describe('averageByDayOfWeek', () => {
  it('averages values grouped by ISO weekday', () => {
    const result = averageByDayOfWeek([
      { date: '2026-07-06', value: 100 }, // Monday
      { date: '2026-07-13', value: 200 }, // Monday
      { date: '2026-07-08', value: 50 },  // Wednesday
    ])
    expect(result.Mon).toBe(150)
    expect(result.Wed).toBe(50)
    expect(result.Tue).toBeNull()
  })
})

describe('classifyTrend', () => {
  it('classifies a clearly rising series as improving', () => {
    expect(classifyTrend([100, 105, 110, 115, 120])).toBe('improving')
  })
  it('classifies a clearly falling series as declining', () => {
    expect(classifyTrend([120, 115, 110, 105, 100])).toBe('declining')
  })
  it('classifies a flat series as plateaued', () => {
    expect(classifyTrend([100, 101, 99, 100, 100])).toBe('plateaued')
  })
  it('classifies fewer than 3 points as plateaued (not enough data to call a trend)', () => {
    expect(classifyTrend([100, 105])).toBe('plateaued')
  })
})
