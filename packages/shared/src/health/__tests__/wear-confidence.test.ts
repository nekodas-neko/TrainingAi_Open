import { describe, it, expect, vi, afterEach } from 'vitest'
import { wornHours, isLowWearDay, excludeLowWearDays, toOuraByDate, MIN_WEAR_HOURS, completenessForDay } from '../wear-confidence'
import { secondsSinceLocalMidnight } from '@trainingai/shared/date-utils'

describe('wornHours', () => {
  it('returns null when non-wear time is unknown', () => {
    expect(wornHours(null)).toBeNull()
    expect(wornHours(undefined)).toBeNull()
  })
  it('converts non-wear seconds to worn hours (full-day default)', () => {
    expect(wornHours(0)).toBe(24)
    expect(wornHours(6 * 3600)).toBe(18)
    expect(wornHours(12 * 3600)).toBe(12)
  })
  it('respects an explicit partial-day length instead of assuming 24h', () => {
    // A ring worn 6h straight since local midnight stores nonWear ≈ 0 for
    // the elapsed 6h window — worn hours must read 6, not the old 24h bug.
    const sixHoursSec = 6 * 3600
    expect(wornHours(0, sixHoursSec)).toBe(6)
    expect(wornHours(1 * 3600, sixHoursSec)).toBe(5)
  })
})

describe('secondsSinceLocalMidnight', () => {
  afterEach(() => vi.useRealTimers())

  it('clamps to [0, 86400] at the 23:59/00:01 boundaries (Australia/Brisbane, no DST)', () => {
    vi.useFakeTimers()
    // 00:01 local (AEST = UTC+10, no DST) — just after midnight, ~60s elapsed.
    vi.setSystemTime(new Date('2026-07-01T14:01:00Z')) // 2026-07-02T00:01:00+10:00
    const justAfterMidnight = secondsSinceLocalMidnight('Australia/Brisbane')
    expect(justAfterMidnight).toBeGreaterThanOrEqual(0)
    expect(justAfterMidnight).toBeLessThan(120)

    // 23:59 local — ~86340s elapsed, must not reach or exceed 86400.
    vi.setSystemTime(new Date('2026-07-02T13:59:00Z')) // 2026-07-02T23:59:00+10:00
    const justBeforeMidnight = secondsSinceLocalMidnight('Australia/Brisbane')
    expect(justBeforeMidnight).toBeGreaterThan(86280)
    expect(justBeforeMidnight).toBeLessThan(86400)
  })
})

describe('isLowWearDay', () => {
  it('is false when wear time is unknown (no data to judge)', () => {
    expect(isLowWearDay(null)).toBe(false)
  })
  it(`is false at exactly the ${MIN_WEAR_HOURS}h threshold`, () => {
    expect(isLowWearDay((24 - MIN_WEAR_HOURS) * 3600)).toBe(false)
  })
  it('is true just under the threshold', () => {
    expect(isLowWearDay((24 - MIN_WEAR_HOURS + 1) * 3600)).toBe(true)
  })
})

describe('excludeLowWearDays', () => {
  it('drops rows whose date has a low-wear Oura day', () => {
    const rows = [{ date: '2026-07-01' }, { date: '2026-07-02' }, { date: '2026-07-03' }]
    const ouraByDate = toOuraByDate([
      { date: '2026-07-01', nonWearTimeSec: 0 },        // full wear — kept
      { date: '2026-07-02', nonWearTimeSec: 20 * 3600 }, // low wear — dropped
    ])
    expect(excludeLowWearDays(rows, ouraByDate)).toEqual([
      { date: '2026-07-01' },
      { date: '2026-07-03' }, // no Oura row for this date — kept, can't judge
    ])
  })
})

describe('completenessForDay', () => {
  it('computes worn %, longest gap and last-sample age from worn 15-min bins', () => {
    // 15-min bins. Worn bins 0,1,2 then 6,7 (a 3-bin = 45-min gap between 2 and 6).
    // expectedBins = 8 (elapsed = 8 * 15 min = 2h into the day).
    const r = completenessForDay({ wornBinIndices: [0, 1, 2, 6, 7], expectedBins: 8, binMinutes: 15 })
    expect(r.wornBins).toBe(5)
    expect(r.expectedBins).toBe(8)
    expect(r.pct).toBe(63)          // round(5/8 * 100)
    expect(r.longestGapMin).toBe(45) // bins 3,4,5 missing = 3 * 15
    expect(r.lastSampleAgeMin).toBe(0) // last worn bin (7) == last expected bin (7)
  })

  it('reports a trailing gap as last-sample age', () => {
    // worn only bins 0,1; expected 5 -> trailing gap of bins 2,3,4 = last worn is bin 1,
    // last expected is bin 4 -> age = (4 - 1) * 15 = 45.
    const r = completenessForDay({ wornBinIndices: [0, 1], expectedBins: 5, binMinutes: 15 })
    expect(r.lastSampleAgeMin).toBe(45)
    expect(r.longestGapMin).toBe(45)
  })

  it('handles a day with no samples', () => {
    const r = completenessForDay({ wornBinIndices: [], expectedBins: 4, binMinutes: 15 })
    expect(r).toEqual({ wornBins: 0, expectedBins: 4, pct: 0, longestGapMin: 60, lastSampleAgeMin: 60 })
  })
})
