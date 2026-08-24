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
  return (
    // Self-reported illness (owner call 2026-07-29). Training through a fever is the one case
    // where the lifter knows something no biometric here does yet, so their own report is a
    // standalone trigger — the recommendation is still only OFFERED, never imposed, so this
    // deloads the session they get if they choose to train rather than blocking them.
    signals.selfReportedSick ||
    signals.consecutiveSessionDaysOfThisType >= 4 ||
    (signals.hoursSinceLastSession !== null && signals.hoursSinceLastSession < 36 && signals.soreMusclesInSession.length >= 3) ||
    (signals.acwr !== null && signals.acwr > ACWR_THRESHOLDS.highMax) ||
    (signals.rpeTrend !== null && signals.rpeTrend.delta > 2.0) ||
    (signals.repCompletionRate !== null && signals.repCompletionRate < 0.7)
  )
}
