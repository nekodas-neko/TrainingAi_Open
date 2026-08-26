import { describe, it, expect } from 'vitest'
import { resolveRelative, resolveSleepWindow, resolveActivityBucket } from '@/lib/colmi-ble/resolve-time'
import { formatInTimeZone } from 'date-fns-tz'

const BNE = 'Australia/Brisbane'   // no DST — the owner's zone
const NYC = 'America/New_York'     // DST — where midnight+minutes arithmetic breaks

const local = (d: Date, tz: string) => formatInTimeZone(d, tz, 'yyyy-MM-dd HH:mm')

describe('resolveRelative', () => {
  it('resolves a minute of the reference day', () => {
    expect(local(resolveRelative('2026-08-26', 0, 0, BNE), BNE)).toBe('2026-08-26 00:00')
    expect(local(resolveRelative('2026-08-26', 0, 8 * 60 + 30, BNE), BNE)).toBe('2026-08-26 08:30')
  })

  it('counts daysAgo backwards from the reference day', () => {
    expect(local(resolveRelative('2026-08-26', 3, 12 * 60, BNE), BNE)).toBe('2026-08-23 12:00')
  })

  it('rolls a minute past the end of the day into the next one', () => {
    expect(local(resolveRelative('2026-08-26', 0, 1440, BNE), BNE)).toBe('2026-08-27 00:00')
    expect(local(resolveRelative('2026-08-26', 0, 1500, BNE), BNE)).toBe('2026-08-27 01:00')
  })

  it('rolls a NEGATIVE minute back a day rather than toward zero', () => {
    // -90 is 22:30 the previous day. Truncating division would give day 0 and a negative time.
    expect(local(resolveRelative('2026-08-26', 0, -90, BNE), BNE)).toBe('2026-08-25 22:30')
  })

  it('crosses a month boundary correctly', () => {
    expect(local(resolveRelative('2026-09-01', 1, 60, BNE), BNE)).toBe('2026-08-31 01:00')
  })

  it('stays wall-clock correct across a DST transition', () => {
    // US DST ends 2026-11-01: that local day is 25 hours long. Adding 60*60_000 ms to local
    // midnight lands at 00:00 EST, not 01:00 — the bug this module exists to avoid.
    expect(local(resolveRelative('2026-11-01', 0, 60, NYC), NYC)).toBe('2026-11-01 01:00')
    expect(local(resolveRelative('2026-11-02', 1, 180, NYC), NYC)).toBe('2026-11-01 03:00')
  })

  it('resolves the same wall-clock to different instants in different zones', () => {
    const a = resolveRelative('2026-08-26', 0, 60, BNE)
    const b = resolveRelative('2026-08-26', 0, 60, NYC)
    expect(a.getTime()).not.toBe(b.getTime())
  })
})

describe('resolveSleepWindow', () => {
  it('puts a pre-midnight bedtime on the previous day', () => {
    // start 22:30 (1350) > end 07:00 (420) => the session began before that midnight.
    const { startedAt, endedAt } = resolveSleepWindow('2026-08-26', 0, 1350, 420, BNE)
    expect(local(startedAt, BNE)).toBe('2026-08-25 22:30')
    expect(local(endedAt, BNE)).toBe('2026-08-26 07:00')
    expect(endedAt.getTime()).toBeGreaterThan(startedAt.getTime())
  })

  it('keeps an after-midnight bedtime on the same day', () => {
    const { startedAt, endedAt } = resolveSleepWindow('2026-08-26', 0, 30, 450, BNE)
    expect(local(startedAt, BNE)).toBe('2026-08-26 00:30')
    expect(local(endedAt, BNE)).toBe('2026-08-26 07:30')
  })

  it('always yields an end after the start', () => {
    for (const [s, e] of [[1350, 420], [30, 450], [1439, 1], [1200, 1199]]) {
      const w = resolveSleepWindow('2026-08-26', 1, s, e, BNE)
      expect(w.endedAt.getTime()).toBeGreaterThan(w.startedAt.getTime())
    }
  })
})

describe('resolveActivityBucket', () => {
  it('maps the quarter-of-day index to a wall-clock time', () => {
    expect(local(resolveActivityBucket(2026, 8, 26, 0, BNE)!, BNE)).toBe('2026-08-26 00:00')
    expect(local(resolveActivityBucket(2026, 8, 26, 82, BNE)!, BNE)).toBe('2026-08-26 20:30')
    expect(local(resolveActivityBucket(2026, 8, 26, 95, BNE)!, BNE)).toBe('2026-08-26 23:45')
  })

  it('returns null for parts the ring could not have meant, instead of a wrong date', () => {
    expect(resolveActivityBucket(2026, 0, 26, 0, BNE)).toBeNull()
    expect(resolveActivityBucket(2026, 13, 26, 0, BNE)).toBeNull()
    expect(resolveActivityBucket(2026, 8, 0, 0, BNE)).toBeNull()
    expect(resolveActivityBucket(2026, 8, 26, 96, BNE)).toBeNull()
    expect(resolveActivityBucket(2026, 8, 26, -1, BNE)).toBeNull()
  })
})
