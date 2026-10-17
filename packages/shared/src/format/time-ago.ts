import { formatDistance } from 'date-fns'

/**
 * How long ago something happened, in the words the web app has always used for friend activity:
 * "less than a minute ago", "about 1 hour ago", "about 1 month ago". It is date-fns'
 * `formatDistanceToNow` with a clock you can pass in, so the native app reads the same sentence as
 * the web app instead of a private "41 days ago" copy (#2936).
 *
 * `null` for a value that is not a date, so the caller picks its own placeholder.
 */
export function timeAgo(at: string | number | Date, now: Date = new Date()): string | null {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) return null
  return formatDistance(date, now, { addSuffix: true })
}
