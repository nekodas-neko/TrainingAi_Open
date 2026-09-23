import { describe, it, expect } from 'vitest'
import { minutesFromNoon, computeSleepStartConsistency } from '../sleep-consistency'

// DV-7 — every case here names its zone on BOTH sides, so the file's result does not
// depend on the machine it runs on. It used to: two cases compared against the device's
// clock and assumed the device was UTC, so they passed in CI forever and failed by 600
// minutes the first time anyone ran them in Brisbane. A fixture that reads the ambient
// clock is not a weaker test, it is a test of the runner.
//
// Brisbane is UTC+10 with no DST, which is why it is the zone to pin against: an offset
// that never moves makes the expected numbers checkable by hand.
const BNE = 'Australia/Brisbane'
const NYC = 'America/New_York'

describe('minutesFromNoon', () => {
  it('keeps bedtimes either side of midnight numerically close (the wrap case)', () => {
    // 23:30 and 00:15 Brisbane are 45 minutes apart, not ~23 hours.
    const late = minutesFromNoon('2026-07-01T13:30:00Z', BNE)
    const early = minutesFromNoon('2026-07-01T14:15:00Z', BNE)
    expect(Math.abs(late - early)).toBe(45)
  })

  it('converts the instant into the given zone before computing minutes-from-noon', () => {
    // One instant, two zones: 23:30 in Brisbane, 09:30 the same morning in New York.
    const at = '2026-07-01T13:30:00Z'
    expect(minutesFromNoon(at, BNE)).toBe(23 * 60 + 30 - 720)   // 690
    expect(minutesFromNoon(at, NYC)).toBe((9 * 60 + 30) - 720 + 1440) // 1290
  })

  it('defaults to the user timezone rather than the device clock (DV-7)', () => {
    // The whole point of the entry: with no zone argument the answer must be the
    // owner's, and must NOT change with the machine's TZ. Brisbane is the default.
    const at = '2026-07-01T13:30:00Z'
    expect(minutesFromNoon(at)).toBe(minutesFromNoon(at, BNE))
    expect(minutesFromNoon(at)).toBe(690)
  })
})

describe('computeSleepStartConsistency', () => {
  it('computes the SD of bedtime across the midnight wrap', () => {
    // 23:30 and 00:15 Brisbane.
    const r = computeSleepStartConsistency(['2026-07-01T13:30:00Z', '2026-07-01T14:15:00Z'], BNE)
    expect(r.sdMinutes).toBeCloseTo(22.5, 5)
    expect(r.meanMinutesFromNoon).toBeCloseTo(712.5, 5)
  })

  it('returns 0 SD for an identical bedtime every night', () => {
    const r = computeSleepStartConsistency(
      ['2026-07-01T13:00:00Z', '2026-07-02T13:00:00Z', '2026-07-03T13:00:00Z'], BNE)
    expect(r.sdMinutes).toBe(0)
  })

  it('returns null for fewer than 2 nights of data', () => {
    expect(computeSleepStartConsistency([], BNE)).toEqual({ sdMinutes: null, meanMinutesFromNoon: null })
    expect(computeSleepStartConsistency(['2026-07-01T13:00:00Z'], BNE))
      .toEqual({ sdMinutes: null, meanMinutesFromNoon: null })
  })

  it('uses the given zone for every sleepStart, not just the first', () => {
    // Same two instants read in two zones give different means; if the zone were applied
    // to only one element the SD would collapse instead.
    const starts = ['2026-07-01T13:30:00Z', '2026-07-02T14:15:00Z']
    expect(computeSleepStartConsistency(starts, BNE).sdMinutes).toBeCloseTo(22.5, 5)
    expect(computeSleepStartConsistency(starts, NYC).sdMinutes).toBeCloseTo(22.5, 5)
    expect(computeSleepStartConsistency(starts, BNE).meanMinutesFromNoon)
      .not.toBe(computeSleepStartConsistency(starts, NYC).meanMinutesFromNoon)
  })

  it('defaults to the user timezone rather than the device clock (DV-7)', () => {
    const starts = ['2026-07-01T13:30:00Z', '2026-07-01T14:15:00Z']
    expect(computeSleepStartConsistency(starts)).toEqual(computeSleepStartConsistency(starts, BNE))
  })
})
