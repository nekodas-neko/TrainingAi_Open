import { displayOneRm, displayOneRmDelta, oneRmUnit, type OneRmUnit } from '@trainingai/shared/1rm'

export interface StrengthReading {
  estimated1rm: number | null
  previousEstimated1rm: number | null
  personalRecord1rm: number | null
  weight: number | null
  exerciseType: 'weighted' | 'bodyweight'
  lastReps: number | null
  maxReps: number | null
}

export type StrengthMode = 'latest' | 'working'

export interface BarMetric {
  pct: number
  label: string
  color: string
  trend: 'up' | 'down' | 'same' | null
  delta: number | null
  /** Unit `delta` is expressed in — reps for bodyweight, kilograms otherwise. */
  deltaUnit: OneRmUnit
}

const GOLD = '#fbbf24'
const PURPLE = '#bf5fff'
const GREEN = '#22c55e'
const RED = '#f87171'

/** The colour of a better / worse change beside a bar. `same` has no entry: it prints nothing. */
export const TREND_COLOR = { up: GREEN, down: RED } as const

/**
 * "+3 reps" for a bodyweight exercise, "-2.5 kg" for a loaded one; null when nothing changed or
 * there is no previous reading to change from. The unit follows `deltaUnit`, so a bodyweight 1RM
 * never reads as kilograms (Q-12).
 */
export function strengthDeltaText(metric: Pick<BarMetric, 'trend' | 'delta' | 'deltaUnit'>): string | null {
  if (metric.trend == null || metric.trend === 'same' || metric.delta == null) return null
  const sign = metric.trend === 'up' ? '+' : '-'
  const unit = metric.deltaUnit === 'RM' ? (metric.delta === 1 ? 'rep' : 'reps') : 'kg'
  return `${sign}${metric.delta} ${unit}`
}

function trendColor(trend: 'up' | 'down' | 'same' | null, pct: number): string {
  if (pct >= 99.5) return GOLD
  if (trend === 'up') return GREEN
  if (trend === 'down') return RED
  return PURPLE
}

// The change is computed in DISPLAY units — reps for a bodyweight exercise, kilograms otherwise.
// A bodyweight 1RM is BW_REF-relative, so a kg delta on it is a number with no physical meaning
// (audit finding Q-12).
/**
 * The exercise's current 1RM, or null when there isn't one (PS-26).
 *
 * `<= 0`, not just null: a deload stores `estimated_1rm = 0` deliberately, and reading that as a
 * value produced a 0% bar beside "−<the lifter's whole 1RM> kg". `/api/weights-summary` no longer
 * publishes the sentinel, so this is defence rather than the fix — but it has to be ONE predicate,
 * because guarding the delta and not the bar leaves the empty bar, which is the half that was
 * reported. No exercise has a meaningful 1RM of zero, weighted or bodyweight.
 */
function currentOneRm(ex: StrengthReading): number | null {
  return ex.estimated1rm != null && ex.estimated1rm > 0 ? ex.estimated1rm : null
}

function computeTrend(ex: StrengthReading): { trend: 'up' | 'down' | 'same' | null; delta: number | null } {
  const current = currentOneRm(ex)
  if (current == null) return { trend: null, delta: null }
  const d = displayOneRmDelta(current, ex.previousEstimated1rm, ex.exerciseType)
  if (d == null) return { trend: null, delta: null }
  const diff = Math.round(d.value * 10) / 10
  if (diff > 0) return { trend: 'up', delta: diff }
  if (diff < 0) return { trend: 'down', delta: Math.abs(diff) }
  return { trend: 'same', delta: 0 }
}

export function computeBarMetric(ex: StrengthReading, mode: StrengthMode): BarMetric | null {
  const { trend, delta } = computeTrend(ex)
  const deltaUnit = oneRmUnit(ex.exerciseType)

  // The best (all-time) 1RM — guard the stored PR against the latest estimate. Since
  // 1RM estimation switched from MAX-of-sets to AVERAGE-of-sets, older PRs in
  // personal_records can sit *above* every new averaged estimate (stranding the bar
  // below 100%), while a fresh best can sit *above* a stale PR. Taking the max of both
  // keeps the bar denominator commensurable. Both views show this best 1RM as the
  // end label; they differ only in what the bar fill represents.
  const current = currentOneRm(ex)
  const max1rm = Math.max(ex.personalRecord1rm ?? 0, current ?? 0)

  // "1RM" view — end label = best 1RM; bar fill = the latest (current) 1RM toward it.
  // The bar PERCENTAGE stays on the stored values: they share one basis, so the ratio is right
  // either way, and taking it from the rounded rep counts would quantise the fill to whole reps.
  if (mode === 'latest') {
    if (current == null) return null
    const pct = max1rm > 0 ? Math.min((current / max1rm) * 100, 100) : 100
    const label = displayOneRm(max1rm > 0 ? max1rm : current, ex.exerciseType).text
    return { pct, label, color: trendColor(trend, pct), trend, delta, deltaUnit }
  }

  // "Sets" view — end label = best 1RM; bar fill = the last working set lifted.
  if (ex.exerciseType === 'bodyweight') {
    if (ex.lastReps == null || ex.maxReps == null) return null
    const pct = ex.maxReps > 0 ? Math.min((ex.lastReps / ex.maxReps) * 100, 100) : 100
    return { pct, label: `${ex.maxReps} reps`, color: trendColor(trend, pct), trend, delta, deltaUnit }
  }

  if (ex.weight == null) return null
  const pct = max1rm > 0 ? Math.min((ex.weight / max1rm) * 100, 100) : 100
  const label = max1rm > 0 ? `${Math.round(max1rm)} kg` : `${ex.weight} kg`
  return { pct, label, color: trendColor(trend, pct), trend, delta, deltaUnit }
}

/**
 * Strength rows grouped by session in order of first appearance: only exercises with a 1RM, and a
 * session with no row left under `mode` is dropped rather than shown as a bare header. The web card
 * and the native Progress panel both group through this.
 */
export function strengthGroups<T extends StrengthReading & { sessionName: string }>(
  exercises: readonly T[],
  mode: StrengthMode,
): { session: string; rows: { exercise: T; metric: BarMetric }[] }[] {
  const groups = new Map<string, { exercise: T; metric: BarMetric }[]>()
  for (const exercise of exercises) {
    if (exercise.estimated1rm == null) continue
    const metric = computeBarMetric(exercise, mode)
    if (!metric) continue
    groups.set(exercise.sessionName, [...(groups.get(exercise.sessionName) ?? []), { exercise, metric }])
  }
  return [...groups].map(([session, rows]) => ({ session, rows }))
}
