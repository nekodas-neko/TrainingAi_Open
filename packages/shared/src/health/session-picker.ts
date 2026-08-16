import type { ZoneQuota } from './zone-quota'
import type { HrZone } from './hr-zones'

// Recommends which cardio modality to open for a given time budget, combining the running
// program's own gate/prescription (read from its public API — never recomputed here, per
// spec D-1: the hub reads running's output, it doesn't reimplement recovery-gate.ts) with the
// hub's zone quota. A suggestion only — every modality stays choosable regardless of the
// result (spec D-9).
//
// SCOPE NOTE: the gate reason only ever attaches to 'run'. applyRecoveryGate() branches on a
// running Prescription's type (hard vs easy), so it has no walk/activity equivalent today —
// extending it to a modality-agnostic "should I push cardio" signal is a bigger, undesigned
// question left for a future item, not assembled here.

export type SessionModality = 'run' | 'walk' | 'activity'

export interface RunningPlanForRecommend {
  hasPlan: boolean
  runPending: boolean
  prescriptionDurationMin: number | null
  prescriptionType: string | null
  gateAction: 'proceed' | 'soften' | 'rest' | null
  gateReasons: string[]
}

export interface SessionRecommendation {
  modality: SessionModality
  reason: string
  /** Only set when modality is 'run' and the gate softened/rested it. */
  gate?: { action: 'soften' | 'rest'; reasons: string[] }
  /** Only set when modality is 'walk' — an estimate of minutes this walk would contribute to
   *  the named zone, never a promise (mirrors the "estimate" framing already used elsewhere). */
  estimateMin?: number
}

const RUN_FIT_SLACK_MIN = 5

/** Zone 1 fills passively (spec D-10) — never the zone a walk gets recommended to "close",
 *  same exclusion ZoneQuotaCard already applies to its training totals. */
const PASSIVE_ZONE_ID = 1

export function recommendSession(input: {
  minutesAvailable: number
  runningPlan: RunningPlanForRecommend
  quota: ZoneQuota
}): SessionRecommendation {
  const { minutesAvailable, runningPlan, quota } = input

  const runFits =
    runningPlan.hasPlan &&
    runningPlan.runPending &&
    runningPlan.prescriptionDurationMin != null &&
    minutesAvailable >= runningPlan.prescriptionDurationMin - RUN_FIT_SLACK_MIN

  if (runFits) {
    const rec: SessionRecommendation = {
      modality: 'run',
      reason: `Today's prescribed ${runningPlan.prescriptionType} run fits your time.`,
    }
    if (runningPlan.gateAction === 'soften' || runningPlan.gateAction === 'rest') {
      rec.gate = { action: runningPlan.gateAction, reasons: runningPlan.gateReasons }
    }
    return rec
  }

  const openZones = quota.zones.filter(
    (z) => z.zoneId !== PASSIVE_ZONE_ID && z.status === 'open' && z.remainingMin > 0,
  )
  if (openZones.length > 0) {
    const biggest = openZones.reduce((a, b) => (b.remainingMin > a.remainingMin ? b : a))
    const meta = ZONE_LABELS[biggest.zoneId]
    return {
      modality: 'walk',
      reason: `A walk would put a dent in your Z${biggest.zoneId} ${meta} minutes for the week.`,
      estimateMin: Math.min(minutesAvailable, biggest.remainingMin),
    }
  }

  return {
    modality: 'activity',
    reason: "You're on track this week — log whatever you feel like.",
  }
}

const ZONE_LABELS: Record<HrZone['id'], string> = {
  1: 'Recovery', 2: 'Light', 3: 'Aerobic', 4: 'Hard', 5: 'Peak',
}
