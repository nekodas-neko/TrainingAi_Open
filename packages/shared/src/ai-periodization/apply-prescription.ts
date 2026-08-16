import type { StyleSet } from '@trainingai/shared/types/progression'
import type { AiPrescriptionExercise, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

// A pending recommendation whose per-exercise numbers still drive today's load. The phase
// decision and today's sets/reps/pct are separable questions: the generator runs the full
// reconcile → autoregulation → time-budget → phase-guard chain either way, so discarding
// those numbers over an unresolved *phase* choice silently reverts the session to the base
// progression style. `transition_recommended` changes which block you're in next, not
// whether you train today, so its numbers apply while the transition itself waits for
// consent. The other three actions change *whether/what* you train (deload, swap the
// session, rest instead) — those stay opt-in.
const PENDING_ACTIONS_THAT_DRIVE_LOAD = new Set(['stay', 'transition_recommended'])

// Whether an AI prescription should drive the actual loaded weights for the session
// (not just be shown as an advisory card). The bar follows the AI when:
//  - the user accepted it, or it was auto-applied; or
//  - it's a pending "stay" or "transition_recommended" — periodization should drive load
//    by default, with Dismiss as the opt-out back to the program's base style.
// Recovery decisions (deload, session swap, rest day) only drive load once explicitly
// accepted — they represent a decision, not a default.
export function prescriptionDrivesLoad(
  phaseAction: string,
  status: PrescriptionStatus,
): boolean {
  if (status === 'accepted' || status === 'auto_applied') return true
  if (status === 'pending' && PENDING_ACTIONS_THAT_DRIVE_LOAD.has(phaseAction)) return true
  return false
}

// Expand a single prescription exercise ({ sets, reps, pct, restSec }) into the per-set
// progression style the workout screen consumes. A genuine working-pct set carries the
// prescribed percentage and counts toward the 1RM estimate, so hitting the prescription
// exactly reproduces the current 1RM and beating it pushes the estimate up (see lib/1rm.ts).
// A deloaded set is deliberately submaximal (pct suppressed), so running it through the
// same formula as a real top set inflates the estimate — excluded via useFor1rm: false.
export function prescriptionStyleForExercise(presc: AiPrescriptionExercise): StyleSet[] {
  // The workout screen only reads pct/reps/restSec/useFor1rm; the rest of StyleSet
  // (id/styleId/setNumber) is irrelevant here, matching how workout-data maps styles.
  return Array.from({ length: presc.sets }, () => ({
    pct: presc.pct,
    reps: presc.reps,
    restSec: presc.restSec,
    useFor1rm: !presc.deloaded,
  }) as StyleSet)
}
