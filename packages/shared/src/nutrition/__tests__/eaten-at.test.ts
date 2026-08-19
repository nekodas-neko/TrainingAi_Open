import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { resolveEatenAt, windowMidpointHour, hourInWindow } from '../eaten-at'

const BNE = 'Australia/Brisbane'   // UTC+10, no DST
const LUNCH = { timeStartHour: 12, timeEndHour: 15 }
const PRE_WORKOUT = { timeStartHour: 6, timeEndHour: 10 }
const EVENING = { timeStartHour: 21, timeEndHour: 24 }
const ALL_DAY = { timeStartHour: 0, timeEndHour: 24 }
const OVERNIGHT = { timeStartHour: 22, timeEndHour: 2 }

/** The local wall clock of the resolved instant, which is the thing the rule is stated in. */
function localOf(at: Date, tz = BNE) {
  return formatInTimeZone(at, tz, 'yyyy-MM-dd HH:mm')
}

describe('hourInWindow', () => {
  it('is a half-open range for an ordinary window', () => {
    expect(hourInWindow(12, LUNCH)).toBe(true)
    expect(hourInWindow(14, LUNCH)).toBe(true)
    expect(hourInWindow(15, LUNCH)).toBe(false)   // exclusive end
    expect(hourInWindow(11, LUNCH)).toBe(false)
  })

  it('treats timeEndHour = 24 as end-of-day, not as a wrap', () => {
    expect(hourInWindow(21, EVENING)).toBe(true)
    expect(hourInWindow(23, EVENING)).toBe(true)
    expect(hourInWindow(20, EVENING)).toBe(false)
    expect(hourInWindow(0, EVENING)).toBe(false)  // a wrap reading would admit this
  })

  it('is a disjunction for a window that crosses midnight', () => {
    expect(hourInWindow(22, OVERNIGHT)).toBe(true)
    expect(hourInWindow(23, OVERNIGHT)).toBe(true)
    expect(hourInWindow(1, OVERNIGHT)).toBe(true)
    expect(hourInWindow(2, OVERNIGHT)).toBe(false)
    expect(hourInWindow(12, OVERNIGHT)).toBe(false)
  })
})

describe('windowMidpointHour', () => {
  it('halves an ordinary window', () => {
    expect(windowMidpointHour(LUNCH)).toBe(13.5)
    expect(windowMidpointHour(PRE_WORKOUT)).toBe(8)
    expect(windowMidpointHour(EVENING)).toBe(22.5)
    expect(windowMidpointHour(ALL_DAY)).toBe(12)
  })

  it('does not land on the opposite side of the clock for a wrapping window', () => {
    // The naive (22 + 2) / 2 is 12:00 — noon, the furthest point from the truth.
    expect(windowMidpointHour(OVERNIGHT)).toBe(0)
    expect(windowMidpointHour({ timeStartHour: 20, timeEndHour: 4 })).toBe(0)
    expect(windowMidpointHour({ timeStartHour: 23, timeEndHour: 3 })).toBe(1)
  })
})

