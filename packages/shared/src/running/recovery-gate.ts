import { ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'
import { targetsForRunType } from './hr-targets'
import type { FitnessSnapshot, Prescription, RunType } from './types'

export type GateAction = 'proceed' | 'soften' | 'rest'

export interface RecoveryGateInputs {
  readiness: number | null              // oura_daily_derived.readiness_score (0-100)
  readinessProvisional: boolean         // true while composite baseline still learning (n_history < 14)
  hoursSinceLowerBodyStrength: number | null  // most recent heavy lower-body strength session
  lastLowerBodyVolumeKg: number         // its volume load (0 if none / not heavy)
  monotony: number | null               // Foster training monotony (mean/SD of daily load) — portable
  acwr: number | null                   // computeVolumeAcwr
  hoursSinceLastHardRun: number | null  // since the most recent COMPLETED interval/tempo/long run
  sleepHoursLastNight: number | null
}

export interface RecoveryGateResult {
  action: GateAction
  reasons: string[]
  prescription: Prescription            // possibly-softened copy
}

// Thresholds — this module's calibration constants (deterministic, documented).
const HEAVY_LEG_VOLUME_KG = 3000        // a session above this counts as a "heavy" leg day
const LEG_INTERFERENCE_HOURS = 24       // hard running within 24h of heavy legs is downgraded
const READINESS_REST = 50               // below this → rest
const READINESS_SOFTEN = 65             // below this → soften
const SHORT_SLEEP_HOURS = 5.5
// Foster training monotony (mean/SD of the week's daily load). >2.0 is the documented "high
// monotony" band (Foster 1998) associated with elevated overtraining/illness risk — a portable,
// scale-free flag (raw strain = load×monotony is in kg and not comparable across users, so the
// gate reads monotony, not strain).
const HIGH_MONOTONY = 2.0
// A second hard run inside this window of the last completed quality session breaks 80/20 polarity.
const HARD_RUN_SPACING_HOURS = 24

const HARD: ReadonlySet<RunType> = new Set(['interval', 'tempo', 'long'])

// 0 = proceed, 1 = soften, 2 = rest. Tracked as a number (not the closure-mutated union)
// so TypeScript's flow analysis keeps the final `action` widened, not narrowed to a literal.
const PROCEED = 0
const SOFTEN = 1
const REST = 2
const ACTIONS: GateAction[] = ['proceed', 'soften', 'rest']

export function applyRecoveryGate(p: Prescription, i: RecoveryGateInputs): RecoveryGateResult {
  const reasons: string[] = []
  let level = PROCEED
  const escalate = (to: number) => { if (to > level) level = to }

  // Hard signals → rest.
  if (i.readiness != null && i.readiness < READINESS_REST) {
    escalate(REST); reasons.push(`Readiness is low (${i.readiness}/100) — an easy recovery day helps more than a hard run.`)
  }

  // Concurrent-training interference: hard run soon after a heavy lower-body session.
  if (
    HARD.has(p.type) &&
    i.hoursSinceLowerBodyStrength != null &&
    i.hoursSinceLowerBodyStrength < LEG_INTERFERENCE_HOURS &&
    i.lastLowerBodyVolumeKg >= HEAVY_LEG_VOLUME_KG
  ) {
    escalate(SOFTEN)
    reasons.push('You trained legs hard in the last day — running hard now blunts both adaptations (interference effect) and adds injury risk, so this is an easy run.')
  }

  if (i.readinessProvisional) {
    escalate(SOFTEN); reasons.push('Your readiness baseline is still learning (provisional) — keeping today easy until it is trustworthy.')
  } else if (i.readiness != null && i.readiness < READINESS_SOFTEN) {
    escalate(SOFTEN); reasons.push(`Readiness is a little down (${i.readiness}/100) — dialing today back.`)
  }
  if (i.acwr != null && i.acwr > ACWR_THRESHOLDS.optimalMax) {
    escalate(SOFTEN); reasons.push('Your recent training load is spiking — easy today to keep the acute:chronic ratio in the safe zone.')
  }
  // Foster monotony: a week of same-every-day load carries overtraining/illness risk even when the
  // acute:chronic ratio looks fine — dial a hard run back until the week has more variation.
  if (HARD.has(p.type) && i.monotony != null && i.monotony > HIGH_MONOTONY) {
    escalate(SOFTEN); reasons.push('Your training load has been very samey day-to-day (high monotony) — an easy run adds the variation that keeps that from tipping into overtraining.')
  }
  // Polarity: no back-to-back quality days — a second hard run within a day of the last completed
  // one is the classic 80/20 violation.
  if (HARD.has(p.type) && i.hoursSinceLastHardRun != null && i.hoursSinceLastHardRun < HARD_RUN_SPACING_HOURS) {
    escalate(SOFTEN); reasons.push('You already did a hard run in the last day — stacking quality sessions back-to-back blunts them, so today stays easy (80/20).')
  }
  if (i.sleepHoursLastNight != null && i.sleepHoursLastNight < SHORT_SLEEP_HOURS) {
    escalate(SOFTEN); reasons.push(`Short sleep last night (${i.sleepHoursLastNight.toFixed(1)}h) — going easy.`)
  }

  const action = ACTIONS[level]
  if (level === PROCEED || !HARD.has(p.type)) {
    return { action, reasons, prescription: level === REST ? downgrade(p, 'recovery') : p }
  }
  const targetType: RunType = level === REST ? 'recovery' : 'easy'
  return { action, reasons, prescription: downgrade(p, targetType) }
}

// Rebuild the prescription as a gentler type. Duration is trimmed for a softened session.
// HR targets are re-derived by the caller via retarget() so the band matches the new type.
function downgrade(p: Prescription, to: RunType): Prescription {
  return { ...p, type: to, rationale: p.rationale, targets: p.targets, durationMin: p.durationMin != null ? Math.round(p.durationMin * (to === 'recovery' ? 0.5 : 0.7)) : null }
}

/** Re-target a softened prescription against the current fitness snapshot (called by the
 *  route after applyRecoveryGate so the HR band matches the new, gentler type). */
export function retarget(p: Prescription, fitness: FitnessSnapshot): Prescription {
  return { ...p, targets: targetsForRunType(p.type, fitness) }
}
