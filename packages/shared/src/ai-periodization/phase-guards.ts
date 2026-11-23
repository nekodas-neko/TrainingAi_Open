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
// #3900: on the AI plan (`ai_dynamic`) a guard's move no longer waits for this. Its loads are made in
// the new phase before the plan is stored (`guardMoveTarget`, `generate-prescription.ts`), which
// removes the first reason, and the owner chose a phase that never outlives its window over the second.
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

// The caps on each phase are the PROGRAM's, in training weeks (#3766): `PROGRAM_PHASE_CAP_WEEKS` and
// `applyProgramPhaseCap` in `program-phase.ts`. The per-session-type ceilings that lived here
// (accumulation 6, intensification 5, realisation 2 sessions of one type) were replaced by them.

// Number of deload sessions after which one session type's deload is complete. Since #3766 this is
// only the switch-over's test: a program still on per-type phases waits for each type in a deload to
// finish it, and such a type keeps this way out while it waits. An aligned program's deload is a
// training week (`PROGRAM_PHASE_CAP_WEEKS.deload`).
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

/**
 * Whether a plan is a deload (#3877). Worked out from the session's phase and the action, never
 * taken from the model's own `deload` flag: production held a plan in accumulation, with a plain
 * stay, flagged `deload: true`, and Preview's Deload toggle adopts the flag and lightens every
 * exercise. True only when the session is in a deload phase or the plan is a deload offer.
 */
export function isDeloadPlan(sessionPhase: PeriodizationPhase, phaseAction: string): boolean {
  return sessionPhase === 'deload' || phaseAction === 'deload_recommended'
}

/**
 * Where a session type goes when its deload ends by itself (#3876, owner 19 Nov): back to the phase
 * it was in before the deload, as recorded when it entered (`preEmergencyDeloadPhase`, written by
 * `advancePhase`). A deload entered from realisation is the cycle's planned close, so it goes on to
 * accumulation (`NEXT_PROGRAM_PHASE`'s order) rather than back to realisation. With nothing
 * recorded (a deload entered before #3876), the program's phase; with none of that, accumulation.
 */
export function deloadExitPhase(
  preDeloadPhase: PeriodizationPhase | null | undefined,
  programPhase: PeriodizationPhase | null | undefined,
): PeriodizationPhase {
  if (preDeloadPhase === 'accumulation' || preDeloadPhase === 'intensification') return preDeloadPhase
  if (preDeloadPhase === 'realisation') return 'accumulation'
  if (programPhase === 'accumulation' || programPhase === 'intensification' || programPhase === 'realisation') return programPhase
  return 'accumulation'
}

/** A session type's own deload is over: it has completed `DELOAD_FLOOR` deload sessions. Only a
 *  program still waiting for its switch-over ends a deload per type; an aligned program's deload is
 *  the program's (`applyProgramPhaseCap`). */
export function typeDeloadFinished(
  state: { phase: PeriodizationPhase; sessionsInPhase: number },
  programAligned: boolean,
): boolean {
  return !programAligned && state.phase === 'deload' && state.sessionsInPhase >= DELOAD_FLOOR
}

/**
 * #3876: the stored plan is in a deload that has done its `DELOAD_FLOOR` sessions, and it was made
 * before the count got there. A deload ends at generation (owner, 19 Nov: by itself, no tap), and
 * `workout-data` regenerated only a consumed or aged-out slot, so an unexpired deload plan or floor
 * offer was served as it was and the type trained another deload. Regenerating runs the exit. Read as "pending" (`isAiPrescriptionPending`), so the screen shows
 * "preparing" rather than the deload, and by `reevaluatePrescriptionForToday`.
 *
 * Only once per count: a plan generation stored at or after this count (`sessionsInPhaseAtPlan`) has
 * already been through the exit, which an aligned program's deload short of its cap does not take, so
 * it is served. A plan stored before the field existed has no count and is regenerated once.
 */
export function deloadEndDue(
  prescription: Pick<AiPrescription, 'sessionsInPhaseAtPlan' | 'programWeeksDoneAtPlan'>,
  state: { phase: string; sessionsInPhase?: number },
  program?: ProgramDeloadCheck | null,
): boolean {
  if (state.phase !== 'deload') return false
  // An aligned program's deload is the program's: it ends at the program's cap (`programDeloadFinished`,
  // which generation runs), never at the type's count, so the type's count says nothing here. Its cap
  // can be reached with no new session: a plan made on the deload week's Sunday is read on Monday.
  if (program?.aligned) {
    if (!program.deloadFinished) return false
    return prescription.programWeeksDoneAtPlan == null || prescription.programWeeksDoneAtPlan < program.trainingWeeksDone
  }
  if (state.sessionsInPhase == null || state.sessionsInPhase < DELOAD_FLOOR) return false
  return prescription.sessionsInPhaseAtPlan == null || prescription.sessionsInPhaseAtPlan < state.sessionsInPhase
}

/** What `deloadEndDue` needs to know about the program (`readProgramDeloadCheck`): whether it is
 *  aligned and, if so, whether its deload has reached its cap. Absent, the type's own count decides,
 *  as it does while the program waits for its switch-over. */
export interface ProgramDeloadCheck {
  aligned: boolean
  deloadFinished: boolean
  trainingWeeksDone: number
}

/**
 * The phase a plan's sets and loads were written for (#3713), which caps its sets on every path that
 * re-derives them (re-fit, a deload's revert). Not `prescription.phase`: `applyProgramPhaseCap`,
 * `applyDeloadFloor` and a program move rewrite that to the NEXT phase on a plain stay, while the
 * loads stay the current phase's. Generation records the stage's own phase on `refitBaseline.phase`.
 * A plan from before that: a stay was written for its own phase; any move on offer, for the phase
 * the session is in (`sessionPhase`), which is what the guards that rewrite it leave the loads in.
 */
export function phaseOfLoads(
  prescription: Pick<AiPrescription, 'phase' | 'phaseAction' | 'refitBaseline'>,
  sessionPhase: PeriodizationPhase,
): PeriodizationPhase {
  if (prescription.refitBaseline?.phase) return prescription.refitBaseline.phase
  return prescription.phaseAction === 'stay' ? prescription.phase : sessionPhase
}
