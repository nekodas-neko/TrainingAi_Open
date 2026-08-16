import { formatInTimeZone } from 'date-fns-tz'
import { getLocalStore } from '@/lib/local-store'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

/** The shape `/api/calendar-data` returns: `YYYY/MM/DD` → the names/types on that day. */
export interface CalendarData {
  trainedDays: Record<string, string[]>
  activityDays: Record<string, string[]>
}

/** An empty overlay — what web and a cold local store both produce. */
export const EMPTY_OVERLAY: CalendarData = { trainedDays: {}, activityDays: {} }

/**
 * Merge an overlay of local-only days onto the server's calendar payload.
 *
 * Additive by construction: a day the server already knows about keeps its entries and gains only
 * names it was missing. This is deliberately *not* a client-side re-implementation of
 * `getCalendarData` — the calendar is a cross-domain server-assembled aggregate, and reproducing
 * its assembly on the client is the duplication the `home-day-timeline` exception exists to avoid
 * (session 287). The overlay carries only rows the server cannot know about yet.
 */
export function mergeCalendarOverlay(server: CalendarData | null, overlay: CalendarData): CalendarData {
  const merge = (a: Record<string, string[]>, b: Record<string, string[]>) => {
    const out: Record<string, string[]> = {}
    for (const [day, names] of Object.entries(a)) out[day] = [...names]
    for (const [day, names] of Object.entries(b)) {
      const existing = out[day] ?? (out[day] = [])
      for (const n of names) if (!existing.includes(n)) existing.push(n)
    }
    return out
  }
  const base = server ?? EMPTY_OVERLAY
  return {
    trainedDays: merge(base.trainedDays, overlay.trainedDays),
    activityDays: merge(base.activityDays, overlay.activityDays),
  }
}

/** `YYYY-MM-DD` → the `YYYY/MM/DD` keys the calendar payload uses. */
function toDayKey(date: string): string {
  return date.slice(0, 10).replace(/-/g, '/')
}

/**
 * Local rows for one month that the server does not have yet.
 *
 * **Only `sync_status = 'pending'` rows are read.** Anything already synced is in the server payload
 * by definition, so including it would be duplicate work for no visible difference — and it is what
 * bounds the per-workout `getExerciseLogs` lookup below to the handful of rows actually waiting.
 *
 * Returns an empty overlay when there is no local store (the web sandbox, where `getLocalStore`
 * returns null) so the calendar behaves exactly as it did before on that path.
 */
export async function readLocalCalendarOverlay(
  userId: string | undefined,
  year: number,
  month: number,
  tz: string = DEFAULT_TZ,
): Promise<CalendarData> {
  const store = userId ? getLocalStore(userId) : null
  if (!store) return EMPTY_OVERLAY

  const monthPrefix = `${year}/${String(month).padStart(2, '0')}/`
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  // `workout_sessions.started_at` is a UTC instant, so a session belonging to the 1st of the month
  // in the user's timezone can carry a UTC date in the previous month. Widen the SQL cutoff by a
  // day and let the local-day key below decide what is actually in range.
  const workoutFrom = new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString()

  const trainedDays: Record<string, string[]> = {}
  const activityDays: Record<string, string[]> = {}

  try {
    for (const a of await store.getActivityLogs(from)) {
      // `activity_logs.date` is already a plain local `YYYY-MM-DD` — no conversion, same as the
      // server's own handling of this column.
      if (a.syncStatus !== 'pending') continue
      const key = toDayKey(a.date)
      if (!key.startsWith(monthPrefix)) continue
      const list = activityDays[key] ?? (activityDays[key] = [])
      if (!list.includes(a.activityType)) list.push(a.activityType)
    }

    for (const w of await store.getWorkoutSessions(workoutFrom)) {
      if (w.syncStatus !== 'pending') continue
      const key = formatInTimeZone(new Date(w.startedAt), tz, 'yyyy/MM/dd')
      if (!key.startsWith(monthPrefix)) continue
      // The server counts a day as trained only when the session has at least one logged exercise.
      // Matching that here keeps an abandoned in-progress session off the calendar. Bounded by the
      // pending count, which is a handful of rows at most.
      const logs = await store.getExerciseLogs(w.id)
      if (logs.length === 0) continue
      const list = trainedDays[key] ?? (trainedDays[key] = [])
      if (!list.includes(w.sessionName)) list.push(w.sessionName)
    }
  } catch {
    // A local-store read failure must never blank the calendar — the server payload still renders.
    return { trainedDays, activityDays }
  }

  return { trainedDays, activityDays }
}
