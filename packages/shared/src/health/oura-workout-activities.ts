/**
 * A source's own activity sessions as energy-budget activities (#3087; generic since #3875, read
 * as `SourceActivitySession`, so the file keeps its Oura-era name only).
 *
 * Since #2859 the Oura Cloud ingest writes `oura_workouts` again, but the budget read only strength
 * sessions, `activity_logs` and the day's steps, so a ride or swim Oura recorded earned nothing
 * unless it was logged again by hand. This turns those rows into the same activity entries
 * `computeActiveEnergy` already costs, minus everything already counted:
 *
 * - **A workout that overlaps a saved activity log or a strength session is skipped.** The old Oura
 *   review card (removed in Q-231) saved them as activity logs, and lifting is costed from the app's
 *   own session; counting the Oura copy as well would pay the same minutes twice.
 * - **A workout the owner reviewed without logging is skipped.** That card marked a row reviewed
 *   on save AND on dismiss, so reviewed-but-not-logged is a dismissal: the owner said it was not a
 *   workout to count.
 * - **Walks, runs and hikes arrive as the app's own types** (the connector's vocabulary table, Oura's
 *   is `lib/oura/cloud/activity-sessions-map.ts`), so `pedometerStepsInside` takes their steps back
 *   out of the passive step term exactly as it does for a logged walk (#3082) — the source's daily
 *   step count already holds them.
 * - **Any other activity keeps the source's name** (`unmappedActivity`, in the generic vocabulary)
 *   and is costed at that activity's own MET; one the MET table does not name earns nothing rather
 *   than the generic fallback.
 *
 * Each workout lands on the user's local day of its start, the same day key everything else uses.
 */
import { localClockTimeToDate, shiftDateStr, toAestDay } from '../date-utils'
import type { SourceActivitySession } from './activity-sessions'

export interface SourceBudgetActivity {
  date: string
  activityType: string
  durationMin: number
  distanceKm: number | null
  unmappedActivity?: string
}

/** What is already counted: the day's logged activities and strength sessions. */
export interface CountedMovement {
  activityLogs: readonly { date: string; startTime?: string | null; endTime?: string | null; durationMin?: number | null }[]
  sessions: readonly { startedAt: Date; completedAt?: Date | null }[]
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** The instants each logged activity and completed strength session covers, as `[startMs, endMs]`.
 *  A log with no usable clock time has none. */
export function movementWindows(counted: CountedMovement, tz: string): [number, number][] {
  const windows: [number, number][] = []
  for (const a of counted.activityLogs) {
    // Stored as HH:MM:SS (Postgres time); the parser takes HH:MM.
    const start = localClockTimeToDate(a.date, a.startTime?.slice(0, 5), tz)
    if (!start) continue
    let end = localClockTimeToDate(a.date, a.endTime?.slice(0, 5), tz)
      ?? (a.durationMin != null ? new Date(start.getTime() + a.durationMin * 60_000) : null)
    // A log that crosses midnight (23:30–00:30) stores an end clock time before its start: it ended
    // the next day. Dropping it from the check would let the Oura copy of that walk count twice.
    if (end && end <= start) {
      end = a.durationMin != null && a.durationMin > 0
        ? new Date(start.getTime() + a.durationMin * 60_000)
        // The same clock time on the next calendar day, not 24 h on: a daylight-saving day is 23 or 25 h.
        : localClockTimeToDate(shiftDateStr(a.date, 1), a.endTime?.slice(0, 5), tz)
    }
    if (end && end > start) windows.push([start.getTime(), end.getTime()])
  }
  for (const s of counted.sessions) {
    if (s.completedAt) windows.push([s.startedAt.getTime(), s.completedAt.getTime()])
  }
  return windows
}

export function sourceSessionActivities(
  workouts: readonly SourceActivitySession[],
  counted: CountedMovement,
  tz: string,
): SourceBudgetActivity[] {
  const windows = movementWindows(counted, tz)
  const out: SourceBudgetActivity[] = []
  for (const w of workouts) {
    const start = w.start.getTime()
    const end = w.end.getTime()
    if (!(end > start)) continue
    const logged = windows.some(([s, e]) => overlaps(start, end, s, e))
    if (logged || w.dismissed) continue
    out.push({
      date: toAestDay(w.start, tz),
      activityType: w.activityType,
      durationMin: (end - start) / 60_000,
      distanceKm: w.distanceKm,
      ...(w.unmappedActivity != null ? { unmappedActivity: w.unmappedActivity } : {}),
    })
  }
  return out
}
