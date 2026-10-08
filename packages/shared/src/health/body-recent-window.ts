import { shiftDateStr } from '../date-utils'

/**
 * The window `/api/body-metadata` calls `recent`: the newest rows from the last seven calendar
 * days, NEWEST FIRST. Every reader of Health's `metaRecent` assumes it: the latest-weight tile is
 * `find(weightKg != null)`, the sparklines are `[...metaRecent].reverse()`.
 *
 * #2505. The device's local-store seed handed `metaRecent` the store's rows oldest first and about a
 * month wide, so while the network fetch was in flight (and for good when offline or when the fetch
 * failed) the weight tile showed the OLDEST weigh-in of the month and the sparklines drew backwards
 * over thirty days. The route and the seed now both ask this, so the shape cannot drift again.
 */
export const BODY_RECENT_DAYS = 7

/** The first calendar day of the window, ending at `today` (the user's day). */
export function bodyRecentFromDay(today: string): string {
  return shiftDateStr(today, -BODY_RECENT_DAYS)
}

/** Rows within the window, newest first, at most `BODY_RECENT_DAYS`. Does not mutate its input. */
export function recentBodyRows<T extends { date: string }>(rows: readonly T[], today: string): T[] {
  const from = bodyRecentFromDay(today)
  return rows
    .filter(r => r.date >= from && r.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, BODY_RECENT_DAYS)
}
