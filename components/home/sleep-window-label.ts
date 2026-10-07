import { formatTimeOfDay } from '@trainingai/shared/date-utils'

/**
 * The bed and wake clock times for Home's sleep card, "11:12 pm → 6:03 am", in the user's timezone.
 * `null` when either end is missing or unreadable: a night with one end is not a window, and a
 * half-filled "11:12 pm → " reads as a bug. Untimed rows (pulled before SQLite v50) hit that path.
 */
export function sleepWindowLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  tz: string,
): string | null {
  if (!start || !end) return null
  const from = formatTimeOfDay(start, tz)
  const to = formatTimeOfDay(end, tz)
  return from && to ? `${from} → ${to}` : null
}
