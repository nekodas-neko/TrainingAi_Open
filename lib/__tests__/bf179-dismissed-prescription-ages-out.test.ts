// BF-179 — a DISMISSED prescription that expired three days ago was still prescribing a deload.
//
// The ageing-out check in `reevaluatePrescriptionForToday` was an ALLOW-list naming
// `auto_applied`/`accepted`/`consumed`. `dismissed` was in neither that set nor the deliberate
// `pending` carve-out, so `needsRegenerate` never fired and `workout-data/route.ts` took the
// else-branch — which re-stamps the stale prescription and writes it back. The expired offer was
// not merely tolerated, it was refreshed.
//
// Measured in production 2026-09-20: a `dismissed` row generated 2026-09-16 21:25 and expired
// 2026-09-17 21:25 still carried `phaseAction: 'deload_recommended'` and was still setting every
// working set to 52%, on a day whose own signals read 100/100 STRONG FIT.
//
// This is Q-229 returning through a status its fix did not name, which is why the shape matters as
// much as the fix: the check is a deny-list now, so the next status added to `PrescriptionStatus`
// ages out by default rather than joining `dismissed` as a silent gap.
//
// Every timestamp here is DERIVED FROM THE CLOCK. A hardcoded date on one side of a rolling-window
// comparison is a test with a known detonation date — see `scale-ble-day-keying` (CLAUDE.md).
import { describe, it, expect } from 'vitest'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '@trainingai/shared/ai-periodization/reevaluate'
import type { AiPrescription, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { EmergencyState } from '@trainingai/shared/ai-periodization/emergency-deload'

const NOW = new Date()
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000)

/** The owner's row: a deload prescription pinning every working set to 52%. */
const deloadPrescription = (): AiPrescription => ({
  phase: 'accumulation',
  phaseAction: 'deload_recommended',
  exercises: [
    { sessionExerciseId: 'bench', name: 'Bench Press', sets: 3, reps: 8, pct: 52, restSec: 90 },
    { sessionExerciseId: 'squat', name: 'Squat', sets: 3, reps: 8, pct: 52, restSec: 90 },
  ],
  estimatedSessionDurationMin: 60,
  weeklyVolumeContribution: {},
  deload: true,
  reasoning: 'test',
  confidence: 0.8,
})

const stateWith = (status: PrescriptionStatus, expiresAt: Date | null): EmergencyState => ({
  phase: 'accumulation',
  prescription: null,
  prescriptionStatus: status,
  prescriptionExpiresAt: expiresAt,
})

// Nothing sore, nothing injured, a long gap since the last session — so the emergency-deload
// branch below the expiry check cannot fire and claim the result for the wrong reason.
const quietSignals: ReevaluationSignals = {
  soreMusclesInSession: [],
  hoursSinceLastSession: 72,
  activeInjuredMusclesInSession: [],
  trainingGoal: 'powerbuilding',
  illnessFlag: null,
  // Not sick, deliberately: `shouldTriggerEmergencyDeload` short-circuits on this, and a true here
  // would make every assertion below pass through the emergency branch instead of the expiry one.
  selfReportedSick: false,
  exercises: [
    { sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
    { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quads', role: 'main' }] },
  ],
}

describe('an expired prescription ages out whatever its status (BF-179)', () => {
  // The reported defect, with the production shape: dismissed, and three days past expiry.
  it('regenerates a DISMISSED prescription that expired three days ago', () => {
    const result = reevaluatePrescriptionForToday(
      deloadPrescription(), quietSignals, stateWith('dismissed', daysFromNow(-3)), NOW)

    expect(result.needsRegenerate).toBe(true)
  })

  // The whole point of the deny-list. If this is ever rewritten as an allow-list, the status that
  // is forgotten next time fails here instead of shipping silently.
  it.each<PrescriptionStatus>(['dismissed', 'accepted', 'auto_applied', 'consumed'])(
    'regenerates an expired prescription in status %s', (status) => {
      const result = reevaluatePrescriptionForToday(
        deloadPrescription(), quietSignals, stateWith(status, daysFromNow(-1)), NOW)

      expect(result.needsRegenerate).toBe(true)
    })

  // CONTROL 1 — `pending` must NOT age out here. Its expiry is owned by the emergency-deload
  // suppression, and re-deriving it here would fight that. A fix that simply dropped the status
  // test would pass every assertion above and fail this one.
  it('leaves a PENDING prescription alone even when expired', () => {
    const result = reevaluatePrescriptionForToday(
      deloadPrescription(), quietSignals, stateWith('pending', daysFromNow(-3)), NOW)

    expect(result.needsRegenerate).toBe(false)
  })

  // CONTROL 2 — `none` means there is no offer to age out, so regenerating on it would loop with
  // nothing to show for it.
  it('leaves status NONE alone even when expired', () => {
    const result = reevaluatePrescriptionForToday(
      deloadPrescription(), quietSignals, stateWith('none', daysFromNow(-3)), NOW)

    expect(result.needsRegenerate).toBe(false)
  })

  // CONTROL 3 — the fix is about EXPIRY, not about the status. A dismissed prescription still
  // inside its window is not this entry's problem and must not be regenerated on every tab-open.
  it('leaves a DISMISSED prescription alone while it is still inside its window', () => {
    const result = reevaluatePrescriptionForToday(
      deloadPrescription(), quietSignals, stateWith('dismissed', daysFromNow(+4)), NOW)

    expect(result.needsRegenerate).toBe(false)
  })

  // A null expiry is the pre-Q-229 shape and still means "nothing to age out".
  it('leaves a prescription with no expiry alone', () => {
    const result = reevaluatePrescriptionForToday(
      deloadPrescription(), quietSignals, stateWith('dismissed', null), NOW)

    expect(result.needsRegenerate).toBe(false)
  })
})
