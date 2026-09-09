import { describe, expect, it } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { bedtimeInstant, parseClock } from '../manual-bedtime'

const TZ = 'Australia/Brisbane'
const local = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd HH:mm')

describe('parseClock — Q-519', () => {
  it('reads a clock time', () => {
    expect(parseClock('23:15')).toBe(23 * 60 + 15)
    expect(parseClock('00:30')).toBe(30)
    expect(parseClock(' 9:05 ')).toBe(9 * 60 + 5)
  })

  it('refuses anything that is not one, rather than coercing it', () => {
    // Whatever this returns becomes a stored timestamp, so a guess here is a wrong row.
    for (const bad of ['', 'nope', '24:00', '23:60', '-1:00', '2315', '23:1']) {
      expect(parseClock(bad), bad).toBeNull()
    }
  })
})

describe('bedtimeInstant — Q-519', () => {
  it('puts an evening bedtime on the day BEFORE the night it belongs to', () => {
    // The night of 2026-09-08 began at 23:00 on the 7th. Storing it on the 8th is 24 hours out.
    expect(local(bedtimeInstant('2026-09-08', '23:00', TZ)!)).toBe('2026-09-07 23:00')
  })

  it('puts an after-midnight bedtime on the night\'s own date', () => {
    expect(local(bedtimeInstant('2026-09-08', '00:30', TZ)!)).toBe('2026-09-08 00:30')
  })

  it('splits at noon, which is the hour a bedtime never lands on', () => {
    expect(local(bedtimeInstant('2026-09-08', '12:00', TZ)!)).toBe('2026-09-07 12:00')
    expect(local(bedtimeInstant('2026-09-08', '11:59', TZ)!)).toBe('2026-09-08 11:59')
  })

  it('steps back over a month boundary without inventing a date', () => {
    // Hand-arithmetic on the day number is what built `2026-06-31` and 500'd a screen.
    expect(local(bedtimeInstant('2026-09-01', '22:30', TZ)!)).toBe('2026-08-31 22:30')
    expect(local(bedtimeInstant('2026-01-01', '22:30', TZ)!)).toBe('2025-12-31 22:30')
    expect(local(bedtimeInstant('2026-03-01', '22:30', TZ)!)).toBe('2026-02-28 22:30')
  })

  it('is the user\'s clock, not the device\'s or UTC\'s', () => {
    // 23:00 Brisbane on the 7th is 13:00 UTC — a UTC-built instant would be ten hours out.
    expect(bedtimeInstant('2026-09-08', '23:00', TZ)).toBe('2026-09-07T13:00:00.000Z')
  })

  it('accepts the slash dates the client emits', () => {
    expect(local(bedtimeInstant('2026/09/08', '23:00', TZ)!)).toBe('2026-09-07 23:00')
  })

  it('returns null rather than a timestamp when either input is unusable', () => {
    expect(bedtimeInstant('2026-09-08', 'nope', TZ)).toBeNull()
    expect(bedtimeInstant('not-a-date', '23:00', TZ)).toBeNull()
  })
})
