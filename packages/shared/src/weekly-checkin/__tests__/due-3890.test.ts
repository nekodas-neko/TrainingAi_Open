// #3890 decision 7: the card is due after the week's last planned session, or from Sunday 17:00 local,
// and stays open through the Monday after. Pure, so every case passes its own clock and zone: a week
// boundary, New Year (the ISO week-year differs from the calendar year there) and both daylight-saving
// changes. Each instant is built from a local wall-clock time with `fromZonedTime`, never `now − N days`.
import { describe, it, expect } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { checkinDue, checkinWeekStart, CHECKIN_SUNDAY_HOUR, plannedWeekOf, weekCompleteWhy, type CheckinWeekInput } from '../due'
import type { Program } from '../../types/program'

const at = (local: string, tz: string) => fromZonedTime(local, tz)
const week = (over: Partial<CheckinWeekInput> = {}): CheckinWeekInput => ({ plannedSessions: 3, plannedWeekdays: null, doneDays: [], ...over })
const due = (local: string, tz: string, thisWeek: CheckinWeekInput, opts: { thisWeekResolved?: boolean; lastWeekResolved?: boolean } = {}) =>
  checkinDue({ now: at(local, tz), tz, thisWeek, thisWeekResolved: opts.thisWeekResolved ?? false, lastWeekResolved: opts.lastWeekResolved ?? true })

describe('the week the card is for', () => {
  it('is the local Monday, in the person\'s zone, not the server\'s', () => {
    // 23:30 Sunday in Brisbane is 13:30 UTC Sunday; 00:30 Monday in Brisbane is still Sunday in UTC.
    expect(checkinWeekStart(at('2026-11-22T23:30:00', 'Australia/Brisbane'), 'Australia/Brisbane')).toBe('2026-11-16')
    expect(checkinWeekStart(at('2026-11-23T00:30:00', 'Australia/Brisbane'), 'Australia/Brisbane')).toBe('2026-11-23')
    expect(checkinWeekStart(at('2026-11-23T00:30:00', 'Australia/Brisbane'), 'UTC')).toBe('2026-11-16')
  })

  it('crosses New Year by date: the week of Thu 1 Jan 2027 starts Mon 28 Dec 2026', () => {
    expect(checkinWeekStart(at('2027-01-01T12:00:00', 'Europe/London'), 'Europe/London')).toBe('2026-12-28')
    expect(checkinWeekStart(at('2027-01-03T18:00:00', 'Europe/London'), 'Europe/London')).toBe('2026-12-28')
    expect(checkinWeekStart(at('2027-01-04T00:00:00', 'Europe/London'), 'Europe/London')).toBe('2027-01-04')
  })
})

describe('due after the week\'s last planned session', () => {
  const tz = 'Australia/Brisbane'
  it('is not due mid-week with sessions still to come', () => {
    expect(due('2026-11-18T12:00:00', tz, week({ doneDays: ['2026-11-16', '2026-11-18'] }))).toEqual({ weekStart: null, why: null })
  })
  it('is due once the planned count is reached', () => {
    expect(due('2026-11-20T19:00:00', tz, week({ doneDays: ['2026-11-16', '2026-11-18', '2026-11-20'] })))
      .toEqual({ weekStart: '2026-11-16', why: 'planned_count_reached' })
  })
  it('on a weekly schedule, is due once a workout is logged on the last training day, even with one skipped', () => {
    // Mon, Wed, Fri (0, 2, 4). Wednesday skipped; Friday logged.
    expect(due('2026-11-20T19:00:00', tz, week({ plannedWeekdays: [0, 2, 4], doneDays: ['2026-11-16', '2026-11-20'] })))
      .toEqual({ weekStart: '2026-11-16', why: 'last_planned_day_logged' })
  })
  it('a workout from last week does not count toward this week', () => {
    expect(weekCompleteWhy('2026-11-16', week({ doneDays: ['2026-11-13', '2026-11-14', '2026-11-15'] }))).toBeNull()
  })
  it('no planned count (0) turns the count rule off', () => {
    expect(weekCompleteWhy('2026-11-16', week({ plannedSessions: 0, doneDays: ['2026-11-16'] }))).toBeNull()
  })
})

describe('due from Sunday 17:00 local if that session has not happened', () => {
  const tz = 'Australia/Brisbane'
  it('not at 16:59, due at 17:00', () => {
    expect(due(`2026-11-22T${String(CHECKIN_SUNDAY_HOUR - 1)}:59:00`, tz, week()).weekStart).toBeNull()
    expect(due(`2026-11-22T${CHECKIN_SUNDAY_HOUR}:00:00`, tz, week())).toEqual({ weekStart: '2026-11-16', why: 'sunday_evening' })
  })
  it('a saved or dismissed card is not due again', () => {
    expect(due('2026-11-22T18:00:00', tz, week(), { thisWeekResolved: true })).toEqual({ weekStart: null, why: null })
  })
  it('stays open through the Monday after, then closes', () => {
    expect(due('2026-11-23T09:00:00', tz, week(), { lastWeekResolved: false })).toEqual({ weekStart: '2026-11-16', why: 'grace_monday' })
    expect(due('2026-11-24T09:00:00', tz, week(), { lastWeekResolved: false }).weekStart).toBeNull()
    expect(due('2026-11-23T09:00:00', tz, week(), { lastWeekResolved: true }).weekStart).toBeNull()
  })
  it('across New Year: Sunday 3 Jan 2027 17:00 opens the week of Mon 28 Dec', () => {
    expect(due('2027-01-03T17:00:00', 'Europe/London', week())).toEqual({ weekStart: '2026-12-28', why: 'sunday_evening' })
    expect(due('2027-01-04T08:00:00', 'Europe/London', week(), { lastWeekResolved: false }))
      .toEqual({ weekStart: '2026-12-28', why: 'grace_monday' })
  })
})

