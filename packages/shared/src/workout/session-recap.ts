import type { WorkoutSession } from '@trainingai/shared/types/log'
import { restAdherencePct, type RestAdherenceSet } from './rest-adherence'
import { median } from './time-audit'

export interface RecapFacts {
  durationMin: number | null
  durationVsMedianPct: number | null
  totalVolumeKg: number
  prCount: number
  rpeDrift: number | null
  restAdherencePct: number | null
  sessionRpe: number | null
}

export interface BuildRecapFactsInput {
  session: WorkoutSession
  // Completed durations (minutes) of recent same-type sessions, excluding this one.
  recentDurationsMin: number[]
  // `${styleId}:${setNumber}` -> prescribed rest seconds.
  restSecByStyleSet: Map<string, number>
  prCount: number
}

// A median from only 1-2 other sessions is too noisy to call a trend.
const MIN_RECENT_FOR_MEDIAN = 3

export function buildRecapFacts({ session, recentDurationsMin, restSecByStyleSet, prCount }: BuildRecapFactsInput): RecapFacts {
  const durationMin = session.completedAt
    ? Math.round((session.completedAt.getTime() - session.startedAt.getTime()) / 60_000)
    : null

  let durationVsMedianPct: number | null = null
  if (durationMin != null && recentDurationsMin.length >= MIN_RECENT_FOR_MEDIAN) {
    const med = median(recentDurationsMin)
    durationVsMedianPct = med != null && med > 0 ? Math.round(((durationMin - med) / med) * 100) : null
  }

  const totalVolumeKg = Math.round(
    session.exercises.reduce(
      (sum, ex) => sum + (ex.volume ?? ex.sets.reduce((s, set) => s + set.weightKg * set.reps, 0)),
      0,
    ),
  )

  const rpeDeltas: number[] = []
  for (const ex of session.exercises) {
    const rated = ex.sets.filter(s => s.rpe != null).sort((a, b) => a.setNumber - b.setNumber)
    if (rated.length >= 2) {
      rpeDeltas.push(rated[rated.length - 1].rpe! - rated[0].rpe!)
    }
  }
  const rpeDrift = rpeDeltas.length > 0
    ? Math.round((rpeDeltas.reduce((a, d) => a + d, 0) / rpeDeltas.length) * 10) / 10
    : null

  const restSets: RestAdherenceSet[] = session.exercises.flatMap(ex =>
    ex.sets.map(set => ({
      actualRestSec: set.restTimeSec ?? null,
      prescribedRestSec: ex.styleId ? restSecByStyleSet.get(`${ex.styleId}:${set.setNumber}`) ?? null : null,
    })),
  )

  return {
    durationMin,
    durationVsMedianPct,
    totalVolumeKg,
    prCount,
    rpeDrift,
    restAdherencePct: restAdherencePct(restSets),
    sessionRpe: session.sessionRpe ?? null,
  }
}
