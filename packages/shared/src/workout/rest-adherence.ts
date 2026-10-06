import type { ExerciseLog } from '@trainingai/shared/types/log'

export interface RestAdherenceSet {
  actualRestSec: number | null | undefined     // set_logs.rest_time_sec
  prescribedRestSec: number | null | undefined // see `restAdherenceSets` for where this comes from
}

// Mean of actual/prescribed rest across sets where both are known, as a percentage.
// 100 = perfectly on prescription; <100 = rushing rests; >100 = resting long.
// Each ratio is capped at 3× so a forgotten timer doesn't swamp the session mean.
const MAX_RATIO = 3

export function restAdherencePct(sets: RestAdherenceSet[]): number | null {
  const ratios = sets
    .filter(s => s.actualRestSec != null && s.prescribedRestSec != null && s.prescribedRestSec > 0)
    .map(s => Math.min(s.actualRestSec! / s.prescribedRestSec!, MAX_RATIO))
  if (ratios.length === 0) return null
  return Math.round((ratios.reduce((a, r) => a + r, 0) / ratios.length) * 100)
}

/**
 * Each set graded against the plan of ITS day: `set_logs.planned_rest_sec`, the snapshot taken when
 * the set was logged, and the live progression style only where a set carries no snapshot at all.
 *
 * Grading every past set against today's style let a style edit rewrite history: measured in
 * production 2026-09-09, 231 of 442 snapshotted sets in a 90-day window disagreed with the live
 * style, and 14 of 36 sessions changed bucket on the rest-discipline bars (#2181). The fallback is
 * load-bearing — only 442 of the window's 841 sets carried both the snapshot and a rest time — so it
 * cannot be dropped.
 *
 * A logged 0 is a snapshot ("no rest planned"), not an absence, so it never falls back to the style.
 * `restAdherencePct` then leaves that set out, as it does any non-positive prescription.
 */
export function restAdherenceSets(
  exercises: Pick<ExerciseLog, 'styleId' | 'sets'>[],
  restSecByStyleSet: Map<string, number>,
): RestAdherenceSet[] {
  return exercises.flatMap(ex => ex.sets.map(set => ({
    actualRestSec: set.restTimeSec ?? null,
    prescribedRestSec: set.plannedRestSec
      ?? (ex.styleId ? restSecByStyleSet.get(`${ex.styleId}:${set.setNumber}`) ?? null : null),
  })))
}
