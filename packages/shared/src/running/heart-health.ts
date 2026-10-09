import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr } from '../date-utils'

/**
 * Issue 2093. The day's prescription is a heart-health activity, and this file is the ONE place
 * that decides whether a day did it.
 *
 * The owner's rule (2026-10-05): ANY activity can count, but only its minutes in zone 2 or above go
 * toward the prescription. A brisk treadmill walk counts; a slow stroll does not yet; a run counts
 * only for the minutes it actually spent at that effort. How the activity was started (from the
 * prescription or not) no longer matters — the measured minutes decide.
 *
 * Every reader goes through here: the running-plan route that paints the card and the week's
 * history, the client hook that marks today done, and the admin back-fill that re-scores past
 * days. Two copies of this rule would be two answers to "did I do it today?".
 */

/** The lowest zone (of `hr-zones.ts`'s five) whose minutes count. Zone 1 fills from ordinary
 *  movement, the same reason `zone-quota.ts` keeps it out of the training totals. */
export const HEART_HEALTH_FLOOR_ZONE = 2

/** Whole minutes at or above the floor zone, from `accumulateZoneSeconds`'s five-slot result
 *  (index 0 = zone 1). */
export function zone2PlusMinutes(zoneSeconds: readonly number[]): number {
  let sec = 0
  for (let i = HEART_HEALTH_FLOOR_ZONE - 1; i < 5; i++) sec += zoneSeconds[i] ?? 0
  return Math.round(sec / 60)
}

/** One logged activity as the rule sees it. `zone2PlusMin` is null when nothing measured a heart
 *  rate across the activity (no ring or strap data, or no start time to place it): unknown, which
 *  counts nothing, and is never shown as zero. */
export interface HeartHealthActivity {
  id: string
  title: string
  activityType: string
  durationMin: number | null
  zone2PlusMin: number | null
}

export interface HeartHealthVerdict {
  /** The prescription's minutes, or null when it states none (nothing to meet). */
  targetMin: number | null
  /** Zone 2+ minutes across every activity on the day. */
  countedMin: number
  met: boolean
  /** The activity credited with the day: the one with the most zone 2+ minutes. Null when no
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
    const z = a.zone2PlusMin ?? 0
    countedMin += z
    if (z <= 0) continue
    if (
      credited == null
      || z > (credited.zone2PlusMin ?? 0)
      || (z === (credited.zone2PlusMin ?? 0) && (a.durationMin ?? 0) > (credited.durationMin ?? 0))
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
 * series, so its zone minutes are unknown rather than guessed. An end before the start crossed
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
