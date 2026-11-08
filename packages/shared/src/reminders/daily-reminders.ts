import { localClockTimeToDate, shiftDateStr } from '../date-utils'

/**
 * The daily reminders both apps schedule from settings already stored on the account (#3653):
 * each supplement's own reminder time, the end of a meal group's window, the end-of-day "log your
 * meals" nudge before bed, the day review's wind-down, and the Sunday recap.
 *
 * The rules and the words live here once. The current app schedules them through Capacitor
 * (`lib/supplement-reminders.ts`, `lib/meal-reminders.ts`, `lib/day-review-reminders.ts`), and
 * TrainingAi Preview through its alert plan (`mobile/src/features/platform/data/daily-reminders.ts`).
 *
 * Every instant is the user's wall clock in their profile zone, never the phone's (LB-148), so a
 * reminder set for 08:00 fires at 08:00 Brisbane time on a phone that has drifted to another zone,
 * and on the right side of a DST change.
 */

export type ReminderText = { title: string; body: string }

/** What a supplement reminder reads off a supplement. */
export type SupplementForReminder = {
  name: string
  active: boolean
  reminderEnabled: boolean
  reminderTime?: string | null
  loggedToday: boolean
}

/** What a meal reminder reads off a meal group. */
export type MealTypeForReminder = {
  id: string
  name: string
  emoji: string
  remindersEnabled: boolean
  timeEndHour: number
  required: boolean
}

export type Bedtime = { bedtimeHour: number; bedtimeMinute: number }

/** The bedtime used while there is no estimate yet, as `/api/user/bedtime-estimate` falls back to. */
export const FALLBACK_BEDTIME: Bedtime = { bedtimeHour: 22, bedtimeMinute: 0 }

export const END_OF_DAY_MINUTES_BEFORE_BEDTIME = 30
export const DAY_REVIEW_MINUTES_BEFORE_BEDTIME = 50
export const WEEKLY_RECAP_HOUR = 18

/** True when a supplement wants today's reminder: on, timed, still taken, and not logged yet. */
export function supplementReminderDue(s: SupplementForReminder): boolean {
  return s.active && s.reminderEnabled && !!s.reminderTime && !s.loggedToday
}

/** The instant a supplement's `HH:MM` reminder time falls on `date` in `tz`; null for a bad time. */
export function supplementReminderAt(date: string, reminderTime: string | null | undefined, tz: string): Date | null {
  return localClockTimeToDate(date, reminderTime, tz)
}

export function supplementReminderText(name: string): ReminderText {
  return { title: 'Supplement reminder', body: `Don't forget to log ${name}!` }
}

/** The end of a meal group's window on `date`: its end hour, or 23:59 for a window that runs to midnight. */
export function mealWindowEndAt(date: string, timeEndHour: number, tz: string): Date {
  const end = timeEndHour >= 24 ? '23:59' : `${String(Math.max(0, timeEndHour)).padStart(2, '0')}:00`
  return localClockTimeToDate(date, end, tz)!
}

export function mealReminderText(emoji: string, name: string): ReminderText {
  return { title: 'Meal reminder', body: `Don't forget to log ${emoji} ${name}!` }
}

/** True when a meal group marked required has nothing logged — what the end-of-day reminder is for. */
export function hasUnloggedRequiredMeal(
  mealTypes: readonly Pick<MealTypeForReminder, 'id' | 'required'>[],
  loggedMealTypeIds: ReadonlySet<string>,
): boolean {
  return mealTypes.some(mt => mt.required && !loggedMealTypeIds.has(mt.id))
}

/**
 * The instant of the bedtime that ends `date`'s day, in `tz`. A bedtime before noon is after
 * midnight, so it falls on the next calendar day: a 00:30 bedtime ends the evening of `date`, not
 * the small hours that started it.
 */
export function bedtimeAt(date: string, bedtime: Bedtime, tz: string): Date {
  const day = bedtime.bedtimeHour < 12 ? shiftDateStr(date, 1) : date
  const hhmm = `${String(bedtime.bedtimeHour).padStart(2, '0')}:${String(bedtime.bedtimeMinute).padStart(2, '0')}`
  return localClockTimeToDate(day, hhmm, tz) ?? localClockTimeToDate(date, '22:00', tz)!
}

export function endOfDayMealReminderAt(date: string, bedtime: Bedtime, tz: string): Date {
  return new Date(bedtimeAt(date, bedtime, tz).getTime() - END_OF_DAY_MINUTES_BEFORE_BEDTIME * 60_000)
}

export const END_OF_DAY_MEAL_TEXT: ReminderText = {
  title: 'Log your meals before bed',
  body: 'You have unlogged required meals today. Tap to backfill.',
}

export function dayReviewReminderAt(date: string, bedtime: Bedtime, tz: string): Date {
  return new Date(bedtimeAt(date, bedtime, tz).getTime() - DAY_REVIEW_MINUTES_BEFORE_BEDTIME * 60_000)
}

export const DAY_REVIEW_TEXT: ReminderText = {
  title: 'Bedtime approaching',
  body: 'Begin your wind-down and complete your end-of-day review.',
}

/** The Sunday on or after `date` (a `YYYY-MM-DD` local day), and 18:00 on it in `tz`. */
export function weeklyRecapReminderAt(date: string, tz: string): { sunday: string; at: Date } {
  const [y, m, d] = date.split(/[-/]/).map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() // 0 = Sunday
  const sunday = shiftDateStr(date, (7 - weekday) % 7)
  return { sunday, at: localClockTimeToDate(sunday, `${WEEKLY_RECAP_HOUR}:00`, tz)! }
}

export const WEEKLY_RECAP_TEXT: ReminderText = {
  title: 'Your week in review is ready',
  body: 'See how your week went and what to focus on next.',
}