describe('daylight-saving changes', () => {
  it('Sydney: clocks go forward on Sunday 4 Oct 2026, and 17:00 is still 17:00 local', () => {
    const tz = 'Australia/Sydney'
    expect(due('2026-10-04T16:59:00', tz, week()).weekStart).toBeNull()
    expect(due('2026-10-04T17:00:00', tz, week())).toEqual({ weekStart: '2026-09-28', why: 'sunday_evening' })
    // 17:00 local is 06:00 UTC after the change (UTC+11), not 07:00 as the week before (UTC+10).
    expect(at('2026-10-04T17:00:00', tz).toISOString()).toBe('2026-10-04T06:00:00.000Z')
  })
  it('London: clocks go back on Sunday 25 Oct 2026; the 25-hour day is still one day', () => {
    const tz = 'Europe/London'
    expect(due('2026-10-25T17:00:00', tz, week())).toEqual({ weekStart: '2026-10-19', why: 'sunday_evening' })
    expect(due('2026-10-25T23:59:00', tz, week()).weekStart).toBe('2026-10-19')
    expect(due('2026-10-26T00:00:00', tz, week(), { lastWeekResolved: false })).toEqual({ weekStart: '2026-10-19', why: 'grace_monday' })
    // A workout on the 25-hour Sunday is that Sunday's, and it is the last planned day.
    expect(due('2026-10-25T09:00:00', tz, week({ plannedWeekdays: [6], doneDays: ['2026-10-25'] })))
      .toEqual({ weekStart: '2026-10-19', why: 'last_planned_day_logged' })
  })
})

describe('D1: on the grace Monday, last week\'s unanswered card comes first', () => {
  const tz = 'Australia/Brisbane'
  // A one-session program: Monday's workout completes this week on the same Monday.
  const oneSession = week({ plannedSessions: 1, plannedWeekdays: [0], doneDays: ['2026-11-23'] })
  it('even when this week is already complete that Monday', () => {
    expect(due('2026-11-23T19:00:00', tz, oneSession, { lastWeekResolved: false })).toEqual({ weekStart: '2026-11-16', why: 'grace_monday' })
  })
  it('this week\'s follows once last week\'s is saved or dismissed', () => {
    expect(due('2026-11-23T19:00:00', tz, oneSession, { lastWeekResolved: true })).toEqual({ weekStart: '2026-11-23', why: 'planned_count_reached' })
  })
  it('or when the grace day has ended', () => {
    expect(due('2026-11-24T08:00:00', tz, oneSession, { lastWeekResolved: false })).toEqual({ weekStart: '2026-11-23', why: 'planned_count_reached' })
  })
})

describe('C3: one planned count for the due rule and the summary', () => {
  const program = (schedule: Program['schedule']) => ({ schedule }) as Pick<Program, 'schedule'>
  it('a weekly schedule counts its training days (days with a session), once each', () => {
    expect(plannedWeekOf(program({ id: 's', programId: 'p', type: 'weekly', days: [
      { dayOfWeek: 0, sessionId: 'a' }, { dayOfWeek: 2 }, { dayOfWeek: 4, sessionId: 'b' },
    ] } as Program['schedule']))).toEqual({ count: 2, weekdays: [0, 4] })
  })
  it('a rotation counts as the volume budget does; no schedule has no planned count', () => {
    expect(plannedWeekOf(program({ id: 's', programId: 'p', type: 'rotation', restAfterN: 3 } as Program['schedule']))).toEqual({ count: 5, weekdays: null })
    expect(plannedWeekOf(program(undefined))).toEqual({ count: null, weekdays: null })
    expect(plannedWeekOf(program({ id: 's', programId: 'p', type: 'weekly', days: [{ dayOfWeek: 1 }] } as Program['schedule']))).toEqual({ count: null, weekdays: [] })
  })
  it('no planned count: due only from Sunday 17:00', () => {
    const tz = 'Australia/Brisbane'
    const noPlan = week({ plannedSessions: null, doneDays: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'] })
    expect(due('2026-11-21T12:00:00', tz, noPlan)).toEqual({ weekStart: null, why: null })
    expect(due('2026-11-22T17:00:00', tz, noPlan)).toEqual({ weekStart: '2026-11-16', why: 'sunday_evening' })
  })
})
