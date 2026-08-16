import { describe, it, expect } from 'vitest'
import { minutesFromNoon, computeSleepStartConsistency } from '../sleep-consistency'

describe('minutesFromNoon', () => {
  it('keeps bedtimes either side of midnight numerically close (the wrap case)', () => {
    // 11:30pm and 12:15am the next night are 45 minutes apart, not ~23 hours
    const late = minutesFromNoon('2026-07-01T23:30:00Z')
    const early = minutesFromNoon('2026-07-02T00:15:00Z')
    expect(Math.abs(late - early)).toBe(45)
  })
})

describe('minutesFromNoon with an explicit tz', () => {
  it('converts a UTC timestamp into the given timezone before computing minutes-from-noon', () => {
    // 2026-07-01T13:30:00Z is 2026-07-01 23:30 in Australia/Brisbane (UTC+10, no DST)
    const brisbane = minutesFromNoon('2026-07-01T13:30:00Z', 'Australia/Brisbane')
    const deviceLocal = minutesFromNoon('2026-07-01T13:30:00Z')
    // In a UTC test runner, the no-tz path reads 13:30 (raw UTC hour); the explicit
    // Brisbane path reads 23:30 — these must differ to prove the tz param is honored.
    expect(brisbane).not.toBe(deviceLocal)
    expect(brisbane).toBe((23 * 60 + 30) - 720) // 690
  })
})

describe('computeSleepStartConsistency', () => {
  it('computes the SD of bedtime across the midnight wrap', () => {
    const r = computeSleepStartConsistency(['2026-07-01T23:30:00Z', '2026-07-02T00:15:00Z'])
    expect(r.sdMinutes).toBeCloseTo(22.5, 5)
    expect(r.meanMinutesFromNoon).toBeCloseTo(712.5, 5)
  })

  it('returns 0 SD for an identical bedtime every night', () => {
    const r = computeSleepStartConsistency(['2026-07-01T23:00:00Z', '2026-07-02T23:00:00Z', '2026-07-03T23:00:00Z'])
    expect(r.sdMinutes).toBe(0)
  })

  it('returns null for fewer than 2 nights of data', () => {
    expect(computeSleepStartConsistency([])).toEqual({ sdMinutes: null, meanMinutesFromNoon: null })
    expect(computeSleepStartConsistency(['2026-07-01T23:00:00Z'])).toEqual({ sdMinutes: null, meanMinutesFromNoon: null })
  })

  it('accepts an explicit tz and uses it for every sleepStart', () => {
    const r = computeSleepStartConsistency(
      ['2026-07-01T13:30:00Z', '2026-07-02T14:15:00Z'],
      'Australia/Brisbane',
    )
    // 23:30 Brisbane and 2026-07-03 00:15 Brisbane — 45 minutes apart, same shape
    // as the existing device-local wrap test.
    expect(r.sdMinutes).toBeCloseTo(22.5, 5)
  })
})
