import { formatDateDisplay, formatTimeOfDay, toAestDay } from '../date-utils'

// How old the Oura Cloud data is, as the app words it (#2861). One rule for both apps' screens:
// the Readiness and Sleep cards print a quiet "Oura · updated <time>" line only once the data is
// more than three hours old, and the Devices screen carries the permanent status.
//
// The times come from the server's `GET /api/oura/connection` (`lastDataAt`: when Oura data last
// landed; `lastWebhookAt`: when its last verified event arrived), so they are receipt times, not
// the times of the readings.

/** Older than this, the cards say when the data last updated. */
export const OURA_STALE_AFTER_MS = 3 * 60 * 60 * 1000

function instantMs(at: string | null | undefined): number | null {
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

/** "7:05 am", with the date in front when it was not today in `tz`: "24 Oct, 7:05 am". */
export function ouraClock(at: string, now: number, tz: string): string {
  const time = formatTimeOfDay(at, tz)
  const ms = instantMs(at)
  if (!time || ms === null) return ''
  const day = toAestDay(new Date(ms), tz)
  return day === toAestDay(new Date(now), tz) ? time : `${formatDateDisplay(day, 'short')}, ${time}`
}

/**
 * The line under a Readiness or Sleep card: "Oura · updated 7:05 am", or null while the data is
 * fresh, when it has never arrived (nothing to date), or when the time cannot be read. A time in
 * the future (clock skew) counts as fresh.
 */
export function ouraStaleLine(lastDataAt: string | null | undefined, now: number, tz: string): string | null {
  const ms = instantMs(lastDataAt)
  if (ms === null || now - ms <= OURA_STALE_AFTER_MS) return null
  const clock = ouraClock(lastDataAt!, now, tz)
  return clock ? `Oura · updated ${clock}` : null
}

/** The Devices status line: "Last data received 7:05 am · last webhook 7:03 am". */
export function ouraFeedStatus(
  feed: { lastDataAt?: string | null; lastWebhookAt?: string | null },
  now: number,
  tz: string,
): string {
  const part = (label: string, none: string, at: string | null | undefined) => {
    const clock = at ? ouraClock(at, now, tz) : ''
    return clock ? `${label} ${clock}` : none
  }
  const data = part('Last data received', 'No data received yet', feed.lastDataAt)
  const hook = part('last webhook', 'no webhook yet', feed.lastWebhookAt)
  return `${data} · ${hook}`
}
