/**
 * #4137 (1): a re-fit of a model-written deload that soreness has lightened keeps the `preSoreness` record (#4126), so
 * clearing the soreness still puts the row's own reps, load and note back. The re-fit re-derives sets and rest from
 * the plan's baseline, so the record's sets and rest follow the re-fit's. `aggregateSignals` is mocked (as in
 * `duration-refit.test.ts`); the budget stage and the re-evaluation run for real. 0 model requests; made-up lifts.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '../reevaluate'

const SESSION = '00000000-0000-4000-8000-0000000041a1'
const P = '00000000-0000-4000-8000-0000000041a2', S = '00000000-0000-4000-8000-0000000041a3'
const NOW = new Date('2026-11-25T12:00:00+10:00')

const signals = {
  trainingGoal: 'strength', phase: 'accumulation', effectiveTimeBudgetMin: 90, sessionTimeBudgetMinutes: 90,
  exercises: [
    { sessionExerciseId: P, name: 'Lift p', role: 'primary', muscleGroups: ['quadriceps'], muscleAssignments: [{ muscle: 'quadriceps', role: 'main' }], transitionSec: 240, timeProfile: null },
    { sessionExerciseId: S, name: 'Lift s', role: 'secondary', muscleGroups: ['back'], muscleAssignments: [{ muscle: 'back', role: 'main' }], transitionSec: 240, timeProfile: null },
  ],
  weeklyTargets: {}, weeklyLogged: {}, checkinHold: null,
} as unknown as PrescriptionSignals
vi.mock('@trainingai/shared/ai-periodization/signals', () => ({ aggregateSignals: async () => structuredClone(signals) }))
const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')

const WROTE = 'Deload week: lighter loads.'
/** A model-written deload, lightened for soreness on the primary (what `reevaluatePrescriptionForToday` stores). */
const lightened = (): AiPrescription => ({
  phase: 'accumulation', phaseAction: 'deload_recommended', deload: true, reasoning: 'r', confidence: 0.5,
  estimatedSessionDurationMin: 20, weeklyVolumeContribution: {}, durationPreset: 'standard',
  refitBaseline: { sets: { [P]: 3, [S]: 3 }, reasoning: 'r' },
  exercises: [
    {
      sessionExerciseId: P, name: 'Lift p', sets: 2, reps: 5, pct: 45, restSec: 60, deloaded: true, modelDeload: true,
      deloadNote: 'Still sore: lighter today.', preDeload: { sets: 5, reps: 5, pct: 75, restSec: 150 },
      preSoreness: { sets: 3, reps: 6, pct: 55, restSec: 90, deloadNote: WROTE },
    },
    { sessionExerciseId: S, name: 'Lift s', sets: 3, reps: 8, pct: 55, restSec: 90, deloaded: true, modelDeload: true, deloadNote: WROTE, preDeload: { sets: 4, reps: 8, pct: 70, restSec: 120 } },
  ],
} as unknown as AiPrescription)

const quiet: ReevaluationSignals = {
  soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 48, activeInjuredMusclesInSession: [],
  trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
  exercises: [{ sessionExerciseId: P, name: 'Lift p', muscleAssignments: [{ muscle: 'quadriceps', role: 'main' as const }] }, { sessionExerciseId: S, name: 'Lift s', muscleAssignments: [{ muscle: 'back', role: 'main' as const }] }],
}

const refit = async (stored: AiPrescription, preset: 'short' | 'long' | 'standard') => {
  const stores: AiPrescription[] = []
  const repo = {
    getActiveProgramWithStructureStamp: async () => ({ program: { id: 'p', sessions: [{ id: SESSION, timeBudgetMinutes: 90 }] }, structure: 's' }),
    getSessionPeriodization: async () => ({ phase: 'accumulation', phaseStartedAt: new Date(), prescription: stored, prescriptionStatus: 'accepted', prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000) }),
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stores.push(p); return true },
  } as never
  const res = await refitPrescriptionToBudget('u', SESSION, repo, 'UTC', preset, NOW)
  if (!res.ok) throw new Error(`no re-fit: ${res.reason}`)
  expect(stores).toHaveLength(1)
  return res.prescription
}
const row = (p: AiPrescription, id: string) => p.exercises.find(e => e.sessionExerciseId === id)!

describe('a re-fit keeps the record a soreness-lightened model deload row clears from (#4137)', () => {
  for (const preset of ['short', 'long', 'standard'] as const) {
    it(`${preset}: the record stays, its sets and rest are the re-fit's, and the clear puts the row's reps, load and note back`, async () => {
      const fitted = await refit(lightened(), preset)
      const p = row(fitted, P)
      // The rest the clear restores is the model's own (90), not the lightened row's.
      expect(p.preSoreness).toEqual({ sets: p.sets, reps: 6, pct: 55, restSec: 90, deloadNote: WROTE })
      // The soreness clears on a later read.
      const out = reevaluatePrescriptionForToday(fitted, quiet, {
        phase: 'accumulation', prescription: fitted, prescriptionStatus: 'accepted',
        prescriptionExpiresAt: new Date(NOW.getTime() + 5 * 86_400_000), sessionsInPhase: 2, underWay: false,
      }, NOW, signals)
      expect(out.needsRegenerate).toBe(false)
      const cleared = row(out.prescription, P)
      expect(cleared).toMatchObject({ reps: 6, pct: 55, deloadNote: WROTE, sets: p.sets, restSec: 90 })
      expect(cleared.preSoreness).toBeUndefined()
    })
  }

  it('a second re-fit still restores the model\'s rest (the lightened rest never enters the saved baseline)', async () => {
    for (const [first, second] of [['short', 'standard'], ['short', 'short'], ['long', 'short']] as const) {
      const once = await refit(lightened(), first)
      const twice = await refit(once, second)
      expect(row(twice, P).preSoreness?.restSec, `${first} then ${second}`).toBe(90)
    }
  })

  it('a row with no record is re-fitted exactly as before: none is invented', async () => {
    const plan = lightened()
    delete (row(plan, P) as { preSoreness?: unknown }).preSoreness
    const fitted = await refit(plan, 'short')
    expect(row(fitted, P)).not.toHaveProperty('preSoreness')
    expect(row(fitted, S)).not.toHaveProperty('preSoreness')
  })
})
