import { todayInTz } from '@trainingai/shared/date-utils'

export interface CalendarMonth {
  year: number
  /** 1-12, as the `calendar-data:` cache key and the overlay readers expect. */
  month: number
  /** `month` zero-padded, for building a `YYYY-MM` key directly. */
  mm: string
}

/**
 * The calendar month the USER is in, not the one the device's clock is in (RV-176).
 *
 * Four surfaces built this from `new Date().getMonth()`, which keys the `calendar-data:` cache and
 * the local overlay reads to whatever zone the phone is set to. On the first and last days of a
 * month those disagree with the server's month for up to ten hours, and the screen seeds from — or
 * writes to — a key for a month the user is not in.
 */
export function calendarMonthInTz(tz: string): CalendarMonth {
  const [year, month] = todayInTz(tz).split('-').map(Number)
  return { year, month, mm: String(month).padStart(2, '0') }
}

/**
 * The month before `m` of `y`, for the second seed that keeps a streak spanning the boundary
 * correct on first paint.
 *
 * `Date.UTC` normalises the December underflow rather than the caller hand-adjusting the year —
 * hand-rolled calendar arithmetic is what built `2026-06-31` and 500'd the workout screen (#23).
 */
export function previousCalendarMonth({ year, month }: CalendarMonth): CalendarMonth {
  const d = new Date(Date.UTC(year, month - 2, 1))
  const prevMonth = d.getUTCMonth() + 1
  return { year: d.getUTCFullYear(), month: prevMonth, mm: String(prevMonth).padStart(2, '0') }
}
