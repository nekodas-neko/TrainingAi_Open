/**
 * Issue 2093 (was RV-166). What the heart-health activity card says.
 *
 * Pure so the wording can be tested without the hub's live payload. The card renders this and
 * decides nothing: whether a day counted is decided once, by `heartHealthVerdict` in
 * `packages/shared/src/running/heart-health.ts`, on the server, and arrives on the payload.
 *
 * No word here names a run. The prescription is a heart-health activity that any activity can
 * complete through its minutes at moderate effort or above (owner, 2026-10-05; floor moved from
 * zone 2 to moderate effort, 40% of heart-rate reserve, on 2026-10-09, issue 2746).
 */
import type { HeartHealthActivity, HeartHealthDayOutcome } from '@trainingai/shared/running/heart-health'

export const CARD_TITLE = 'Heart-health activity'
export const ANY_ACTIVITY = 'Any activity counts'
export const RATIONALE = 'Aerobic time to build your base. A walk, a ride or anything else counts for its minutes at moderate effort or above.'
export const PROGRESS_LABEL = 'Moderate-effort minutes today'

/** "Zone 2" · "Zones 2–3" · "Zones 1, 3 and 4" — ranges only when the ids are contiguous. */
export function zoneLabel(zoneIds: number[]): string | null {
  const ids = [...new Set(zoneIds)].filter((z) => Number.isFinite(z)).sort((a, b) => a - b)
  if (ids.length === 0) return null
  if (ids.length === 1) return `Zone ${ids[0]}`
  const contiguous = ids.every((z, i) => i === 0 || z === ids[i - 1] + 1)
  if (contiguous) return `Zones ${ids[0]}–${ids[ids.length - 1]}`
  return `Zones ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/** "30 min at moderate effort or above", or the rule alone when the prescription states no minutes. */
export function criterionLine(targetMin: number | null): string {
  return targetMin != null && targetMin > 0 ? `${targetMin} min at moderate effort or above` : 'Time at moderate effort or above'
}

/** "22 of 30" — the progress figure beside the bar. */
export function progressFigure(countedMin: number, targetMin: number | null): string {
  return targetMin != null && targetMin > 0 ? `${countedMin} of ${targetMin}` : `${countedMin} min`
}

/** "Treadmill walk · 34 min" — what was actually done, never the prescription's name. */
export function activityLine(a: Pick<HeartHealthActivity, 'title' | 'durationMin'>): string {
  const mins = a.durationMin != null && a.durationMin > 0 ? ` · ${Math.round(a.durationMin)} min` : ''
  return `${a.title}${mins}`
}

/** The activity a day is shown by: the credited one, else the longest logged. */
export function shownActivity(
  activities: readonly HeartHealthActivity[],
  creditedId: string | null,
): HeartHealthActivity | null {
  const credited = creditedId != null ? activities.find((a) => a.id === creditedId) : undefined
  if (credited) return credited
  let best: HeartHealthActivity | null = null
  for (const a of activities) if (best == null || (a.durationMin ?? 0) > (best.durationMin ?? 0)) best = a
  return best
}

/** The small line under a history row: the measured minutes, or why there are none. */
export function countedMinutesLine(activities: readonly HeartHealthActivity[], countedMin: number): string {
  if (activities.length === 0) return ''
  const measured = activities.some((a) => a.effortMin != null)
  if (!measured) return 'No heart rate recorded'
  const across = activities.length > 1 ? ` across ${activities.length} activities` : ''
  return `${countedMin} min at moderate effort or above${across}`
}

export const OUTCOME_LABEL: Record<HeartHealthDayOutcome, string> = {
  counted: 'Counted ✓',
  'not-counted': "Didn't count",
  'nothing-logged': 'Nothing logged',
  today: 'Today',
}

export const OUTCOME_COLOR: Partial<Record<HeartHealthDayOutcome, string>> = {
  counted: 'var(--accent-green)',
  'not-counted': 'var(--accent-amber)',
}
