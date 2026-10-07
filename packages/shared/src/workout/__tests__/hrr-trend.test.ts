import { describe, it, expect } from 'vitest'
import { sessionHrr1Median, rollupDailyBestHrr, setHrr60Values } from '../hrr-trend'

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

// #2234: the trend plotted 0-value points on ring-only days, because the nearest-reading hrr1 turned
// two idle ring readings a minute apart into a "recovery" of exactly 0. The per-set value is HRR60.
describe('setHrr60Values', () => {
  const end = Date.UTC(2026, 8, 17, 2, 0, 0)
  const at = (ms: number, bpm: number, source = 'ble') => ({ timestamp: new Date(end + ms), bpm, source })
  const strapMinute = Array.from({ length: 61 }, (_, k) => at(k * 1000, 150 - Math.round(k / 3), 'chest_strap'))

  it('measures a dense strap minute', () => {
    expect(setHrr60Values(strapMinute, [{ setEndMs: end, loggedAt: new Date(end) }])).toEqual([20])
  })

  it('a flat ring pair 60 s apart is not measured — null, never 0', () => {
    const ring = [at(0, 92), at(60_000, 92)]
    expect(setHrr60Values(ring, [{ setEndMs: end, loggedAt: new Date(end) }])).toEqual([null])
  })

  it('a rising ring pair is not measured either — null, never negative', () => {
    expect(setHrr60Values([at(0, 95), at(60_000, 98)], [{ setEndMs: end, loggedAt: new Date(end) }])).toEqual([null])
  })

  it('anchors on loggedAt when the set has no timed end, and a set with neither is null', () => {
    expect(setHrr60Values(strapMinute, [{ loggedAt: new Date(end) }, { setEndMs: null, loggedAt: null }])).toEqual([20, null])
  })

  it('a genuine flat recovery from dense HR stays 0 — a measurement, not an absence', () => {
    const flat = Array.from({ length: 61 }, (_, k) => at(k * 1000, 120, 'chest_strap'))
    expect(setHrr60Values(flat, [{ setEndMs: end, loggedAt: new Date(end) }])).toEqual([0])
  })

  it('a ring-only day rolls up to no entry, so the trend draws a gap', () => {
    const ring = [at(0, 92), at(60_000, 92)]
    const map = rollupDailyBestHrr([
      { day: '2026-09-17', hrr1Values: setHrr60Values(ring, [{ setEndMs: end, loggedAt: new Date(end) }]) },
      { day: '2026-09-15', hrr1Values: setHrr60Values(strapMinute, [{ setEndMs: end, loggedAt: new Date(end) }]) },
    ])
    expect(map.has('2026-09-17')).toBe(false)
    expect(map.get('2026-09-15')).toBe(20)
  })
})
