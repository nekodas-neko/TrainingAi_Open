/**
 * Review of #4127: a plan row now carries the lift's OWN name (`reconcilePrescription` takes it from the
 * session's exercise by id), not the name the model echoed. Several rules that run when a stored plan is
 * served look a row up BY NAME, so a row the model had re-cased or padded ("LIFT P", "  Lift p  ") was
 * missed by them and is now found:
 *   (a) the weekly check-in's hold on a stored plan (`holdStoredPlanUnderCheckin`),
 *   (b) a used-up one-off's removal (`stripSpentOneShotRecord`),
 *   (c) the Coach's restate of a spent one-off, which restates the rest of the lift's preference
 *       (DB test: lib/data/postgres/__tests__/plan-row-name-lookup-4127.test.ts).
 * Each case below fails on `main` for the re-cased and padded echoes; the exact echo is the control and
 * behaves the same on both. The model is not called (0 real requests); made-up lifts and numbers.
 */
import { describe, it, expect } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { reconcilePrescription } from '../reconcile-prescription'
import { holdStoredPlanUnderCheckin } from '../checkin-plan-hold'
import { prescribedBar } from '../../workout/load-rounding'
import { stripSpentOneShotRecord } from '@/lib/coach/domains/lift-preference'

const OWN = 'Lift p'
const ECHOES = { exact: 'Lift p', recased: 'LIFT P', padded: '  Lift p  ' } as const
const WEEK = '2026-11-23'
const SPENT = '2026-11-20T01:02:03.000Z'

/** A stored plan as generation writes it when the model echoed `echo` for the lift named `OWN`. */
function storedPlan(echo: string, over: Record<string, unknown> = {}): AiPrescription {
  const r = reconcilePrescription({
    modelPhase: 'accumulation', phaseAction: 'stay', currentPhase: 'accumulation',
    modelExercises: [{ sessionExerciseId: 'p', name: echo, sets: 4, reps: 5, pct: 77.5, restSec: 180 }],
    signalExercises: [{ sessionExerciseId: 'p', name: OWN, role: 'primary' }],
    trainingGoal: 'strength', deloadedIds: new Set(), deloadOverride: { sets: 2, reps: 5, pct: 55, restSec: 90 },
  })
  return {
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.5,
    estimatedSessionDurationMin: 55, weeklyVolumeContribution: {},
    exercises: r.exercises.map(e => ({ ...e, ...over })),
  } as unknown as AiPrescription
}

const state = (prescription: AiPrescription): SessionPeriodization => ({
  id: 'sp', userId: 'u', programSessionId: 'ps', phase: 'accumulation', phaseStartedAt: new Date(0), sessionsInPhase: 2,
  baselineComplete: true, baseline1rm: {}, prescription, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'pending', lastSessionRanPrescription: null, pendingTransition: null, preEmergencyDeloadPhase: null,
  updatedAt: new Date(0), checkinHeldWeeks: [WEEK],
}) as SessionPeriodization

/** A repository for the serve step: the check-in's hold is stored under the lift's own name, as the
 *  preferences table keys it, and the last bar is 75 kg on a 100 kg basis. */
function holdRepo() {
  const known: Record<string, (...a: never[]) => unknown> = {
    listExercisePreferences: async (_u: string, names: string[]) =>
      new Map(names.filter(nm => nm === OWN).map(nm => [nm, { repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, checkinHeld: true }])),
    getLastExerciseLogsBatch: async (_u: string, names: string[]) => new Map(names.map(nm => [nm, { estimated1rm: 100, sets: [{ weightKg: 75, reps: 5 }] }])),
    getLastRealOneRmBatch: async (_u: string, names: string[]) => new Map(names.map(nm => [nm, { estimated1rm: 100 }])),
    getExerciseEstimates: async () => [],
    listPersonalRecords: async () => new Map(),
    getExerciseEquipment: async (names: string[]) => Object.fromEntries(names.map(nm => [nm, ['barbell']])),
    getExerciseTypes: async (names: string[]) => Object.fromEntries(names.map(nm => [nm, 'weighted'])),
    replacePrescriptionIfUnchanged: async () => true,
  }
  return new Proxy({}, { get: (_t, prop: string) => known[prop] }) as WorkoutRepository
}
const MON = new Date('2026-11-23T08:00:00Z')

describe('review of #4127: a row now carries the lift\'s own name, so name-keyed serve-time rules find it', () => {
  it('the stored row carries the session\'s name whatever the model echoed', () => {
    for (const echo of Object.values(ECHOES)) expect(storedPlan(echo).exercises[0].name).toBe(OWN)
  })

  describe('(a) the check-in hold on a stored plan (the reviewer\'s probe: 75 kg hold, row at 77.5 %)', () => {
    for (const [kind, echo] of Object.entries(ECHOES)) {
      it(`the model echoed ${kind}: the row is held to 75 kg`, async () => {
        const stored = storedPlan(echo)
        expect(stored.exercises[0].pct).toBe(77.5)
        const served = await holdStoredPlanUnderCheckin('u', 'ps', holdRepo(), 'America/Los_Angeles', state(stored), MON)
        const row = served.prescription!.exercises[0]
        expect(row.pct).toBeLessThan(77.5) // 74 %: on `main` the re-cased and padded rows stayed at 77.5
        expect(prescribedBar(100, row.pct, ['barbell'])).toBeLessThanOrEqual(75)
        expect(served.prescription!.checkinHold?.rows.p).toMatchObject({ pct: 77.5, heldPct: row.pct })
      })
    }
  })

  describe('(b) a used-up one-off is stripped from the row', () => {
    const rec = { loadStep: 'lighter', oneShotSetAt: SPENT, repRange: { min: 6, max: 8 } }
    for (const [kind, echo] of Object.entries(ECHOES)) {
      it(`the model echoed ${kind}: the record loses the one-off and keeps the lasting range`, () => {
        const stored = storedPlan(echo, { liftPreference: rec })
        const out = stripSpentOneShotRecord(stored, OWN, new Date(SPENT).getTime())
        expect(out.exercises[0].liftPreference).toEqual({ repRange: { min: 6, max: 8 } })
        // Nothing else on the row moved.
        const { liftPreference: _a, ...before } = stored.exercises[0]
        const { liftPreference: _b, ...after } = out.exercises[0]
        expect(isDeepStrictEqual(after, before)).toBe(true)
      })
    }
  })
})
