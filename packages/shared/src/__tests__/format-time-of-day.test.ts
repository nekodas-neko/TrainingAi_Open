import { describe, it, expect } from 'vitest'
import { formatTimeOfDay, formatMinutesOfDay, formatTime12h, DEFAULT_TZ } from '../date-utils'

// The night from the 2026-08-03 report: sleep_end 2026-08-02T21:05:49Z, which is 7:05 am Brisbane.
const WAKE = '2026-08-02T21:05:49.000Z'

describe('formatTimeOfDay', () => {
  it('renders in the given timezone, not the process/device one', () => {
    // The bug this replaces: toLocaleTimeString with no timeZone renders wherever the DEVICE is,
    // so the same instant reads as a different clock time on a phone in another zone while the
    // stored value never moved.
    expect(formatTimeOfDay(WAKE, 'Australia/Brisbane')).toBe('7:05 am')
    expect(formatTimeOfDay(WAKE, 'Europe/London')).toBe('10:05 pm')
    expect(formatTimeOfDay(WAKE, 'UTC')).toBe('9:05 pm')
  })

  it('defaults to the app timezone rather than the device', () => {
    expect(formatTimeOfDay(WAKE)).toBe(formatTimeOfDay(WAKE, DEFAULT_TZ))
    expect(formatTimeOfDay(WAKE)).toBe('7:05 am')
  })

  it('matches the en-AU output it replaced, so nothing looks different', () => {
    const legacy = new Date(WAKE).toLocaleTimeString('en-AU', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: DEFAULT_TZ,
    })
    expect(formatTimeOfDay(WAKE)).toBe(legacy)
  })

  it('accepts epoch millis and a Date, not just an ISO string', () => {
    const ms = new Date(WAKE).getTime()
    expect(formatTimeOfDay(ms)).toBe('7:05 am')
    expect(formatTimeOfDay(new Date(WAKE))).toBe('7:05 am')
  })

  it('renders an unparseable timestamp as absent, never as "Invalid Date"', () => {
    expect(formatTimeOfDay('not-a-date')).toBe('')
    expect(formatTimeOfDay(NaN)).toBe('')
  })
})

// LB-183: one time-of-day form everywhere. The minutes-based sibling and formatTime12h must print
// exactly what formatTimeOfDay prints for the same wall-clock time.
describe('formatMinutesOfDay and formatTime12h share formatTimeOfDay\'s form', () => {
  it('matches formatTimeOfDay for the same Brisbane wall time', () => {
    for (const [iso, minutes, hhmm] of [
      ['2026-09-20T20:40:00Z', 6 * 60 + 40, '06:40'],   // 6:40 am AEST
      ['2026-09-20T02:05:00Z', 12 * 60 + 5, '12:05'],   // 12:05 pm
      ['2026-09-20T14:00:00Z', 0, '00:00'],             // midnight
      ['2026-09-20T13:59:00Z', 23 * 60 + 59, '23:59'],
    ] as const) {
      const want = formatTimeOfDay(iso, 'Australia/Brisbane')
      expect(formatMinutesOfDay(minutes)).toBe(want)
      expect(formatTime12h(hhmm)).toBe(want)
    }
  })

  it('rounds the whole value first, so a fractional minute never reads ":60"', () => {
    expect(formatMinutesOfDay(419.6)).toBe('7:00 am')
    expect(formatMinutesOfDay(419.4)).toBe('6:59 am')
  })

  it('wraps into one day and refuses a non-number', () => {
    expect(formatMinutesOfDay(-20)).toBe('11:40 pm')
    expect(formatMinutesOfDay(1450)).toBe('12:10 am')
    expect(formatMinutesOfDay(Number.NaN)).toBe('')
  })
})
