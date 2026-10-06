import { ACWR_THRESHOLDS } from './acwr'
import type { PrescriptionSignals } from './signals'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

export type EmergencySignals = Pick<PrescriptionSignals,
  'consecutiveSessionDaysOfThisType' | 'hoursSinceLastSession' | 'soreMusclesInSession' | 'activeInjuredMusclesInSession' | 'acwr' | 'rpeTrend' | 'repCompletionRate' | 'selfReportedSick'>
export type EmergencyState = Pick<SessionPeriodization,
  'phase' | 'prescription' | 'prescriptionStatus' | 'prescriptionExpiresAt'>

// Emergency deloads are OFFERED, not imposed: generating one must not mutate persisted
// phase state (that happens on acceptance), and while one is pending — or the user is
// already deloading — the stateless signal check is suppressed so it can't re-fire on
// every prescribe call and pin sessions_in_phase at 0.
/** What fired an emergency deload, named once where it is decided so the plan and the sheet can say
 *  it (#2405). The sheet fell back to "sore muscle flagged in your check-in" for every whole-session
 *  deload, so a sick day read as soreness. */
export type EmergencyTriggerKind =
  | 'illness' | 'consecutive-days' | 'soreness' | 'training-load' | 'effort' | 'missed-reps'
export interface EmergencyTrigger {
  kind: EmergencyTriggerKind
  /** Shown on each deloaded exercise (the deload sheet and the card row). Short. */
  note: string
  /** For the prescription's own `reasoning`, mid-sentence. */
  reason: string
}

/**
 * The first emergency condition that holds, or null. Order is the order a lifter would want it
 * named: their own report first, because it is the one thing no biometric here knows, then the
 * numbers. `shouldTriggerEmergencyDeload` asks exactly `!== null` of this (after its state guards),
 * so the answer to "did it fire" and "what fired it" cannot disagree.
 */
export function emergencyDeloadTrigger(signals: EmergencySignals): EmergencyTrigger | null {
  if (signals.selfReportedSick) {
    return { kind: 'illness', note: 'Deload — you reported feeling unwell', reason: 'you reported feeling unwell in your check-in' }
  }
  if (signals.consecutiveSessionDaysOfThisType >= 4) {
    return { kind: 'consecutive-days', note: 'Deload — four or more days in a row on this session', reason: 'this session has come up four or more days in a row' }
  }
  if (signals.hoursSinceLastSession !== null && signals.hoursSinceLastSession < 36 && signals.soreMusclesInSession.length >= 3) {
    return { kind: 'soreness', note: 'Deload — several muscles are sore after a recent session', reason: 'several muscles are sore and you trained recently' }
  }
  if (signals.acwr !== null && signals.acwr > ACWR_THRESHOLDS.highMax) {
    return { kind: 'training-load', note: 'Deload — your training load is well above your usual', reason: 'your training load is well above your usual' }
  }
  if (signals.rpeTrend !== null && signals.rpeTrend.delta > 2.0) {
    return { kind: 'effort', note: 'Deload — sets have been feeling much harder lately', reason: 'your sets have been feeling much harder lately' }
  }
  if (signals.repCompletionRate !== null && signals.repCompletionRate < 0.7) {
    return { kind: 'missed-reps', note: 'Deload — you have been missing reps', reason: 'you have been missing reps' }
  }
  return null
}

export function shouldTriggerEmergencyDeload(signals: EmergencySignals, state: EmergencyState, now = new Date()): boolean {
  if (state.phase === 'deload') return false
  const p = state.prescription
  if (
    p?.deload && p.phaseAction === 'deload_recommended' &&
    state.prescriptionStatus === 'pending' &&
    state.prescriptionExpiresAt != null && state.prescriptionExpiresAt > now
  ) return false
  // Active injuries are NOT a standalone trigger here (AI-4) — the prompt already
  // receives activeInjuredMusclesInSession separately and documents the finer-grained
  // session_swap_recommended path (lib/ai-periodization/prompt.ts), so the LLM can weigh
  // an injury's actual severity/muscle instead of every injury forcing the blunt
  // 2-set/50% emergency branch regardless of how minor it is.
  // Self-reported illness is a standalone trigger (owner call 2026-07-29). Training through a fever
  // is the one case where the lifter knows something no biometric here does yet, so their own
  // report counts — the recommendation is still only OFFERED, never imposed, so this deloads the
  // session they get if they choose to train rather than blocking them.
  return emergencyDeloadTrigger(signals) !== null
}
