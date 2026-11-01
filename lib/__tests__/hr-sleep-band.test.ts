import { describe, it, expect } from 'vitest'
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band'
import { dateStrMidnightInTz, wallClockMinuteReader } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane' // UTC+10, no DST

describe('bedtimeToMinuteWindow', () => {
  it('clips a pre-midnight bedtime start to 0 and returns the morning wake minute', () => {
    // Bedtime 22:30 the evening before, wake 07:00 on the displayed date (Brisbane).
    const start = new Date('2026-07-03T22:30:00+10:00')
    const end   = new Date('2026-07-04T07:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 0, endMin: 420 })
  })

  it('boundary: a wake at 00:01 local yields endMin 1', () => {
    const start = new Date('2026-07-03T20:00:00+10:00')
    const end   = new Date('2026-07-04T00:01:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 0, endMin: 1 })
  })

  it('boundary: a 23:59 local onset clips the end to 1440 (shows the evening tail only)', () => {
    const start = new Date('2026-07-04T23:59:00+10:00')
    const end   = new Date('2026-07-05T07:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 1439, endMin: 1440 })
  })

  it('returns null when the interval lands entirely before the displayed day', () => {
    const start = new Date('2026-07-02T22:00:00+10:00')
    const end   = new Date('2026-07-03T06:00:00+10:00') // wakes the day before `date`
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toBeNull()
  })

  it('returns null when start and end collapse to the same clipped minute', () => {
    const start = new Date('2026-07-04T00:00:00+10:00')
    const end   = new Date('2026-07-04T00:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toBeNull()
  })
})

describe('bedtimeToMinuteWindow on a daylight-saving day (#3445)', () => {
  const SYD = 'Australia/Sydney'

  it('puts the wake minute where the trace puts it on the spring-forward day', () => {
    // 2026-10-04: 02:00 → 03:00. A 07:00 wake reads 420 on the clock face, not 360 elapsed minutes.
    const midnight = dateStrMidnightInTz('2026-10-04', SYD).getTime()
    const wake = new Date(midnight + 6 * 3_600_000) // 07:00 AEDT
    const start = new Date(midnight - 2 * 3_600_000)
    const band = bedtimeToMinuteWindow(start, wake, '2026-10-04', SYD)
    expect(band).toEqual({ startMin: 0, endMin: wallClockMinuteReader(midnight, SYD)(wake.getTime()) })
    expect(band?.endMin).toBe(420)
  })

  it('clamps to the 1440-minute axis at the end of the 23-hour day', () => {
    const midnight = dateStrMidnightInTz('2026-10-04', SYD).getTime()
    const start = new Date(midnight + 20 * 3_600_000)
    const end = new Date(midnight + 40 * 3_600_000)
    expect(bedtimeToMinuteWindow(start, end, '2026-10-04', SYD)).toEqual({ startMin: 21 * 60, endMin: 1440 })
  })

  it('reads a fall-back day on the clock face too', () => {
    // 2027-04-04: 03:00 → 02:00, a 25-hour day. A 07:00 wake is 8 real hours after midnight but 420 on the clock.
    const midnight = dateStrMidnightInTz('2027-04-04', SYD).getTime()
    const wake = new Date(midnight + 8 * 3_600_000) // 07:00 AEST
    expect(bedtimeToMinuteWindow(new Date(midnight - 3_600_000), wake, '2027-04-04', SYD)?.endMin).toBe(420)
  })
})
