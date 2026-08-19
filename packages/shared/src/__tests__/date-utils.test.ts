import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { isCalendarDate, shiftDateStr, aestMidnight, toAestDay, normalizeDateParam, normalizeDateParamIso, dateStrMidnightInTz, ageFromDob, weekStartForDay, formatDateDisplay, formatDayShort, dayKeyInTz } from '../date-utils'

describe('ageFromDob', () => {
  const today = new Date('2026-07-22T00:00:00Z')
  it('computes whole years and handles the pre-birthday case', () => {
    expect(ageFromDob('1996-01-10', today)).toBe(30)
    expect(ageFromDob('1996-12-31', today)).toBe(29) // birthday not yet reached this year
  })
  it('returns null for a missing or invalid DOB', () => {
    expect(ageFromDob(null, today)).toBeNull()
    expect(ageFromDob('not-a-date', today)).toBeNull()
  })
})

describe('isCalendarDate (Q-496)', () => {
  // The shape regexes in the route schemas accept all three of these, and Postgres then refuses
  // them as `[pg 22008]` — a client input error recorded as a server fault. Measured:
  // `POST /api/day-checkin {"date":"2026-13-45"}` answered 500 and wrote an `error_events` row.
  it('rejects a date-shaped string that is not a real day', () => {
    expect(isCalendarDate('2026-13-45')).toBe(false)
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('0000-00-00')).toBe(false)
    expect(isCalendarDate('2026-00-10')).toBe(false)
  })

  it('accepts a real day in either separator, because the client emits slashes', () => {
    expect(isCalendarDate('2026-08-17')).toBe(true)
    expect(isCalendarDate('2026/08/17')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)   // a real leap day
  })

  it('rejects the non-leap Feb 29 that Date would silently roll to March 1', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false)
  })

  it('rejects anything that is not date-shaped at all', () => {
    expect(isCalendarDate('')).toBe(false)
    expect(isCalendarDate('not-a-date')).toBe(false)
    expect(isCalendarDate('2026-8-1')).toBe(false)
  })
})

