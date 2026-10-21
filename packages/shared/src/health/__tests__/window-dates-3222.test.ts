// #3222: the rolling-window starts that were built as `midnight − N×86400000` now shift the date
// string. In Brisbane (no daylight saving) the two forms are the same instant; in a daylight-saving
// zone the old form lands a day off around a clock change.
import { describe, it, expect } from 'vitest'
import { shiftDateStr, dateStrMidnightInTz, toAestDay } from '../../date-utils'
import { strengthWindowEndingAt } from '../activity-score'

const DAY = 86_400_000
const BNE = 'Australia/Brisbane'

const session = (at: Date) => ({ startedAt: at.toISOString(), exercises: [{ volume: 100 }] })

/** strengthWindowEndingAt before #3222, taking the day's midnight as a number of ms. */
function oldStrengthWindow(sessions: ReturnType<typeof session>[], dayMidMs: number) {
  const from = dayMidMs - 7 * DAY
  const to = dayMidMs + DAY
  const rows = sessions.filter(ws => {
    const t = new Date(ws.startedAt).getTime()
    return t >= from && t < to
  })
  return rows.length
}

const oldBack = (day: string, tz: string, n: number) => new Date(dateStrMidnightInTz(day, tz).getTime() - n * DAY)
const newBack = (day: string, tz: string, n: number) => dateStrMidnightInTz(shiftDateStr(day, -n), tz)

describe('date-string window starts, Brisbane', () => {
  it('match the old ms expression for a year of dates and every offset used', () => {
    let day = '2026-01-01'
    for (let i = 0; i < 365; i++, day = shiftDateStr(day, 1)) {
      for (const n of [3, 7, 14, 28, 60, 90, 180, 3650]) {
        expect(newBack(day, BNE, n).getTime()).toBe(oldBack(day, BNE, n).getTime())
        expect(shiftDateStr(day, -n)).toBe(toAestDay(oldBack(day, BNE, n), BNE))
      }
      expect(dateStrMidnightInTz(shiftDateStr(day, 1), BNE).getTime())
        .toBe(dateStrMidnightInTz(day, BNE).getTime() + DAY)
    }
  })

  it('strengthWindowEndingAt gives the old count for a year of dates, at both edges', () => {
    let day = '2026-01-01'
    for (let i = 0; i < 365; i++, day = shiftDateStr(day, 1)) {
      const mid = dateStrMidnightInTz(day, BNE).getTime()
      const sessions = [
        session(new Date(mid - 7 * DAY - 1)), session(new Date(mid - 7 * DAY)),
        session(new Date(mid + DAY - 1)), session(new Date(mid + DAY)),
      ]
      const got = strengthWindowEndingAt(sessions, day, BNE)
      expect(got.sessions7d).toBe(oldStrengthWindow(sessions, mid))
      expect(got.sessions7d).toBe(2)
    }
  })
})

describe('strengthWindowEndingAt across a clock change', () => {
  it('New York 2026-03-08 (spring-forward) ends on the calendar day, not 23 hours in', () => {
    // 2026-03-08 is a 23-hour day. Midnight 2026-03-09 is 04:00Z, not 05:00Z.
    const late = new Date('2026-03-09T03:30:00Z') // 2026-03-08 23:30 local, still on the day
    const next = new Date('2026-03-09T04:00:00Z') // 2026-03-09 00:00 local
    const got = strengthWindowEndingAt([session(late), session(next)], '2026-03-08', 'America/New_York')
    expect(got.sessions7d).toBe(1)
  })

  it('New York reaches back to local midnight seven calendar days earlier', () => {
    // From 2026-03-11 the window starts 2026-03-04 00:00 EST (05:00Z), before the change.
    const first = new Date('2026-03-04T05:00:00Z')
    const before = new Date('2026-03-04T04:59:00Z')
    const got = strengthWindowEndingAt([session(first), session(before)], '2026-03-11', 'America/New_York')
    expect(got.sessions7d).toBe(1)
    // The old form started at 04:00Z, which is 2026-03-03 23:00 EST: it pulled in the previous evening.
    const oldFrom = dateStrMidnightInTz('2026-03-11', 'America/New_York').getTime() - 7 * DAY
    expect(new Date(oldFrom).toISOString()).toBe('2026-03-04T04:00:00.000Z')
  })

  it('Sydney 2026-10-04 (spring-forward) start is local midnight of the calendar date', () => {
    expect(newBack('2026-10-11', 'Australia/Sydney', 7).toISOString()).toBe('2026-10-03T14:00:00.000Z')
    expect(toAestDay(oldBack('2026-10-11', 'Australia/Sydney', 7), 'Australia/Sydney')).toBe('2026-10-03')
    expect(newBack('2026-10-18', 'Australia/Sydney', 14).toISOString()).toBe('2026-10-03T14:00:00.000Z')
    expect(toAestDay(newBack('2026-10-18', 'Australia/Sydney', 14), 'Australia/Sydney')).toBe('2026-10-04')
  })
})
