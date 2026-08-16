import type { AiPrescription, PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'

// Whether a transition may be applied AUTOMATICALLY (auto-apply on, confidence met).
//
// Only when the MODEL chose the transition. The exercise percentages are clamped against the
// model's own `phase`, and the ceilings below rewrite `phase`/`phaseAction` AFTERWARDS — so a
// ceiling-forced transition carries the OLD phase's loads. Auto-applying that would advance the
// phase into a session prescribed a zone too light. A forced transition also means the signals
// were ambiguous enough that a cap had to break the tie, which is exactly when the lifter should
// decide rather than be told. Both arguments are the pre-guard model answer vs the post-guard
// prescription; they agree only when the model asked for the transition itself.
export function canAutoApplyTransition(
  modelPhaseAction: string,
  modelPhase: string,
  finalPhaseAction: string,
  finalPhase: string,
): boolean {
  return (
    modelPhaseAction === 'transition_recommended' &&
    finalPhaseAction === 'transition_recommended' &&
    modelPhase === finalPhase
  )
}

// Hard cap on accumulation sessions. With ambiguous signals the AI can keep
// recommending "stay" indefinitely; this forces a transition recommendation once the
// cap is reached so an accumulation block can't run forever (~6 weeks at one
// accumulation session per week).
export const ACCUMULATION_CEILING = 6

// Once the user has logged at least ACCUMULATION_CEILING sessions in the accumulation
// phase and the AI still wants to stay, override the prescription to recommend moving on
// to intensification. Only a plain "stay" is overridden — genuine recovery actions
// (deload / rest day / session swap) are left untouched.
export function applyAccumulationCeiling(
  prescription: AiPrescription,
  phase: PeriodizationPhase,
  sessionsInPhase: number,
): AiPrescription {
  if (phase !== 'accumulation' || sessionsInPhase < ACCUMULATION_CEILING || prescription.phaseAction !== 'stay') {
    return prescription
  }
  return {
    ...prescription,
    phase: 'intensification',
    phaseAction: 'transition_recommended',
    reasoning: `You've completed ${sessionsInPhase} accumulation sessions (cap ${ACCUMULATION_CEILING}) — time to move to intensification (heavier loads, lower reps). ${prescription.reasoning}`.trim(),
  }
}

// Hard cap on intensification sessions, mirroring the accumulation ceiling. The prompt
// allows a transition from 3+ sessions; the ceiling is the hard stop above that minimum.
export const INTENSIFICATION_CEILING = 5

// Once the user has logged at least INTENSIFICATION_CEILING sessions in the
// intensification phase and the AI still wants to stay, override the prescription to
// recommend moving on to realisation. Only a plain "stay" is overridden.
export function applyIntensificationCeiling(
  prescription: AiPrescription,
  phase: PeriodizationPhase,
  sessionsInPhase: number,
): AiPrescription {
  if (phase !== 'intensification' || sessionsInPhase < INTENSIFICATION_CEILING || prescription.phaseAction !== 'stay') {
    return prescription
  }
  return {
    ...prescription,
    phase: 'realisation',
    phaseAction: 'transition_recommended',
    reasoning: `You've completed ${sessionsInPhase} intensification sessions (cap ${INTENSIFICATION_CEILING}) — time to move to realisation (peak loads, lowest reps). ${prescription.reasoning}`.trim(),
  }
}

// Hard cap on realisation sessions — matches the prompt's own "realisation→deload: always
// after 2 sessions" rule, which nothing previously enforced.
export const REALISATION_CEILING = 2

// Once the user has logged at least REALISATION_CEILING sessions in the realisation phase
// and the AI still wants to stay, override the prescription to recommend a deload. Only a
// plain "stay" is overridden.
export function applyRealisationCeiling(
  prescription: AiPrescription,
  phase: PeriodizationPhase,
  sessionsInPhase: number,
): AiPrescription {
  if (phase !== 'realisation' || sessionsInPhase < REALISATION_CEILING || prescription.phaseAction !== 'stay') {
    return prescription
  }
  return {
    ...prescription,
    phase: 'deload',
    phaseAction: 'transition_recommended',
    reasoning: `You've completed ${sessionsInPhase} realisation sessions (cap ${REALISATION_CEILING}) — time to deload and recover. ${prescription.reasoning}`.trim(),
  }
}

// Number of deload sessions after which the recovery block is considered complete and a
// new cycle should begin.
export const DELOAD_FLOOR = 2

// Once the user has logged at least DELOAD_FLOOR deload sessions and the AI still wants to
// stay, override the prescription to recommend starting a fresh accumulation block —
// closing the periodization cycle. As with the accumulation ceiling, only a plain "stay"
// is overridden. The UI offers both "continue to accumulation" and "start a new program".
export function applyDeloadFloor(
  prescription: AiPrescription,
  phase: PeriodizationPhase,
  sessionsInPhase: number,
): AiPrescription {
  if (phase !== 'deload' || sessionsInPhase < DELOAD_FLOOR || prescription.phaseAction !== 'stay') {
    return prescription
  }
  return {
    ...prescription,
    phase: 'accumulation',
    phaseAction: 'transition_recommended',
    reasoning: `You've completed ${sessionsInPhase} deload sessions — recovery is done. Start a fresh accumulation block, or build a new program to keep adapting. ${prescription.reasoning}`.trim(),
  }
}
