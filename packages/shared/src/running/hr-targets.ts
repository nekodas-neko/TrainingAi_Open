import { computeHrZones, type HrZone } from '@trainingai/shared/health/hr-zones'
import type { FitnessSnapshot, RunTargets, RunType } from './types'

// Which HR zones each run type targets (polarized model: easy work sits in 1-2,
// quality work in 4-5). Bands are read off the canonical Karvonen zones so there is
// no second HR-zone formula anywhere.
const ZONES_BY_TYPE: Record<RunType, HrZone['id'][]> = {
  recovery: [1],
  easy: [1, 2],
  long: [1, 2],
  tempo: [3, 4],
  interval: [4, 5],
}

export function targetsForRunType(type: RunType, fitness: FitnessSnapshot): RunTargets {
  const zones = computeHrZones({ maxHr: fitness.maxHr, restingHr: fitness.restingHr })
  const ids = ZONES_BY_TYPE[type]
  const first = zones.find((z) => z.id === ids[0])!
  const last = zones.find((z) => z.id === ids[ids.length - 1])!
  const hrLowBpm = first.minBpm
  // Upper bound = the top targeted zone's upper edge; the top zone's maxBpm is Infinity,
  // so cap it at the profile's maxHr instead.
  const hrHighBpm = Number.isFinite(last.maxBpm) ? last.maxBpm : fitness.maxHr
  return { zoneIds: ids, hrLowBpm, hrHighBpm }
}
