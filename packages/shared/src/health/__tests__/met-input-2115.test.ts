import { describe, it, expect } from 'vitest'
import { resolveDayMetPerMinute } from '../met-input'
import { localClockTimeToDate } from '../../date-utils'

// #2115 v4: one day's `MET/min`, minute by minute, from the best route that has each minute.
// Anchored at local midday in Brisbane (UTC+10, no DST) so no fixture straddles a date line.
const T0 = Date.parse('2026-10-05T02:00:00Z') // 12:00 Brisbane
const min = (i: number) => T0 + i * 60_000

describe('resolveDayMetPerMinute', () => {
  const day = resolveDayMetPerMinute({
    ringGrid: { startTimestampMs: min(0), metsPerMinute: [1.5, null, 2.0] },
    ringStillFramesMs: [min(1) + 20_000],
    sleepSessions: [{ startMs: min(3), endMs: min(5), source: 'oura_ble' }],
    activities: [{ startMs: min(4), endMs: min(7), met: 4.3, source: 'activity_log' }],
  }, min(0), min(8))

  it('returns every minute of the span, null where nothing filled it', () => {
    expect(day.startTimestampMs).toBe(min(0))
    expect(day.metsPerMinute).toEqual([1.5, 1.0, 2.0, 1.0, 1.0, 4.3, 4.3, null])
  })

  it('takes the ring first, then its still marker, then a sleep record, then a logged workout', () => {
    expect(day.series.map(r => r.provenance?.route ?? null)).toEqual([
      'device_met', 'ring_still_met', 'device_met', 'sleep_session_met', 'sleep_session_met',
      'compendium_met', 'compendium_met', null,
    ])
  })

  it('counts the mix per rung, and the minutes nothing filled', () => {
    expect(day.mix).toEqual({ provided: 2, derived: 3, estimated: 2, missing: 1 })
  })

  it('leaves the calorie and cadence routes empty when no per-minute ingest feeds them', () => {
    expect(day.series.some(r => r.provenance?.route === 'active_kcal_met' || r.provenance?.route === 'cadence_met')).toBe(false)
  })
})

describe('localClockTimeToDate', () => {
  it("turns a local HH:MM on a date into that instant in the user's zone", () => {
    expect(localClockTimeToDate('2026-10-05', '12:00', 'Australia/Brisbane')?.toISOString()).toBe('2026-10-05T02:00:00.000Z')
    // Sydney is on daylight time (UTC+11) on 5 October 2026: the offset comes from the zone, not a constant.
    expect(localClockTimeToDate('2026-10-05', '12:00', 'Australia/Sydney')?.toISOString()).toBe('2026-10-05T01:00:00.000Z')
  })
  it('is null for anything that is not a time of day', () => {
    for (const bad of [null, undefined, '', '24:00', '7:60', 'noon']) expect(localClockTimeToDate('2026-10-05', bad, 'Australia/Brisbane')).toBeNull()
  })
})
