import { pacesFromVdot } from '@trainingai/shared/health/vdot'
import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework } from '../types'

const KEY = 'density-progression'
// v1 growth is intentionally gentler than the other frameworks' WEEKLY_GROWTH (1.05-1.10) —
// holding pace/effort steady while distance grows in a FIXED duration is a harder ask on the
// body per week than simply running longer, so the density axis grows more conservatively.
const DENSITY_GROWTH = 1.03
const DEFAULT_SESSION_MIN = 30
// Used only when no VO2max estimate exists yet — a conservative recreational easy pace
// (10:43/mile), matching the "age-estimate" fallback tier fitness-snapshot.ts already uses
// for maxHr in the same no-baseline-data situation.
const FALLBACK_EASY_PACE_SEC_PER_KM = 400

function easyPaceSecPerKm(vo2max: number | null): number {
  if (vo2max == null) return FALLBACK_EASY_PACE_SEC_PER_KM
  return pacesFromVdot(vo2max).easySecPerKm
}

function nextRun(ctx: FrameworkContext): Prescription {
  const durationMin = ctx.goal.timePerSessionMinutes ?? DEFAULT_SESSION_MIN
  const paceSecPerKm = easyPaceSecPerKm(ctx.fitness.vo2max)
  const baseDistanceKm = (durationMin * 60) / paceSecPerKm
  const distanceKm = Math.round(baseDistanceKm * DENSITY_GROWTH ** ctx.weekIndex * 100) / 100

  return {
    type: 'easy',
    durationMin,
    distanceKm,
    targets: targetsForRunType('easy', ctx.fitness),
    rationale: `${durationMin} minutes, aiming to cover ${distanceKm.toFixed(2)} km — the same time as always, a little more ground each week. Stay conversational; this is about density, not pace.`,
    frameworkKey: KEY,
  }
}

export const densityProgressionFramework: RunFramework = {
  key: KEY,
  label: 'Density progression (fixed time)',
  nextRun,
}
