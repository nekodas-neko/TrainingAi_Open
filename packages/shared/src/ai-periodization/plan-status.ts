import type { AiPrescription, PeriodizationPhase, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import { isOneDayDeload } from '@trainingai/shared/ai-periodization/one-day-deload'

/**
 * #3900 (owner, 20 Nov): "if the user is on the AI plan, it should only be click on the workout for
 * the day, then start workout or select deload. User shouldn't need to confirm phase etc."
 *
 * The status a freshly generated plan is stored with on an `ai_dynamic` program. Every kind of plan
 * applies by itself there: a stay, a move the model earned, a move the window cap or the other
 * session types' vote forces (its loads are made in the new phase first, `generate-prescription.ts`),
 * a plan under the old 0.6 confidence bar, a rest-day or swap suggestion (data on the plan for the
 * card's note, never a gate), and a deload the engine prescribes. `programs.auto_apply_prescriptions`
 * is not read here; it is still read for the other program kinds, exactly as before.
 *
 * Two plans still wait:
 *  - a phase move on a program still waiting for its switch-over (#3766). The move there is one
 *    session type's alone and goes through the transition route, which an applied plan never calls
 *    (#3877 item 3: applying it through the program move stored no plan at all);
 *  - a deload, if `AI_PRESCRIBED_DELOAD_APPLIES` is turned off.
 *
 * Every post-model clamp, the lift preferences, the weekly check-in's hold and shorter session,
 * injuries and the effort answer are applied before this is decided, so an applied plan carries
 * them exactly as an accepted one does. Nothing the model reports gates the answer: the action is
 * the one the guards settled, and `movesPhase` is worked out by code.
 */
export function aiPlanStatus(plan: {
  phaseAction: string
  /** The move this plan carries will be applied now: the program is aligned and the plan's loads
   *  are the new phase's (a move the model earned, or one a guard forced and the loads re-clamped). */
  movesPhase: boolean
}): 'pending' | 'auto_applied' {
  if (plan.phaseAction === 'transition_recommended') return plan.movesPhase ? 'auto_applied' : 'pending'
  if (plan.phaseAction === 'deload_recommended') return AI_PRESCRIBED_DELOAD_APPLIES ? 'auto_applied' : 'pending'
  return 'auto_applied'
}

/**
 * The one condition that decides whether a deload the engine prescribes (the emergency rules, the
 * whole-session soreness deload, the model's own "reduced load for this session") becomes the day's
 * plan without a tap on the AI plan. `true` reverses the owner's 2 Aug "deloads stay manual" call, per
 * their 20 Nov message. Set to `false` to go back: the deload is then stored `pending`, an offer, as
 * before. A deload the user picks (the Deload choice, any day) is not decided here and is unchanged.
 */
export const AI_PRESCRIBED_DELOAD_APPLIES = true

/** The program kind whose plans apply by themselves. Plans on `automatic` and `manual` programs are
 *  decided exactly as before #3900. */
export function isAiPlanProgram(program: { phaseMode?: string } | null | undefined): boolean {
  return program?.phaseMode === 'ai_dynamic'
}

/** What a stored plan says to the start card (#3900, mockup 1A), worked out from the stored fields
 *  alone so both apps read it the same way. */
export interface AiPlanCardState {
  /** The plan is the day's plan (applied by itself or accepted): Start runs it. */
  applied: boolean
  /** The engine prescribed today's deload ("Deload · prescribed"); "Train full instead" is the
   *  existing Full override (`wasOverride`, a full session for 1RM and records since #3877). */
  deloadPrescribed: boolean
  /** A rest-day or session-swap suggestion, shown as a note above Start. It never blocks Start. */
  suggestion: 'rest_day' | 'session_swap' | null
}

export function aiPlanCardState(
  prescription: Pick<AiPrescription, 'phaseAction' | 'deload'> | null | undefined,
  status: PrescriptionStatus | null | undefined,
  /** The session type's phase. A planned deload week (`deload`) is prescribed too. */
  sessionPhase?: PeriodizationPhase | null,
): AiPlanCardState {
  const applied = prescription != null && (status === 'auto_applied' || status === 'accepted')
  return {
    applied,
    // From the phase and the action, never the model's own flag (#3877).
    deloadPrescribed: applied && (isOneDayDeload(prescription) || sessionPhase === 'deload'),
    suggestion: prescription?.phaseAction === 'rest_day_recommended' ? 'rest_day'
      : prescription?.phaseAction === 'session_swap_recommended' ? 'session_swap'
      : null,
  }
}

/** The slot holds a plan the session being trained runs on (C, D): kept while it is under way. */
export function slotHoldsPlan(state: { prescription: unknown; prescriptionStatus: PrescriptionStatus | null }): boolean {
  return state.prescription != null
    && (state.prescriptionStatus === 'pending' || state.prescriptionStatus === 'auto_applied' || state.prescriptionStatus === 'accepted')
}
