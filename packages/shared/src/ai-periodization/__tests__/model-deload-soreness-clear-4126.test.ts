/**
 * #4126: a deload the MODEL wrote lightens to the engine's override on a sore read and replaces its note with
 * the soreness reason. When a later read finds nothing sore the row, its note and the plan's `fullSession` go
 * back to what generation stored. Pure functions, no model (0 real calls); made-up lifts and numbers.
 */
import { describe, it, expect } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import { recordFullSessionOnModelDeload, MODEL_DELOAD_NOTE } from '../generate-prescription'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '../reevaluate'
import { holdStoredPrescription } from '../checkin-plan-hold'
import { restatePlan } from '../lift-preference-restate'
import { rowUnderFull, prescriptionFigures } from '../prescription-figures'

const NOW = new Date('2026-11-25T12:00:00+10:00')
const ids = ['p', 's', 'a'] as const
const exercise = (id: string, role: string, muscle: string) => ({
  sessionExerciseId: id, name: `Lift ${id}`, role, muscleGroups: [muscle], muscleAssignments: [{ muscle, role: 'main' as const }],
  baseline1rm: 100, current1rm: 100, latest1rm: 100, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: ['barbell'], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [0, 1, 2].map(() => ({ pct: 75, reps: 6, restSec: 150 })),
})
const sig = {
  trainingGoal: 'strength', phase: 'accumulation', effectiveTimeBudgetMin: 90, sessionTimeBudgetMinutes: 90,
  exercises: [exercise('p', 'primary', 'quadriceps'), exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps')],
  checkinHold: null,
} as unknown as PrescriptionSignals

const modelPlan = (): AiPrescription => ({
  phase: 'accumulation', phaseAction: 'deload_recommended', deload: true, reasoning: 'r', confidence: 0.5,
  estimatedSessionDurationMin: 20, weeklyVolumeContribution: {},
  exercises: [
    { sessionExerciseId: 'p', name: 'Lift p', sets: 3, reps: 6, pct: 55, restSec: 90 },
    { sessionExerciseId: 's', name: 'Lift s', sets: 3, reps: 8, pct: 55, restSec: 90 },
    { sessionExerciseId: 'a', name: 'Lift a', sets: 3, reps: 12, pct: 45, restSec: 60 },
  ],
} as unknown as AiPrescription)
/** What generation stores for a deload the model wrote. */
const generated = (): AiPrescription => {
  const g = recordFullSessionOnModelDeload(modelPlan(), sig, 'accumulation')
  // The two whole-session figures as generation costs them (`prescriptionFigures`), which is also how a re-read re-costs them.
  return { ...g, ...prescriptionFigures(g.exercises, sig) }
}

const quiet: ReevaluationSignals = {
  soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 48, activeInjuredMusclesInSession: [],
  trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
  exercises: ids.map(id => ({ sessionExerciseId: id, name: `Lift ${id}`, muscleAssignments: [{ muscle: id === 'p' ? 'quadriceps' : id === 's' ? 'back' : 'biceps', role: 'main' as const }] })),
}
const sore = (...m: string[]): ReevaluationSignals => ({ ...quiet, soreMusclesInSession: m })
const sick: ReevaluationSignals = { ...quiet, illnessFlag: 'elevated' }

const read = (plan: AiPrescription, s: ReevaluationSignals, now = NOW, underWay = false): AiPrescription => {
  const out = reevaluatePrescriptionForToday(plan, s, {
    phase: 'accumulation', prescription: plan, prescriptionStatus: 'auto_applied',
    prescriptionExpiresAt: new Date(NOW.getTime() + 5 * 86_400_000), sessionsInPhase: 2, underWay,
  }, now, sig)
  expect(out.needsRegenerate).toBe(false)
  return out.prescription
}
const bytes = (p: AiPrescription) => JSON.stringify(p)
const row = (p: AiPrescription, id: string) => p.exercises.find(e => e.sessionExerciseId === id)!
const lighterOrEqual = (p: AiPrescription, g: AiPrescription) => {
  for (const e of p.exercises) {
    const w = row(g, e.sessionExerciseId)
    expect(e.sets).toBeLessThanOrEqual(w.sets)
    expect(e.pct).toBeLessThanOrEqual(w.pct)
  }
}

describe('4126 — the reproduction', () => {
  it('sore then clear: 3 × 6 @ 55 → lightened → back, with the note, byte for byte', () => {
    const g = generated()
    expect(row(g, 'p')).toMatchObject({ sets: 3, pct: 55, deloadNote: MODEL_DELOAD_NOTE })
    const s = read(g, sore('Quadriceps'))
    expect(row(s, 'p').sets).toBeLessThan(3)
    expect(row(s, 'p').pct).toBeLessThan(55)
    expect(row(s, 'p').deloadNote).toMatch(/sore/i)
    const c = read(s, quiet)
    expect(bytes(c)).toBe(bytes(g))
    expect(c.fullSession).toEqual(g.fullSession)
  })

  it('rows the soreness never touched are not changed by either read', () => {
    const g = generated()
    const s = read(g, sore('Quadriceps'))
    expect(s.exercises.filter(e => e.sessionExerciseId !== 'p')).toEqual(g.exercises.filter(e => e.sessionExerciseId !== 'p'))
    expect(s.exercises.filter(e => e.sessionExerciseId !== 'p').every(e => e.preSoreness === undefined)).toBe(true)
  })
})

describe('4126 — the sequences', () => {
  it('sore → sore (another muscle) → clear', () => {
    const g = generated()
    expect(bytes(read(read(read(g, sore('Quadriceps')), sore('Back')), quiet))).toBe(bytes(g))
  })
  it('sore → sick → clear', () => {
    const g = generated()
    const s = read(read(g, sore('Quadriceps')), sick)
    lighterOrEqual(s, g)
    expect(bytes(read(s, quiet))).toBe(bytes(g))
  })
  it('sore → illness first, then sore → clear', () => {
    const g = generated()
    expect(bytes(read(read(read(g, sick), sore('Quadriceps')), quiet))).toBe(bytes(g))
  })
  it('sore → "Train full instead" → clear: Full reads the recorded program numbers, and storage is untouched', () => {
    const g = generated()
    const s = read(g, sore('Quadriceps'))
    const full = s.exercises.map(rowUnderFull)
    expect(full.map(e => e.deloaded)).toEqual([false, false, false])
    expect(row(s, 'p').preDeload).toEqual(row(g, 'p').preDeload)
    expect(bytes(read(s, quiet))).toBe(bytes(g))
  })
  it('sore → Coach rep-range change → clear: the deload row is left alone by the restate, and clears to what was generated', () => {
    const g = generated()
    const s = read(g, sore('Quadriceps'))
    const ctx = { slots: [{ programSessionId: 'push', sessionExerciseId: 'p', role: 'primary' }], trainingGoal: 'strength', bodyweight: false, basisKg: 100, equipment: ['barbell'] }
    const restated = restatePlan(ctx as never, { programSessionId: 'push', phase: 'accumulation', prescription: s },
      { repRange: { min: 9, max: 10 }, restSec: null, loadStep: null, setsDelta: null } as never)
    expect(row(restated, 'p')).toMatchObject({ sets: row(s, 'p').sets, reps: row(s, 'p').reps, pct: row(s, 'p').pct })
    const c = read(restated, quiet)
    for (const e of c.exercises) { const w = row(g, e.sessionExerciseId); expect(e.sets).toBeLessThanOrEqual(w.sets); expect(e.pct).toBeLessThanOrEqual(w.pct) }
    expect(row(c, 'p').deloadNote).toBe(MODEL_DELOAD_NOTE)
    expect(row(c, 'p').preSoreness).toBeUndefined()
  })
  it('sore → the weekly check-in "Heavy" saved → clear: a deload plan is not held, and the clear is exact', () => {
    const g = generated()
    const s = read(g, sore('Quadriceps'))
    const held = holdStoredPrescription(s, '2026-11-23', () => ({
      preference: { repRange: null, restSec: null, oneShot: null, checkinHold: { weekStart: '2026-11-23', barKg: 40 } } as never,
      basisKg: 100, equipment: ['barbell'], bodyweight: false,
    }))
    expect(held).toBe(s)
    expect(bytes(read(held, quiet))).toBe(bytes(g))
  })
  it('sore on day 1, nothing sore on day 2 (a new local day)', () => {
    const g = generated()
    const day2 = new Date(NOW.getTime() + 86_400_000)
    expect(bytes(read(read(g, sore('Quadriceps')), quiet, day2))).toBe(bytes(g))
  })
  it('two reads in the same second change nothing the second time, and the clear still restores', () => {
    const g = generated()
    const a = read(g, sore('Quadriceps'))
    const b = read(a, sore('Quadriceps'), new Date(NOW.getTime() + 500))
    expect(bytes(b)).toBe(bytes(a))
    expect(bytes(read(b, quiet))).toBe(bytes(g))
    expect(bytes(read(read(g, quiet), quiet))).toBe(bytes(g))
  })
  it('a session under way: the whole-session soreness lightens every row, and the clear restores them', () => {
    const g = generated()
    const s = read(g, sore('Quadriceps', 'Back', 'Biceps'), NOW, true)
    lighterOrEqual(s, g)
    expect(bytes(read(s, quiet, NOW, true))).toBe(bytes(g))
  })
})

describe('4126 — a plan stored before this change', () => {
  it('a lightened row with no record reads without error and stays as it is (no worse than today)', () => {
    const g = generated()
    const legacy = { ...g, exercises: g.exercises.map(e => e.sessionExerciseId === 'p' ? { ...e, sets: 2, pct: 50, deloadNote: 'Deload — quads still sore' } : e) }
    const c = read(legacy, quiet)
    expect(bytes(c)).toBe(bytes(legacy))
  })
})

describe('4126 — a row that carries both records', () => {
  it('the revert to the full numbers (`preDeload`) also removes `preSoreness`, so it cannot be restored later', () => {
    const g = generated()
    // A lightened model-deload row that also carries the full numbers the engine would revert to.
    const both = {
      ...g,
      deload: false,
      exercises: g.exercises.map(e => e.sessionExerciseId === 'p'
        ? { ...e, sets: 2, pct: 50, deloaded: true, deloadNote: 'Deload — quads still sore',
            preDeload: { sets: 3, reps: 6, pct: 75, restSec: 150 }, preSoreness: { sets: 3, reps: 6, pct: 55, restSec: 90, deloadNote: MODEL_DELOAD_NOTE } }
        : e),
    } as AiPrescription
    const out = reevaluatePrescriptionForToday(both, quiet, {
      phase: 'accumulation', prescription: both, prescriptionStatus: 'auto_applied',
      prescriptionExpiresAt: new Date(NOW.getTime() + 5 * 86_400_000), sessionsInPhase: 2, underWay: false,
    }, NOW, sig)
    const r = row(out.prescription, 'p')
    expect(r).toMatchObject({ sets: 3, reps: 6, pct: 75, restSec: 150, deloaded: false })
    expect(r.preDeload).toBeUndefined()
    expect('preSoreness' in r && r.preSoreness !== undefined).toBe(false)
  })
})
