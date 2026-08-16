import { describe, it, expect } from 'vitest'
import { formatTimeOfDay, DEFAULT_TZ } from '../date-utils'

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
