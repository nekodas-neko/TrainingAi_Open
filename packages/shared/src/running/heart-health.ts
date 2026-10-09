import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr } from '../date-utils'
import { moderateIntensityBpm } from '../health/hr-zones'
import { DEFAULT_MAX_GAP_SEC, type HrReading } from '../health/zone-minutes'

/**
 * Issue 2093. The day's prescription is a heart-health activity, and this file is the ONE place
 * that decides whether a day did it.
 *
 * The owner's rule (2026-10-05): ANY activity can count, but only its minutes at moderate effort or
 * above go toward the prescription. A brisk treadmill walk counts for its brisk stretches; a run
 * counts only for the minutes it actually spent at that effort. How the activity was started (from
 * the prescription or not) no longer matters — the measured minutes decide.
 *
 * The floor (owner, 2026-10-09, issue 2746) is the moderate-effort line, `MODERATE_INTENSITY_FRAC`
 * (40% of heart-rate reserve) via `moderateIntensityBpm` — the same line WHO active minutes use
 * (TN-78). It was zone 2 (60% of reserve) until then, which no treadmill walk of the owner's ever
 * reached. There is no second copy of the floor: this file reads it from `hr-zones.ts`.
 *
 * Every reader goes through here: the running-plan route that paints the card and the week's
 * history, the client hook that marks today done, and the admin back-fill that re-scores past
 * days. Two copies of this rule would be two answers to "did I do it today?".
 */

/** The bpm at which a minute starts to count: moderate effort, 40% of reserve (issue 2746). */
export function heartHealthFloorBpm(profile: { maxHr: number; restingHr: number }): number {
  return moderateIntensityBpm(profile)
}

/** Whole minutes at or above `floorBpm` across a heart-rate series. Counted minute by minute, so a
 *  walk earns its brisk stretches and not its slow ones. Each interval belongs to its EARLIER
 *  reading and is capped at `maxGapSec`, the same accounting as `accumulateZoneSeconds`, so a gap
 *  in the data never inflates the count. A reading exactly at the floor counts. */
export function heartHealthMinutes(
  readings: readonly HrReading[],
  floorBpm: number,
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): number {
  let sec = 0
  for (let i = 0; i + 1 < readings.length; i++) {
    const dt = Math.min((readings[i + 1].timestamp - readings[i].timestamp) / 1000, maxGapSec)
    if (dt > 0 && readings[i].bpm >= floorBpm) sec += dt
  }
  return Math.round(sec / 60)
}

/** One logged activity as the rule sees it. `effortMin` (minutes at moderate effort or above) is null when nothing measured a heart
 *  rate across the activity (no ring or strap data, or no start time to place it): unknown, which
 *  counts nothing, and is never shown as zero. */
export interface HeartHealthActivity {
  id: string
  title: string
  activityType: string
  durationMin: number | null
  effortMin: number | null
}

export interface HeartHealthVerdict {
  /** The prescription's minutes, or null when it states none (nothing to meet). */
  targetMin: number | null
  /** Minutes at moderate effort or above across every activity on the day. */
  countedMin: number
  met: boolean
  /** The activity credited with the day: the one with the most counted minutes. Null when no
   *  activity has any. Its id is what a completion links as `activityLogId`. */
  credited: HeartHealthActivity | null
}

export function heartHealthVerdict(
  targetMin: number | null,
  activities: readonly HeartHealthActivity[],
): HeartHealthVerdict {
  const target = targetMin != null && targetMin > 0 ? Math.round(targetMin) : null
  let countedMin = 0
  let credited: HeartHealthActivity | null = null
  for (const a of activities) {
    const z = a.effortMin ?? 0
    countedMin += z
    if (z <= 0) continue
    if (
      credited == null
      || z > (credited.effortMin ?? 0)
      || (z === (credited.effortMin ?? 0) && (a.durationMin ?? 0) > (credited.durationMin ?? 0))
    ) credited = a
  }
  return { targetMin: target, countedMin, met: target != null && countedMin >= target, credited }
}

/** How the history row reads a day. `today` is still moving; `nothing-logged` had no activity. */
export type HeartHealthDayOutcome = 'counted' | 'not-counted' | 'nothing-logged' | 'today'

/** A row already recorded as completed reads as counted even when its minutes fall short: a
 *  completion is never taken back (see `heartHealthRescore`), so the history must not contradict
 *  the card that says Done. */
export function heartHealthDayOutcome(
  verdict: HeartHealthVerdict,
  activityCount: number,
  isToday: boolean,
  status: string,
): HeartHealthDayOutcome {
  if (verdict.met || status === 'completed') return 'counted'
  if (isToday) return 'today'
  return activityCount === 0 ? 'nothing-logged' : 'not-counted'
}

/**
 * What a re-score does to a stored prescription row. Only a `pending` row whose day met the rule
 * moves, to `completed`. A completion the user already made is never taken back, and a row they
 * skipped stays skipped: re-scoring adds days that were done, it does not overrule a choice.
 */
export type HeartHealthRescore =
  | { action: 'complete'; activityLogId: string; completedAs: 'run' | 'walk' }
  | { action: 'none' }

export function heartHealthRescore(
  row: { status: string },
  verdict: HeartHealthVerdict,
): HeartHealthRescore {
  if (row.status !== 'pending' || !verdict.met || verdict.credited == null) return { action: 'none' }
  return {
    action: 'complete',
    activityLogId: verdict.credited.id,
    completedAs: completedAsForActivity(verdict.credited.activityType),
  }
}

/**
 * What an activity type satisfied the prescription as, for `completedAsRun()` (LB-179): only a run
 * is a run. `'walk'` means "not a run" — a treadmill session, a ride or anything else stores it too,
 * so the planner never reads a non-run as a run of the prescribed type.
 */
export function completedAsForActivity(activityType: string | null): 'run' | 'walk' {
  return activityType === 'run' ? 'run' : 'walk'
}

/**
 * The instant window an activity log covers, from its local date and "HH:MM[:SS]" clock times.
 * Null without a start time: a log with only a duration cannot be placed against the heart-rate
 * series, so its minutes are unknown rather than guessed. An end before the start crossed
 * midnight.
 */
export function activityLogWindow(
  log: { date: string; startTime?: string | null; endTime?: string | null; durationMin?: number | null },
  tz: string,
): { from: Date; to: Date } | null {
  if (!log.startTime) return null
  const from = fromZonedTime(`${log.date}T${log.startTime.slice(0, 5)}:00`, tz)
  if (!Number.isFinite(from.getTime())) return null
  let to: Date | null = null
  if (log.endTime) {
    const hhmm = log.endTime.slice(0, 5)
    let end = fromZonedTime(`${log.date}T${hhmm}:00`, tz)
    // The next local day's clock time, not +24 h: a DST night is not 24 hours long.
    if (end.getTime() <= from.getTime()) end = fromZonedTime(`${shiftDateStr(log.date, 1)}T${hhmm}:00`, tz)
    if (Number.isFinite(end.getTime())) to = end
  }
  if (to == null && log.durationMin != null && log.durationMin > 0) {
    to = new Date(from.getTime() + log.durationMin * 60_000)
  }
  return to != null && to.getTime() > from.getTime() ? { from, to } : null
}
