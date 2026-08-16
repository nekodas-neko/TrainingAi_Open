import type { ExerciseSummary } from '@/app/api/weights-summary/route'
import { displayOneRm, displayOneRmDelta, oneRmUnit, type OneRmUnit } from '@trainingai/shared/1rm'

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

function trendColor(trend: 'up' | 'down' | 'same' | null, pct: number): string {
  if (pct >= 99.5) return GOLD
  if (trend === 'up') return GREEN
  if (trend === 'down') return RED
  return PURPLE
}

// The change is computed in DISPLAY units — reps for a bodyweight exercise, kilograms otherwise.
// A bodyweight 1RM is BW_REF-relative, so a kg delta on it is a number with no physical meaning
// (audit finding Q-12).
function computeTrend(ex: ExerciseSummary): { trend: 'up' | 'down' | 'same' | null; delta: number | null } {
  const current = ex.estimated1rm
  if (current == null) return { trend: null, delta: null }
  const d = displayOneRmDelta(current, ex.previousEstimated1rm, ex.exerciseType)
  if (d == null) return { trend: null, delta: null }
  const diff = Math.round(d.value * 10) / 10
  if (diff > 0) return { trend: 'up', delta: diff }
  if (diff < 0) return { trend: 'down', delta: Math.abs(diff) }
  return { trend: 'same', delta: 0 }
}

export function computeBarMetric(ex: ExerciseSummary, mode: StrengthMode): BarMetric | null {
  const { trend, delta } = computeTrend(ex)
  const deltaUnit = oneRmUnit(ex.exerciseType)

  // The best (all-time) 1RM — guard the stored PR against the latest estimate. Since
  // 1RM estimation switched from MAX-of-sets to AVERAGE-of-sets, older PRs in
  // personal_records can sit *above* every new averaged estimate (stranding the bar
  // below 100%), while a fresh best can sit *above* a stale PR. Taking the max of both
  // keeps the bar denominator commensurable. Both views show this best 1RM as the
  // end label; they differ only in what the bar fill represents.
  const max1rm = Math.max(ex.personalRecord1rm ?? 0, ex.estimated1rm ?? 0)

  // "1RM" view — end label = best 1RM; bar fill = the latest (current) 1RM toward it.
  // The bar PERCENTAGE stays on the stored values: they share one basis, so the ratio is right
  // either way, and taking it from the rounded rep counts would quantise the fill to whole reps.
  if (mode === 'latest') {
    if (ex.estimated1rm == null) return null
    const pct = max1rm > 0 ? Math.min((ex.estimated1rm / max1rm) * 100, 100) : 100
    const label = displayOneRm(max1rm > 0 ? max1rm : ex.estimated1rm, ex.exerciseType).text
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
