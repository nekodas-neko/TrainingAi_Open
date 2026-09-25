import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * The instant at which a given wall-clock time occurs in `tz` on `dateStr` (LB-148).
 *
 * Every reminder in the app used to build this with `new Date().setHours(h, m)`, which sets the
 * hour in the **device's** zone — so a reminder configured for 08:00 fired at 08:00 wherever the
 * phone happened to be, while the "have I already notified today" key beside it was computed in the
 * user's zone. The two disagreed inside a single function.
 *
 * `fromZonedTime` resolves the wall time in `tz` properly, including across a DST boundary, which
 * adding `hour * 3600e3` to midnight would not.
 */
export function instantAtLocalTime(dateStr: string, hour: number, minute: number, tz: string): Date {
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return fromZonedTime(`${dateStr}T${hh}:${mm}:00`, tz)
}


/**
 * The calendar day `at` falls on in `tz`, as `YYYY-MM-DD`.
 *
 * Deliberately NOT `todayInTz()`: every reminder function takes `now` as a parameter so it can be
 * tested and so a reconcile can reason about a moment other than this one. Keying the schedule off
 * the real clock while comparing it against a passed-in `now` makes the two disagree the moment
 * they are not the same instant — which is the same shape as the bug this module exists to fix.
 */
export function localDayInTz(at: Date, tz: string): string {
  return formatInTimeZone(at, tz, 'yyyy-MM-dd')
}
