import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'
import type { HrZone } from '@trainingai/shared/health/hr-zones'
import type { RunType } from './types'

// Which HR zones each run type predominantly spends time in — mirrors ZONES_BY_TYPE in
// hr-targets.ts (kept separate: that one drives the actual HR band, this one is a coarse
// "which zones does this type tend to fill" model for the recommendation, not a target).
const ZONES_BY_TYPE: Record<RunType, readonly HrZone['id'][]> = {
  recovery: [1],
  easy: [1, 2],
  long: [1, 2],
  tempo: [3, 4],
  interval: [4, 5],
}

const ZONE_LABEL: Record<number, string> = { 2: 'Zone 2', 3: 'Zone 3', 4: 'Zone 4', 5: 'Zone 5' }

export interface RunTypeRecommendation {
  type: RunType
  reason: string
}

/** Deterministically recommends whichever run type would put the most time toward the
 *  week's biggest OPEN zone gap (Z2-5; Z1 is passive daily-movement fill, spec D-10, and
 *  never drives a recommendation). No LLM number gates this — pure math over the same
 *  ZoneQuota the Cardiovascular hub already shows. Returns null once every training zone
 *  is already complete or has no target (nothing left to recommend toward). */
export function recommendRunType(quota: ZoneQuota): RunTypeRecommendation | null {
  const remainingByZone = new Map(
    quota.zones.filter((z) => z.zoneId !== 1 && z.status === 'open').map((z) => [z.zoneId, z.remainingMin]),
  )
  if (remainingByZone.size === 0) return null

  let best: { type: RunType; score: number } | null = null
  for (const [type, zoneIds] of Object.entries(ZONES_BY_TYPE) as [RunType, readonly HrZone['id'][]][]) {
    const score = zoneIds.reduce((s, z) => s + (remainingByZone.get(z) ?? 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { type, score }
  }
  if (!best) return null

  // The single zone within the winning type's set that's contributing the most open minutes,
  // for a concrete one-line reason rather than a vague "helps your zones" claim.
  const primaryZone = ZONES_BY_TYPE[best.type]
    .filter((z) => remainingByZone.has(z))
    .reduce((a, b) => ((remainingByZone.get(b) ?? 0) > (remainingByZone.get(a) ?? 0) ? b : a))

  return {
    type: best.type,
    reason: `${Math.round(remainingByZone.get(primaryZone) ?? 0)} min of ${ZONE_LABEL[primaryZone]} still open this week`,
  }
}
