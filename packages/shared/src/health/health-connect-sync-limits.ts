// The Health Connect sync's limits, record shapes and day checks that both the phone and the
// server use (#3729).
//
// The phone-side sync (`lib/health-connect-sync.ts`, `lib/health-connect-history-import.ts`) is a
// Capacitor module. `/api/sync-health`, `/api/health-connect/history-import` and
// `lib/health/health-connect-workouts.ts` used to import these from there, which tied the server to
// the web client being retired. The two client modules re-export everything here, so their
// callers are unchanged.
import { dateStrMidnightInTz, isCalendarDate, normalizeDateParamIso, shiftDateStr } from '@trainingai/shared/date-utils'

/** Days an ordinary sync reads on first install. */
export const SYNC_DAYS_COLD = 30;  // days on first install

/** One request's share of the heart-rate series. `/api/sync-health` imports it as its own cap. */
export const HR_UPLOAD_CHUNK = 10_000

export type ActivityIntervalKind = 'steps' | 'active_kcal' | 'cadence_spm'

/** One row for `/api/sync-health`'s `activityIntervals`. `recordId` is Health Connect's own record
 *  id (`metadata.id`), which the server keys on so a re-read window is idempotent. */
export interface ActivityInterval {
  kind: ActivityIntervalKind
  startMs: number
  endMs: number
  value: number
  recordId: string
  /** The writing app's package (`metadata.dataOrigin`). */
  origin?: string
  /** `metadata.device.type` as the plugin spells it, e.g. TYPE_WATCH. */
  device?: string
}

/** One request's share of the interval rows. ~170 bytes a row as JSON, so a chunk is ~700 KB, under
 *  the route's 1 MB body cap. `/api/sync-health` imports it as its own array cap. */
export const INTERVAL_UPLOAD_CHUNK = 4_000

/** Days one window covers - one "call" of the spec. */
export const HISTORY_WINDOW_DAYS = 30
/** The furthest back an import goes. Ten years is past any Health Connect store; the bound keeps a
 *  store that answers every window with a sliver of data from walking back forever. */
export const HISTORY_MAX_DAYS = 3650

/** The furthest-back day an import will request, and the oldest a client may claim to have reached. */
export function historyFloor(today: string): string {
  return shiftDateStr(today, -HISTORY_MAX_DAYS)
}

/** Why a client-claimed import day is not usable, or null. Shared by the progress route and the sync
 *  route's `historyFrom`, so the two cannot disagree about how far back is plausible. */
export function historyDayRejection(input: string, today: string): string | null {
  // Both separators, as every date param is (the client's localDateString() emits slashes).
  const date = normalizeDateParamIso(input)
  if (date === null || !isCalendarDate(date)) return `not a real calendar date: "${input.slice(0, 20)}"`
  if (date > today) return `dated after today (${today})`
  if (date < historyFloor(today)) return `older than ${HISTORY_MAX_DAYS} days`
  return null
}

/** The instant before which `/api/sync-health` would drop a heart-rate or interval row as stale,
 *  pushed back to cover an import's window (plus a day of slack, as the ordinary bound has). */
export function importPastToleranceStartMs(historyFrom: string, tz: string): number {
  return dateStrMidnightInTz(shiftDateStr(normalizeDateParamIso(historyFrom) ?? historyFrom, -1), tz).getTime()
}
