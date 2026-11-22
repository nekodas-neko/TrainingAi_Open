/**
 * #3890 decision 7: when the weekly check-in card is due.
 *
 * The card for a training week (local Monday to Sunday, the app's week: `weekStartForDay`) is due
 *   - once the week's last planned session is logged: the planned count is reached, or, on a weekly
 *     schedule, a workout was completed on or after the last scheduled training day; or
 *   - from Sunday 17:00 in the person's timezone, if that session has not happened.
 * It stays open through the Monday after (a grace day, so a Sunday evening without the app does not
 * lose the week), unless it was saved or dismissed. A saved or dismissed card is not due again.
 *
 * Pure: the clock and the timezone are passed in. Every "day" here is a local calendar date, so a
 * daylight-saving change, a week boundary and New Year are calendar arithmetic, never `now − N days`.
 */
import { formatInTimeZone } from 'date-fns-tz'
import { daysBetweenDateStrs, shiftDateStr, weekStartForDay } from '../date-utils'
import { getScheduledSessionsPerWeek } from '../schedule-utils'
import type { Program } from '../types/program'

/** Sunday, the last day of the app's week, as a 0-based index from Monday. */
const SUNDAY_INDEX = 6
/** The hour on Sunday, local time, from which the card is due whatever was logged. */
export const CHECKIN_SUNDAY_HOUR = 17

export type CheckinDueWhy = 'planned_count_reached' | 'last_planned_day_logged' | 'sunday_evening' | 'grace_monday'

export interface CheckinWeekInput {
  /** Sessions the week plans (`plannedWeekOf`); null, 0 or less turns the count rule off. */
  plannedSessions: number | null
  /** Training days of a weekly schedule, 0 = Monday … 6 = Sunday (`ScheduleDay.dayOfWeek`); null for
   *  a rotation or no schedule. */
  plannedWeekdays: readonly number[] | null
  /** The local dates (YYYY-MM-DD) of the week's completed workouts, one entry per workout. */
  doneDays: readonly string[]
}

export interface CheckinDueInput {
  now: Date
  tz: string
  thisWeek: CheckinWeekInput
  /** Whether last week's check-in was saved or dismissed (only read on a Monday, for the grace day). */
  lastWeekResolved: boolean
  /** Whether this week's check-in was saved or dismissed already. */
  thisWeekResolved: boolean
}

export interface CheckinDue {
  /** The week the card is for (its local Monday), or null when no card is due. */
  weekStart: string | null
  why: CheckinDueWhy | null
}

/** The local date and wall-clock hour at `now` in `tz`. */
export function localClock(now: Date, tz: string): { today: string; hour: number } {
  return { today: formatInTimeZone(now, tz, 'yyyy-MM-dd'), hour: Number(formatInTimeZone(now, tz, 'H')) }
}

/** The local Monday of the week `now` falls in. */
export function checkinWeekStart(now: Date, tz: string): string {
  return weekStartForDay(localClock(now, tz).today)
}

/** Why a week's own sessions make its card due, or null. Ignores the clock. */
export function weekCompleteWhy(weekStart: string, week: CheckinWeekInput): CheckinDueWhy | null {
  const inWeek = week.doneDays.filter(d => {
    const i = daysBetweenDateStrs(weekStart, d)
    return i >= 0 && i <= SUNDAY_INDEX
  })
  if (week.plannedSessions != null && week.plannedSessions > 0 && inWeek.length >= week.plannedSessions) return 'planned_count_reached'
  const planned = (week.plannedWeekdays ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= SUNDAY_INDEX)
  if (planned.length > 0) {
    const last = Math.max(...planned)
    if (inWeek.some(d => daysBetweenDateStrs(weekStart, d) >= last)) return 'last_planned_day_logged'
  }
  return null
}

export function checkinDue(input: CheckinDueInput): CheckinDue {
  const { today, hour } = localClock(input.now, input.tz)
  const weekStart = weekStartForDay(today)
  const dayIndex = daysBetweenDateStrs(weekStart, today)

  // Monday: last week's card comes first while it was never saved or dismissed, even when this week is
  // already complete that Monday (a one-session program, or Monday is the last training day). Its
  // Sunday 17:00 has passed by definition, so no session count is needed. This week's card follows once
  // last week's is resolved, or on Tuesday when the grace day has ended.
  if (dayIndex === 0 && !input.lastWeekResolved) return { weekStart: shiftDateStr(weekStart, -7), why: 'grace_monday' }
  if (!input.thisWeekResolved) {
    const why = weekCompleteWhy(weekStart, input.thisWeek)
    if (why) return { weekStart, why }
    if (dayIndex === SUNDAY_INDEX && hour >= CHECKIN_SUNDAY_HOUR) return { weekStart, why: 'sunday_evening' }
  }
  return { weekStart: null, why: null }
}

/**
 * The week a program plans, counted once for the due rule and the summary alike (review, 22 Nov): a
 * weekly schedule's training days (days with a session), a rotation's sessions per week, and nothing
 * for a program with no schedule, which then has no planned count rather than a default of 3.
 */
export function plannedWeekOf(program: Pick<Program, 'schedule'>): { count: number | null; weekdays: number[] | null } {
  const schedule = program.schedule
  if (schedule?.type === 'weekly') {
    const weekdays = [...new Set((schedule.days ?? []).filter(d => d.sessionId != null).map(d => d.dayOfWeek))]
    return { count: weekdays.length > 0 ? weekdays.length : null, weekdays }
  }
  // A rotation's count is `getScheduledSessionsPerWeek`'s, the one the volume budget divides by.
  if (schedule?.type === 'rotation' && schedule.restAfterN) return { count: getScheduledSessionsPerWeek(program as Program), weekdays: null }
  return { count: null, weekdays: null }
}
