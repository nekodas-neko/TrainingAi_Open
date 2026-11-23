import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import { prescriptionAgedOut } from './prescription-expiry'
import { slotHoldsPlan } from './plan-status'
import { deloadEndDue, type ProgramDeloadCheck } from './phase-guards'

// True when a fresh AI prescription is being (re)generated for an ai_dynamic session:
// the prescription slot was consumed (by a completed session, a phase transition, or a
// program edit) and no new prescription has landed yet. In this state the workout-data
// route fires the regeneration AND the client shows a "preparing your AI workout" state
// instead of painting the base-program numbers the AI is about to replace.
//
// Baseline phase is excluded on purpose: during baseline there is no per-set AI
// prescription coming, so the base style is the correct thing to show. A 'none' status
// (brand-new session, before the first-ever prescription) is likewise not "pending" —
// nothing is being generated yet, so base numbers stand until the first session completes.
//
// The trigger is `prescriptionStatus === 'consumed'` ALONE — not `consumed && prescription == null`
// (E2-11). A normal completion flips the status to 'consumed' but LEAVES the (now-stale) prescription
// JSONB in place (completeWorkoutFromPayload), so the old null-requiring signature could only ever
// match a program-edit clear — the post-completion retry/preparing state was unreachable, and one
// Gemini outage at completion silently cost two sessions of AI prescriptions. `storePrescription`
// flips the status back to 'pending' when a fresh prescription lands, so the status alone is the
// correct, self-clearing signal regardless of whether the stale JSONB was nulled.
//
// #3700: an aged-out prescription (`prescriptionAgedOut`) is pending too. It used to be served once
// more as the plan while a regeneration ran in the background, and nothing repainted the screen when
// the fresh one landed, so the lifter trained the expired plan. A one-day rest-day offer expires at
// the next local midnight; the next open must regenerate it, show "preparing", and paint the new
// one. Both readers (workout-data, the next-session preview) take this as "not the plan".
//
// #3876: so is a plan in a deload that has done its two sessions (`deloadEndDue`). The deload ends at
// generation, and nothing regenerated an unexpired slot, so the type trained another deload.
export function isAiPrescriptionPending(
  state: (Pick<SessionPeriodization, 'prescription' | 'prescriptionStatus'>
    & Partial<Pick<SessionPeriodization, 'prescriptionExpiresAt' | 'phase' | 'sessionsInPhase'>>) | null | undefined,
  // `programDeload` (`readProgramDeloadCheck`): an aligned program's deload ends at the program's cap.
  // `underWay`: a workout of this type is under way (`isSessionUnderWay`). #3900 second review (1): the plan
  // it started with keeps driving the bar, so a plan held in the slot is never pending then, whatever its
  // expiry or deload count says, and nothing regenerates it.
  opts: { isAiDynamic: boolean; isBaselinePhase: boolean; programDeload?: ProgramDeloadCheck | null; underWay?: boolean },
  now: Date = new Date(),
): boolean {
  if (opts.underWay && state != null && slotHoldsPlan(state)) return false
  return opts.isAiDynamic
    && !opts.isBaselinePhase
    && state != null
    && (state.prescriptionStatus === 'consumed' || (
      state.prescription != null
      && (prescriptionAgedOut({ ...state, prescriptionExpiresAt: state.prescriptionExpiresAt ?? null }, now)
        // #3876: a plan in a deload that has done its sessions; regenerating ends the deload.
        || (state.phase != null && deloadEndDue(state.prescription, { phase: state.phase, sessionsInPhase: state.sessionsInPhase }, opts.programDeload)))
    ))
}
