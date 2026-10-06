// #2230 — an evening sleep window is the start of tonight, never the night a date woke from.
//
// A night-band window that begins and ends on the evening of its own wake date (a broken onset at
// 21:30–22:30, or the 20:53–22:26 evening nap the classifier calls night) is dated to that day.
// On a date with no longer night, `canonicalNightForDate` returned it, Body Battery anchored the
// day's wake at 22:30, every earlier reading fell outside the day, and a late read or a re-derive
// replaced the measured day with a few samples. `nightWokenFrom` is the wake anchor's picker.
import { describe, it, expect } from 'vitest'
import {
  nightSessions,
  canonicalNightForDate,
  nightWokenFrom,
  opensFollowingNight,
} from '../sleep-night'

const TZ = 'Australia/Brisbane'
const D = '2026-08-31'
/** A Brisbane wall-clock time (UTC+10, no DST) on `day`; hours past 24 roll into the next day. */
const bne = (day: string, h: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (h - 10) * 3_600_000)
const sleepWindow = (startDay: string, startH: number, endDay: string, endH: number, durationHours: number) => ({
  date: endDay, sleepStart: bne(startDay, startH), sleepEnd: bne(endDay, endH), durationHours,
})

const OVERNIGHT = sleepWindow('2026-08-30', 21.45, D, 5.9, 7.83)
const EVENING_ONSET = sleepWindow(D, 21.5, D, 22.5, 1)
const EVENING_NAP = sleepWindow(D, 20.88, D, 22.43, 1.4)

describe('opensFollowingNight', () => {
  it('is true of a window that began and ended on the evening of its own date', () => {
    for (const w of [EVENING_ONSET, EVENING_NAP]) {
      const [night] = nightSessions([w], TZ)
      expect(night.date).toBe(D)
      expect(opensFollowingNight(night, TZ)).toBe(true)
    }
  })

  it('is false of an ordinary night, an early sleeper, a night running past midnight, and a daytime block', () => {
    const cases = [
      OVERNIGHT,
      // 19:00 → 03:00: the midpoint is 23:00 on the date BEFORE the wake date.
      sleepWindow('2026-08-30', 19, D, 3, 8),
      // 21:30 → 05:00 next day: dated to the next day, midpoint in its small hours.
      sleepWindow(D, 21.5, '2026-09-01', 5, 7.5),
      // RV-163's daytime block stays #2348's question; this change does not touch it.
      sleepWindow(D, 10.7, D, 17.42, 6.17),
    ]
    for (const w of cases) {
      const [night] = nightSessions([w], TZ)
      expect(opensFollowingNight(night, TZ)).toBe(false)
    }
  })
})

describe('nightWokenFrom', () => {
  it('returns nothing for a date whose only night is an evening window', () => {
    const nights = nightSessions([EVENING_ONSET], TZ)
    // The pick that anchored the day at 22:30.
    expect(canonicalNightForDate(nights, D)?.sleepEnd).toEqual(EVENING_ONSET.sleepEnd)
    expect(nightWokenFrom(nights, D, TZ)).toBeNull()
  })

  it('takes the morning night even when the evening window is longer', () => {
    const shortMorning = sleepWindow(D, 3, D, 5, 2)
    const longEvening = sleepWindow(D, 20.5, D, 23.5, 3)
    const nights = nightSessions([shortMorning, longEvening], TZ)
    expect(canonicalNightForDate(nights, D)?.durationHours).toBe(3)
    expect(nightWokenFrom(nights, D, TZ)?.durationHours).toBe(2)
  })

  it('agrees with canonicalNightForDate whenever a longer night is on the date', () => {
    const daytime = sleepWindow(D, 10.7, D, 17.42, 6.17)
    for (const sessions of [[OVERNIGHT], [OVERNIGHT, EVENING_ONSET], [OVERNIGHT, daytime], [daytime]]) {
      const nights = nightSessions(sessions, TZ)
      expect(nightWokenFrom(nights, D, TZ)).toEqual(canonicalNightForDate(nights, D))
    }
  })

  it('leaves the next day alone: the evening window still joins the night it opened', () => {
    const rest = sleepWindow('2026-09-01', 0.5, '2026-09-01', 6, 5.5)
    const nights = nightSessions([OVERNIGHT, EVENING_ONSET, rest], TZ)
    const next = nightWokenFrom(nights, '2026-09-01', TZ)
    expect(next?.sleepStart).toEqual(EVENING_ONSET.sleepStart)
    expect(next?.durationHours).toBe(6.5)
  })
})
