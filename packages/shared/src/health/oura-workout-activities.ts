/**
 * Oura's own workouts as energy-budget activities (#3087).
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
 * - **Walks, runs and hikes map to the app's own types**, so `pedometerStepsInside` takes their steps
 *   back out of the passive step term exactly as it does for a logged walk (#3082) — Oura's daily
 *   step count already holds them.
 * - **Any other activity keeps its Oura name** (`ouraActivity`) and is costed at that activity's own
 *   MET; one the MET table does not name earns nothing rather than the generic fallback.
 *
 * Each workout lands on the user's local day of its start, the same day key everything else uses.
 */
import { localClockTimeToDate, toAestDay } from '../date-utils'

/** Oura activity → the app's own activity type, where the app has one. */
const OURA_TO_APP_TYPE: Record<string, string> = {
  walking: 'walk', running: 'run', hiking: 'hike', cycling: 'cycle', swimming: 'swim', rowing: 'row',
  elliptical: 'elliptical', hiit: 'hiit', yoga: 'yoga', stretching: 'stretch', strengthTraining: 'strength',
}

export interface OuraWorkoutRow {
  activity: string
  startDatetime: Date
  endDatetime: Date
  distanceM: number | null
  reviewed: boolean
}

export interface OuraBudgetActivity {
  date: string
  activityType: string
  durationMin: number
  distanceKm: number | null
  ouraActivity?: string
}

/** What is already counted: the day's logged activities and strength sessions. */
export interface CountedMovement {
  activityLogs: readonly { date: string; startTime?: string | null; endTime?: string | null; durationMin?: number | null }[]
  sessions: readonly { startedAt: Date; completedAt?: Date | null }[]
}

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

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
        : new Date(end.getTime() + 86_400_000)
    }
    if (end && end > start) windows.push([start.getTime(), end.getTime()])
  }
  for (const s of counted.sessions) {
    if (s.completedAt) windows.push([s.startedAt.getTime(), s.completedAt.getTime()])
  }
  return windows
}

export function ouraWorkoutActivities(
  workouts: readonly OuraWorkoutRow[],
  counted: CountedMovement,
  tz: string,
): OuraBudgetActivity[] {
  const windows = movementWindows(counted, tz)

  const out: OuraBudgetActivity[] = []
  for (const w of workouts) {
    const start = w.startDatetime.getTime()
    const end = w.endDatetime.getTime()
    if (!(end > start)) continue
    const logged = windows.some(([s, e]) => overlaps(start, end, s, e))
    if (logged || w.reviewed) continue
    const appType = OURA_TO_APP_TYPE[w.activity]
    out.push({
      date: toAestDay(w.startDatetime, tz),
      activityType: appType ?? w.activity,
      durationMin: (end - start) / 60_000,
      distanceKm: w.distanceM != null && w.distanceM > 0 ? w.distanceM / 1000 : null,
      ...(appType ? {} : { ouraActivity: w.activity }),
    })
  }
  return out
}
