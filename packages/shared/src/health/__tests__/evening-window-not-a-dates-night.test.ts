// #2456 — on a date with no morning night, a short evening window was graded as that date's night.
//
// A night-band window that begins and ends on the evening of its own wake date (a broken onset at
// 21:30–22:30, or the 20:53–22:26 evening nap) is dated to that day. `canonicalNightForDate`
// returned it when nothing longer shared the date, so the sleep score, the day audit and the
// derived-score backfill graded a one-hour bout as the night (2026-08-31: sleep 56 → 15). The
// rule now: a short evening window is no date's night; one of four hours or more is a main sleep
// on any clock and still counts (readiness-tree edge case 13).
import { describe, it, expect } from 'vitest'
import {
  ALWAYS_NIGHT_MIN_HOURS,
  canonicalLatestNight,
  canonicalNightForDate,
  isDatesNight,
  nightSessions,
} from '../sleep-night'
import { buildSleepAudit } from '../score-audit/sleep'
import type { SleepSession } from '@trainingai/shared/types/body'

const TZ = 'Australia/Brisbane'
const D = '2026-08-31'
const PREV = '2026-08-30'
/** A Brisbane wall-clock time (UTC+10, no DST) on `day`; hours past 24 roll into the next day. */
const bne = (day: string, h: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (h - 10) * 3_600_000)
let seq = 0
const sleepWindow = (startDay: string, startH: number, endDay: string, endH: number, durationHours: number): SleepSession => ({
  id: `s${++seq}`,
  userId: 'u1',
  date: endDay,
  sleepStart: bne(startDay, startH),
  sleepEnd: bne(endDay, endH),
  durationHours,
  efficiency: 90,
  createdAt: new Date(0),
})

const PREV_NIGHT = sleepWindow('2026-08-29', 21.5, PREV, 5.75, 7.8)
const EVENING_ONSET = sleepWindow(D, 21.5, D, 22.5, 1)
const EVENING_NAP = sleepWindow(D, 20.88, D, 22.43, 1.4)

describe('canonicalNightForDate', () => {
  it('returns nothing for a date whose only night is a short evening window', () => {
    for (const w of [EVENING_ONSET, EVENING_NAP]) {
      const nights = nightSessions([w], TZ)
      // The premise: the classifier still calls it night and dates it to D.
      expect(nights.map(n => n.date)).toEqual([D])
      expect(canonicalNightForDate(nights, D, TZ)).toBeNull()
    }
  })

  it('prefers a short morning night over a longer short evening window', () => {
    const shortMorning = sleepWindow(D, 2, D, 4, 2)
    const evening = sleepWindow(D, 20.5, D, 23.5, 3)
    const nights = nightSessions([shortMorning, evening], TZ)
    expect(canonicalNightForDate(nights, D, TZ)?.durationHours).toBe(2)
  })

  it('keeps an evening main sleep of four hours or more, the night-shift sleeper (edge case 13)', () => {
    const shiftSleep = sleepWindow(D, 18.5, D, 23.5, ALWAYS_NIGHT_MIN_HOURS)
    const nights = nightSessions([shiftSleep], TZ)
    expect(canonicalNightForDate(nights, D, TZ)?.durationHours).toBe(ALWAYS_NIGHT_MIN_HOURS)
  })

  it('leaves an ordinary night, and one that ran past midnight, untouched', () => {
    const overnight = sleepWindow(PREV, 21.75, D, 6, 7.9)
    expect(canonicalNightForDate(nightSessions([overnight, EVENING_ONSET], TZ), D, TZ)?.durationHours).toBe(7.9)
    // 22:00 → 01:30: midpoint 23:45 on the date BEFORE the wake date, so it is that date's night.
    const late = sleepWindow(PREV, 22, D, 1.5, 3.2)
    expect(canonicalNightForDate(nightSessions([late], TZ), D, TZ)?.durationHours).toBe(3.2)
  })

  it('an evening window that joins the night it opened is part of the next date, as before', () => {
    const rest = sleepWindow('2026-09-01', 0.5, '2026-09-01', 6, 5.5)
    const nights = nightSessions([EVENING_ONSET, rest], TZ)
    expect(canonicalNightForDate(nights, '2026-09-01', TZ)?.durationHours).toBe(6.5)
    expect(canonicalNightForDate(nights, D, TZ)).toBeNull()
  })
})

describe('canonicalLatestNight', () => {
  it('passes over a latest date that holds only a short evening window', () => {
    const nights = nightSessions([PREV_NIGHT, EVENING_ONSET], TZ)
    const picked = canonicalLatestNight(nights, TZ)
    expect(picked?.date).toBe(PREV)
    expect(picked?.durationHours).toBe(7.8)
  })

  it('returns nothing when the only night is a short evening window', () => {
    expect(canonicalLatestNight(nightSessions([EVENING_NAP], TZ), TZ)).toBeNull()
  })

  it('agrees with isDatesNight on every window it can pick', () => {
    const nights = nightSessions([PREV_NIGHT, EVENING_ONSET], TZ)
    expect(nights.filter(n => isDatesNight(n, TZ)).map(n => n.date)).toEqual([PREV])
  })
})

describe('the day audit (what POST /api/admin/backfill-derived-scores persists)', () => {
  it('grades no night for a date whose only window is an evening bout', () => {
    const audit = buildSleepAudit({ date: D, tz: TZ, sleepSessions: [PREV_NIGHT, EVENING_ONSET], derived: null })
    expect(audit.score).toBeNull()
    expect(audit.gaps.join(' ')).toContain(`wake day ${D}`)
  })

  it('still grades the previous date from its own night', () => {
    const audit = buildSleepAudit({ date: PREV, tz: TZ, sleepSessions: [PREV_NIGHT, EVENING_ONSET], derived: null })
    expect(audit.score).not.toBeNull()
  })
})