describe('shiftDateStr', () => {
  it('adds positive days', () => {
    expect(shiftDateStr('2026-06-28', 1)).toBe('2026-06-29')
    expect(shiftDateStr('2026-06-28', 6)).toBe('2026-07-04')
  })

  it('subtracts negative days', () => {
    expect(shiftDateStr('2026-06-29', -1)).toBe('2026-06-28')
    expect(shiftDateStr('2026-07-01', -30)).toBe('2026-06-01')
  })

  it('handles month boundaries', () => {
    expect(shiftDateStr('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDateStr('2026-03-01', -1)).toBe('2026-02-28')
  })

  // Q-497. The year was the one field without width padding, so a year under 1000 emitted three
  // digits — and '999-01-01' sorts BEFORE '1000-01-01', silently reordering any string comparison.
  it('pads the year to four digits, so a low year still sorts correctly', () => {
    expect(shiftDateStr('1000-01-01', -1)).toBe('0999-12-31')
    expect(shiftDateStr('0999-12-31', 1)).toBe('1000-01-01')
    expect(shiftDateStr('0999-12-31', 1) > shiftDateStr('1000-01-01', -1)).toBe(true)
  })

  // The other half of Q-497, pinned so nobody reads the padding above as making string comparison
  // safe. It does not, and cannot: a 'YYYY-MM-DD' contract has no room for a five-digit year, and
  // padStart is a no-op on one. This is why the two admin range loops iterate a validated day COUNT
  // instead of `for (d = start; d <= end; …)` — that comparison ran ~29M times.
  it('cannot keep a five-digit year orderable — the reason range loops must not compare strings', () => {
    expect(shiftDateStr('9999-12-31', 1)).toBe('10000-01-01')
    expect('10000-01-01' <= '9999-12-31').toBe(true)
  })

  it('handles year boundaries', () => {
    expect(shiftDateStr('2025-12-31', 1)).toBe('2026-01-01')
    expect(shiftDateStr('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('zero shift returns same date', () => {
    expect(shiftDateStr('2026-06-15', 0)).toBe('2026-06-15')
  })
})

describe('aestMidnight day overflow', () => {
  // Callers build an exclusive upper bound as aestMidnight(y, m, d + 1). On the
  // last day of a month that produces an invalid calendar date (e.g. Jun 31),
  // which previously threw "Invalid time value" when serialized — breaking
  // /api/workout-data and /api/progress-summary on every month-end day.
  it('rolls a day past month end into the next month without throwing', () => {
    expect(() => aestMidnight(2026, 6, 31)).not.toThrow()
    expect(toAestDay(aestMidnight(2026, 6, 31))).toBe('2026-07-01')
  })

  it('rolls past year end', () => {
    expect(toAestDay(aestMidnight(2026, 12, 32))).toBe('2027-01-01')
  })

  it('handles February correctly (non-leap year)', () => {
    expect(toAestDay(aestMidnight(2026, 2, 29))).toBe('2026-03-01')
  })

  it('leaves valid dates unchanged', () => {
    expect(toAestDay(aestMidnight(2026, 6, 30))).toBe('2026-06-30')
    expect(toAestDay(aestMidnight(2026, 1, 1))).toBe('2026-01-01')
  })
})

describe('normalizeDateParam', () => {
  it('accepts both hyphen and slash separators, normalizing to slash', () => {
    expect(normalizeDateParam('2026-07-06')).toBe('2026/07/06')
    expect(normalizeDateParam('2026/07/06')).toBe('2026/07/06')
  })

  it('rejects impossible calendar dates', () => {
    expect(normalizeDateParam('2026-06-31')).toBeNull() // June has 30 days
    expect(normalizeDateParam('2026-13-01')).toBeNull() // month 13
    expect(normalizeDateParam('2026-00-05')).toBeNull() // month 00
    expect(normalizeDateParam('2026-02-30')).toBeNull() // Feb 30
  })

  it('rejects malformed shapes', () => {
    expect(normalizeDateParam('2026-7-6')).toBeNull()   // unpadded
    expect(normalizeDateParam('06/07/2026')).toBeNull() // wrong order
    expect(normalizeDateParam('not-a-date')).toBeNull()
    expect(normalizeDateParam('')).toBeNull()
  })
})

describe('normalizeDateParamIso', () => {
  // Regression for J-8/J-9: dash-consuming routes (zone-minutes eachDay split('-'),
  // training-stress dateStrMidnightInTz) require the dash form; the slash form is
  // what made both features dead in production.
  it('returns the dash form for both input separators', () => {
    expect(normalizeDateParamIso('2026-07-06')).toBe('2026-07-06')
    expect(normalizeDateParamIso('2026/07/06')).toBe('2026-07-06')
  })

  it('rejects the same impossible/malformed dates as normalizeDateParam', () => {
    expect(normalizeDateParamIso('2026-06-31')).toBeNull()
    expect(normalizeDateParamIso('2026-13-01')).toBeNull()
    expect(normalizeDateParamIso('2026-7-6')).toBeNull()
    expect(normalizeDateParamIso('not-a-date')).toBeNull()
    expect(normalizeDateParamIso('')).toBeNull()
  })

  it('produces a value that feeds dateStrMidnightInTz without an Invalid Date', () => {
    const iso = normalizeDateParamIso('2026/07/19')!
    const midnight = dateStrMidnightInTz(iso, 'Australia/Brisbane')
    expect(Number.isNaN(midnight.getTime())).toBe(false)
  })
})

describe('formatDateDisplay (Q-130)', () => {
  // It did exactly what the comment on formatDayShort, the function directly below it, calls
  // forbidden: new Date(raw) parses as UTC midnight, so any device behind UTC rendered the day
  // before. Correct on the owner's Brisbane device, off by one in London or New York.
  //
  // Note the limit of this guard: CI runs in UTC, where the old implementation also produced the
  // right day, so these assertions only bite west of UTC. Verified by running this file under
  // `TZ=America/New_York` — 2 failed before the fix, 27 passed after.
  it('renders the same calendar day formatDayShort does, for both separators', () => {
    expect(formatDateDisplay('2026-07-06')).toBe(formatDayShort('2026-07-06'))
    expect(formatDateDisplay('2026/07/06')).toBe(formatDayShort('2026-07-06'))
  })

  it('names the right weekday in long form', () => {
    // 2026-07-06 is a Monday.
    expect(formatDateDisplay('2026-07-06', 'long')).toContain('Monday')
  })

  it('returns the raw input unchanged when it is not a date string', () => {
    expect(formatDateDisplay('not-a-date')).toBe('not-a-date')
    expect(formatDateDisplay('')).toBe('')
  })
})

describe('weekStartForDay', () => {
  it('returns the same date when it is already a Monday', () => {
    expect(weekStartForDay('2026-07-20')).toBe('2026-07-20') // a Monday
  })

  it('returns the preceding Monday for a mid-week date', () => {
    expect(weekStartForDay('2026-07-23')).toBe('2026-07-20') // Thursday -> Monday
  })

  it('returns the preceding Monday for a Sunday', () => {
    expect(weekStartForDay('2026-07-26')).toBe('2026-07-20') // Sunday -> Monday
  })

  it('handles a month boundary correctly', () => {
    expect(weekStartForDay('2026-08-02')).toBe('2026-07-27') // Sunday -> Monday, crossing months
  })
})

// Mirrors the [weekStartTz, weekEndNextTz) window built by
// getWeeklySetsByMuscleGroup (lib/data/postgres/slices/periodization.ts) —
// a session logged just after user-local Monday midnight must fall inside
// the new week's window, not the previous UTC-midnight-anchored week.
describe('user-local week window boundaries (AEST)', () => {
  const tz = 'Australia/Brisbane'
  const weekStart = '2026-07-13' // Monday
  const weekEnd = '2026-07-19'   // Sunday

  it('includes a session at Monday 08:00 AEST in the new week', () => {
    const weekStartTz = dateStrMidnightInTz(weekStart, tz)
    const weekEndNextTz = dateStrMidnightInTz(shiftDateStr(weekEnd, 1), tz)
    const mondayMorningAest = new Date('2026-07-12T22:00:00Z') // Mon 08:00 AEST (UTC+10)

    expect(mondayMorningAest.getTime() >= weekStartTz.getTime()).toBe(true)
    expect(mondayMorningAest.getTime() < weekEndNextTz.getTime()).toBe(true)
  })

  it('excludes a session at Sunday 23:00 AEST from the following week', () => {
    const weekStartTz = dateStrMidnightInTz(weekStart, tz)
    const sundayNightAest = new Date('2026-07-12T13:00:00Z') // Sun 13:00 UTC = Sun 23:00 AEST, the day before weekStart

    expect(sundayNightAest.getTime() < weekStartTz.getTime()).toBe(true)
  })

  it('excludes a session that lands on the next Monday just before local midnight', () => {
    const weekEndNextTz = dateStrMidnightInTz(shiftDateStr(weekEnd, 1), tz)
    const almostNextMonday = new Date('2026-07-19T13:59:00Z') // one minute before Mon 00:00 AEST

    expect(almostNextMonday.getTime() < weekEndNextTz.getTime()).toBe(true)
  })
})

describe('dayKeyInTz (Q-163)', () => {
  // The calendar-day key the week strip, the streak card and the local-history fill all bucket by.
  // It existed as two copies hardcoded to DEFAULT_TZ, so a user outside Brisbane saw another zone's
  // day presented as their own — the fourth appearance of this class after Q-73, Q-144 and Q-148.
  it('returns each zone its OWN day when they straddle midnight', () => {
    // 2026-08-09 22:30 UTC. Brisbane is already on the 10th; New York is still on the 9th.
    const at = new Date('2026-08-09T22:30:00Z')
    const key = (tz: string) => dayKeyInTz(tz, 0, at)

    expect(key('Australia/Brisbane')).toBe('2026/08/10')
    expect(key('America/New_York')).toBe('2026/08/09')
    expect(key('Europe/London')).toBe('2026/08/09')
    // The bug was every one of these returning Brisbane's answer.
    expect(key('America/New_York')).not.toBe(key('Australia/Brisbane'))
  })

  it('counts days back within the caller zone, not UTC', () => {
    const at = new Date('2026-08-09T22:30:00Z')
    expect(dayKeyInTz('America/New_York', 1, at)).toBe('2026/08/08')
    expect(dayKeyInTz('Australia/Brisbane', 1, at)).toBe('2026/08/09')
  })

  it('uses slashes, because that is what the callers key their maps by', () => {
    expect(dayKeyInTz('Australia/Brisbane', 0, new Date('2026-08-09T02:00:00Z'))).toBe('2026/08/09')
  })

  it('crosses a month boundary correctly', () => {
    expect(dayKeyInTz('Australia/Brisbane', 1, new Date('2026-08-01T02:00:00Z'))).toBe('2026/07/31')
  })
})

// Q-489 — "yesterday" derived by subtracting 86,400,000 ms is wrong on a DST fall-back day.
//
// This is a **class** test, not a call-site test. Five sites built a calendar day from an ms offset
// (`toAestDay(new Date(Date.now() - 86_400_000), tz)` and friends); all five now shift the date
// string instead. Pinning the divergence itself means the test cannot go stale when a call site
// moves, and — the part that matters — **it needs no clock**. Both instants are passed in
// explicitly, so it fires on every CI run rather than for one hour, once a year, in one timezone.
// The repo has been bitten twice by tests that only fire inside a window (Q-356 and the
// `scale-ble-day-keying` fixture), which is the reason for building it this way.
describe('Q-489 — a calendar day comes from the date string, never from an ms offset', () => {
  const NY = 'America/New_York'
  const msOffsetYesterday = (now: Date, tz: string) =>
    formatInTimeZone(new Date(now.getTime() - 86_400_000), tz, 'yyyy-MM-dd')
  const stringShiftYesterday = (now: Date, tz: string) =>
    shiftDateStr(formatInTimeZone(now, tz, 'yyyy-MM-dd'), -1)

  it('agree on an ordinary day, and on the 23-hour spring-forward day', () => {
    for (const iso of ['2026-06-15T14:00:00Z', '2026-03-08T05:30:00Z', '2026-11-01T04:30:00Z']) {
      const now = new Date(iso)
      expect(stringShiftYesterday(now, NY), iso).toBe(msOffsetYesterday(now, NY))
    }
  })

  it('diverge in the last hour of the 25-hour fall-back day — the ms offset returns TODAY', () => {
    // 04:30 UTC on 2026-11-02 is 23:30 local on 2026-11-01 in New York — the last hour of a day
    // that ran 25 hours. Subtracting 24 hours from it lands back inside the same local day.
    // The hour matters: at 03:30 UTC (22:30 local) the offset is still correct, which is why this
    // is a one-hour-per-year defect rather than a one-day one.
    const now = new Date('2026-11-02T04:30:00Z')
    expect(formatInTimeZone(now, NY, 'yyyy-MM-dd')).toBe('2026-11-01')

    expect(msOffsetYesterday(now, NY)).toBe('2026-11-01')   // the bug: "yesterday" is today
    expect(stringShiftYesterday(now, NY)).toBe('2026-10-31') // the fix: the true previous day
  })

  it('shifts across a month and a year boundary without hand-rolled arithmetic', () => {
    expect(shiftDateStr('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateStr('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftDateStr('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateStr('2026-11-01', -7)).toBe('2026-10-25')
  })
})
