import type { AiPrescription, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

/**
 * A deload offered for one day's reason (#3799, owner's option A, 15 Nov).
 *
 * `phaseAction: 'deload_recommended'` is only ever written for the session in front of the lifter:
 * the emergency rules (`emergency-deload.ts`), the whole-session soreness deload
 * (`per-exercise-deload.ts`), and the model's own "reduced load for this session" answer. A
 * PLANNED deload is a phase move and says so differently: the realisation ceiling writes
 * `phase: 'deload'` with `phaseAction: 'transition_recommended'` (`phase-guards.ts`), and the
 * lifter picking Deload from the phase list sends `force`. So the existing field already tells the
 * two apart and nothing new is stored.
 *
 * Accepting a one-day deload lightens that session only. It never moves
 * `session_periodization.phase`: it did until #3799, and since loads follow the phase until two
 * deload sessions are completed and "Move to accumulation" is tapped, one tap cost a weekly
 * session type two or three weeks.
 */
export function isOneDayDeload(
  prescription: Pick<AiPrescription, 'deload' | 'phaseAction'> | null | undefined,
): boolean {
  return prescription?.deload === true && prescription.phaseAction === 'deload_recommended'
}

/**
 * The slot holds an unexpired one-day deload the lifter has not yet trained or turned down:
 * offered (`pending`) or taken (`accepted`). Generation returns it as it is, and the emergency
 * check does not re-fire over it. `accepted` joined `pending` with #3799: while accepting moved
 * the phase, the phase itself stopped the re-fire; now the phase stays where it was, and without
 * this the next generation would replace the accepted deload with a fresh, unanswered offer.
 */
export function holdsOneDayDeload(
  state: {
    prescription: Pick<AiPrescription, 'deload' | 'phaseAction'> | null
    prescriptionStatus: PrescriptionStatus | null
    prescriptionExpiresAt: Date | null
  },
  now = new Date(),
): boolean {
  // #3900: on the AI plan a prescribed deload is stored `auto_applied`, the day's plan without a tap,
  // and is held exactly as an accepted one. Before #3900 no deload was ever stored `auto_applied`, so
  // for every other program kind this is the same test as before.
  return isOneDayDeload(state.prescription) &&
    (state.prescriptionStatus === 'pending' || state.prescriptionStatus === 'accepted' || state.prescriptionStatus === 'auto_applied') &&
    state.prescriptionExpiresAt != null && state.prescriptionExpiresAt > now
}
