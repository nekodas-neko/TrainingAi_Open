import { describe, it, expect } from 'vitest'
import { sessionHrr1Median, rollupDailyBestHrr } from '../hrr-trend'

describe('sessionHrr1Median', () => {
  it('returns the median of non-null HRR1 values (odd count)', () => {
    expect(sessionHrr1Median([10, 30, 20])).toBe(20)
  })

  it('averages the two middle values and rounds (even count)', () => {
    // sorted [10, 20, 30, 40] -> (20 + 30) / 2 = 25
    expect(sessionHrr1Median([40, 10, 30, 20])).toBe(25)
    // sorted [10, 15] -> 12.5 -> rounds to 13
    expect(sessionHrr1Median([15, 10])).toBe(13)
  })

  it('ignores nulls when computing the median', () => {
    expect(sessionHrr1Median([null, 18, null, 22])).toBe(20)
  })

  it('returns null when there are no non-null values', () => {
    expect(sessionHrr1Median([])).toBeNull()
    expect(sessionHrr1Median([null, null])).toBeNull()
  })
})

describe('rollupDailyBestHrr', () => {
  it('keeps the best (highest) session median per day', () => {
    const map = rollupDailyBestHrr([
      { day: '2026-07-15', hrr1Values: [10, 12] },   // median 11
      { day: '2026-07-15', hrr1Values: [20, 22] },   // median 21 -> wins the day
      { day: '2026-07-16', hrr1Values: [8, 8, 8] },  // median 8
    ])
    expect(map.get('2026-07-15')).toBe(21)
    expect(map.get('2026-07-16')).toBe(8)
  })

  it('skips sessions whose HRR1 values are all null', () => {
    const map = rollupDailyBestHrr([
      { day: '2026-07-15', hrr1Values: [null, null] },
    ])
    expect(map.has('2026-07-15')).toBe(false)
  })
})
