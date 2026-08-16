export interface RestAdherenceSet {
  actualRestSec: number | null | undefined     // set_logs.rest_time_sec
  prescribedRestSec: number | null | undefined // style_sets.rest_sec for the same set number
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