describe('resolveEatenAt', () => {
  it('keeps the real instant when it is on the date and inside the window', () => {
    const at = new Date('2026-08-19T03:20:00Z')          // 13:20 Brisbane
    expect(resolveEatenAt({ date: '2026-08-19', window: LUNCH, at, tz: BNE })).toBe(at)
  })

  it('moves to the midpoint when the hour is outside the window', () => {
    const at = new Date('2026-08-19T12:00:00Z')          // 22:00 Brisbane, same day
    const out = resolveEatenAt({ date: '2026-08-19', window: LUNCH, at, tz: BNE })
    expect(localOf(out)).toBe('2026-08-19 13:30')
  })

  it('back-dating is the whole point: yesterday\'s dinner logged this morning', () => {
    // 08:00 Brisbane on the 19th, filed against the 18th. Before Q-413 the row said 08:00 on a
    // date of 2026-08-18 — a timestamp and a date that disagree.
    const at = new Date('2026-08-18T22:00:00Z')
    const out = resolveEatenAt({ date: '2026-08-18', window: EVENING, at, tz: BNE })
    expect(localOf(out)).toBe('2026-08-18 22:30')
  })

  it('anchors to the log\'s date, not to today — even when the hour would be inside the window', () => {
    // 13:20 Brisbane on the 19th, filed against the 17th. The hour IS inside Lunch, but the day is
    // not the log's day, so keeping it would stamp a two-day-old meal with today's clock.
    const at = new Date('2026-08-19T03:20:00Z')
    const out = resolveEatenAt({ date: '2026-08-17', window: LUNCH, at, tz: BNE })
    expect(localOf(out)).toBe('2026-08-17 13:30')
  })

  it('the default 0–24 window keeps any same-day instant, which is the conservative case', () => {
    const at = new Date('2026-08-19T12:00:00Z')          // 22:00 Brisbane
    expect(resolveEatenAt({ date: '2026-08-19', window: ALL_DAY, at, tz: BNE })).toBe(at)
  })

  it('timeEndHour = 24 admits 23:xx and stamps 22:30 for anything else', () => {
    const inside = new Date('2026-08-19T13:30:00Z')      // 23:30 Brisbane
    expect(resolveEatenAt({ date: '2026-08-19', window: EVENING, at: inside, tz: BNE })).toBe(inside)
    const outside = new Date('2026-08-19T04:00:00Z')     // 14:00 Brisbane
    expect(localOf(resolveEatenAt({ date: '2026-08-19', window: EVENING, at: outside, tz: BNE })))
      .toBe('2026-08-19 22:30')
  })

  it('a wrapping window resolves onto the log\'s own date, never the next one', () => {
    const at = new Date('2026-08-19T04:00:00Z')          // 14:00 Brisbane, outside 22–02
    const out = resolveEatenAt({ date: '2026-08-19', window: OVERNIGHT, at, tz: BNE })
    expect(localOf(out)).toBe('2026-08-19 00:00')
    // The date the row carries and the date the timestamp falls on must not disagree — that
    // disagreement is the defect being fixed, and a wrap is the easiest way to reintroduce it.
    expect(formatInTimeZone(out, BNE, 'yyyy-MM-dd')).toBe('2026-08-19')
  })

  it('resolves in the USER\'s timezone, not the process\'s', () => {
    // Chosen so BOTH zones take the midpoint branch — 20:00 UTC is outside Lunch, and it is 06:00
    // the next day in Brisbane, outside it too. Comparing a midpoint against a *kept* instant would
    // measure the branch, not the offset.
    const at = new Date('2026-08-19T20:00:00Z')
    const bne = resolveEatenAt({ date: '2026-08-19', window: LUNCH, at, tz: BNE })
    const utc = resolveEatenAt({ date: '2026-08-19', window: LUNCH, at, tz: 'UTC' })
    expect(localOf(bne)).toBe('2026-08-19 13:30')
    expect(formatInTimeZone(utc, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2026-08-19 13:30')
    // Same wall clock, ten hours apart in absolute time. That difference IS the bug when it is zero.
    expect(bne.getTime() - utc.getTime()).toBe(-10 * 3600_000)
  })

  /**
   * The standing rule from CLAUDE.md: a timezone regression test must not wait for the clock to
   * reach the failing window. So pick the fixed-offset zone whose local time is near 01:00 **right
   * now** and run the case there — it fires on every CI run rather than for two hours a day.
   */
  it('holds in a zone whose local time is currently just after midnight', () => {
    const utcHour = new Date().getUTCHours()
    // Etc/GMT-N is UTC+N (the sign is inverted in POSIX zone names). Pick N so local ≈ 01:00.
    const offset = (25 - utcHour) % 24
    const tz = offset === 0 ? 'UTC' : offset <= 12 ? `Etc/GMT-${offset}` : `Etc/GMT+${24 - offset}`
    const localHour = Number(formatInTimeZone(new Date(), tz, 'H'))
    expect(localHour, `${tz} should be near 01:00 for this case to bite`).toBeLessThanOrEqual(1)

    const today = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
    const out = resolveEatenAt({ date: today, window: LUNCH, at: new Date(), tz })
    // Now is ~01:00 local, outside Lunch, so this must be 13:30 on today's LOCAL date — not on the
    // UTC date, which is a different day at this hour and is exactly what the bug would produce.
    expect(formatInTimeZone(out, tz, 'yyyy-MM-dd HH:mm')).toBe(`${today} 13:30`)
  })
})
