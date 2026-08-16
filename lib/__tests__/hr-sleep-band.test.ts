import { describe, it, expect } from 'vitest'
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band'

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
