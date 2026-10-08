// Issue 2592: a consumption-day deload or revert moves rows, so the stored "~N min of work" and the
// weekly-volume pills are costed again over the new rows — through `prescriptionFigures`, the one
// implementation, never a second estimate.
import { describe, it, expect } from 'vitest'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '@trainingai/shared/ai-periodization/reevaluate'
import {
  prescriptionFigures, rowUnderFull, recostPrescription, fullSessionAlongside, type FigureSignals,
} from '@trainingai/shared/ai-periodization/prescription-figures'
import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'
import type { EmergencyState } from '@trainingai/shared/ai-periodization/emergency-deload'
import { prescriptionFiguresAsTrained } from '@/components/workout/utils'

const FULL = { sets: 4, reps: 6, pct: 80, restSec: 150 }
const ex = (id: string, over: Partial<AiPrescriptionExercise> = {}): AiPrescriptionExercise =>
  ({ sessionExerciseId: id, name: id, ...FULL, ...over })

const figureSignals: FigureSignals = {
  exercises: [
    { sessionExerciseId: 'bench', muscleAssignments: [{ muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }], timeProfile: null, transitionSec: 180 },
    { sessionExerciseId: 'squat', muscleAssignments: [{ muscle: 'Quads', role: 'main' }], timeProfile: null, transitionSec: 240 },
  ],
}

/** A stored prescription whose figures were produced by the one function over the given rows. */
function stored(rows: AiPrescriptionExercise[], extra: Partial<AiPrescription> = {}): AiPrescription {
  return {
    phase: 'accumulation', phaseAction: 'stay', exercises: rows, deload: false, reasoning: 'r', confidence: 0.8,
    ...prescriptionFigures(rows, figureSignals), ...extra,
  }
}

const state: EmergencyState = { phase: 'accumulation', prescription: null, prescriptionStatus: 'accepted', prescriptionExpiresAt: null }
const signals = (over: Partial<ReevaluationSignals> = {}): ReevaluationSignals => ({
  soreMusclesInSession: [], hoursSinceLastSession: 48, activeInjuredMusclesInSession: [], trainingGoal: 'powerbuilding',
  illnessFlag: null, selfReportedSick: false,
  exercises: [
    { sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
    { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quads', role: 'main' }] },
  ],
  ...over,
})
const NOW = new Date('2026-10-08T00:00:00Z')

describe('re-evaluation re-costs the figures when rows move', () => {
  it('sore muscle: minutes and pills drop, and equal prescriptionFigures over the same rows', () => {
    const before = stored([ex('bench'), ex('squat')])
    const r = reevaluatePrescriptionForToday(before, signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals)
    expect(r.changed).toBe(true)
    const after = r.prescription
    expect(after.exercises.find(e => e.sessionExerciseId === 'bench')!.deloaded).toBe(true)
    expect(after.estimatedSessionDurationMin).toBeLessThan(before.estimatedSessionDurationMin)
    expect(after.weeklyVolumeContribution.chest).toBeLessThan(before.weeklyVolumeContribution.chest)
    expect(after.weeklyVolumeContribution.quads).toBe(before.weeklyVolumeContribution.quads)
    const { estimatedSessionDurationMin, weeklyVolumeContribution } = prescriptionFigures(after.exercises, figureSignals)
    expect(after.estimatedSessionDurationMin).toBe(estimatedSessionDurationMin)
    expect(after.weeklyVolumeContribution).toEqual(weeklyVolumeContribution)
  })

  it('clearing soreness reverts the figures to the full session\'s', () => {
    const full = [ex('bench'), ex('squat')]
    const fullFigures = prescriptionFigures(full, figureSignals)
    const sore = reevaluatePrescriptionForToday(stored(full), signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals).prescription
    const cleared = reevaluatePrescriptionForToday(sore, signals(), state, NOW, figureSignals)
    expect(cleared.changed).toBe(true)
    expect(cleared.prescription.estimatedSessionDurationMin).toBe(fullFigures.estimatedSessionDurationMin)
    expect(cleared.prescription.weeklyVolumeContribution).toEqual(fullFigures.weeklyVolumeContribution)
    expect(cleared.prescription.fullSession).toBeUndefined()
  })

  it('illness fever deloads every row and re-costs', () => {
    const before = stored([ex('bench'), ex('squat')])
    const r = reevaluatePrescriptionForToday(before, signals({ illnessFlag: 'fever' }), state, NOW, figureSignals)
    expect(r.prescription.exercises.every(e => e.deloaded)).toBe(true)
    expect(r.prescription.estimatedSessionDurationMin).toBeLessThan(before.estimatedSessionDurationMin)
    expect(r.prescription.weeklyVolumeContribution.chest).toBeLessThan(before.weeklyVolumeContribution.chest)
  })

  it('fullSession describes the full session before and after, untouched in value', () => {
    const full = [ex('bench'), ex('squat')]
    const fullFigures = prescriptionFigures(full, figureSignals)
    const sore = reevaluatePrescriptionForToday(stored(full), signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals).prescription
    expect(sore.fullSession).toEqual(fullFigures)
    // A prescription that already carried it keeps the same value after a further move.
    const both = reevaluatePrescriptionForToday(sore, signals({ soreMusclesInSession: ['chest', 'quads'], exercises: signals().exercises }), state, NOW, figureSignals)
    expect(both.prescription.fullSession).toEqual(fullFigures)
  })

  it('a re-evaluation that changes nothing leaves the figures byte-identical', () => {
    const before = stored([ex('bench'), ex('squat')])
    const r = reevaluatePrescriptionForToday(before, signals(), state, NOW, figureSignals)
    expect(r.changed).toBe(false)
    expect(r.prescription).toBe(before)
  })

  it('a note-only refresh leaves the figures alone', () => {
    const sore = reevaluatePrescriptionForToday(stored([ex('bench'), ex('squat')]), signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals).prescription
    // Stale hand-set figures survive: nothing moved, so nothing is re-costed.
    const odd = { ...sore, estimatedSessionDurationMin: 99, exercises: sore.exercises.map(e => ({ ...e, deloadNote: 'old' })) }
    const r = reevaluatePrescriptionForToday(odd, signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals)
    expect(r.changed).toBe(true)
    expect(r.prescription.estimatedSessionDurationMin).toBe(99)
  })

  it('the cheap path without figure signals is byte-identical to before', () => {
    const before = stored([ex('bench'), ex('squat')])
    const withFigs = reevaluatePrescriptionForToday(before, signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals)
    const without = reevaluatePrescriptionForToday(before, signals({ soreMusclesInSession: ['chest'] }), state, NOW)
    expect(without.prescription.estimatedSessionDurationMin).toBe(before.estimatedSessionDurationMin)
    expect(without.prescription.weeklyVolumeContribution).toBe(before.weeklyVolumeContribution)
    expect(without.prescription.fullSession).toBeUndefined()
    expect({ ...withFigs.prescription, estimatedSessionDurationMin: 0, weeklyVolumeContribution: {}, fullSession: undefined })
      .toEqual({ ...without.prescription, estimatedSessionDurationMin: 0, weeklyVolumeContribution: {}, fullSession: undefined })
  })

  it('never writes zeros or NaN: a signal set that cannot cost the rows keeps the stored figures', () => {
    const before = stored([ex('bench'), ex('squat')])
    const broken: FigureSignals = { exercises: [{ ...figureSignals.exercises[0], transitionSec: Number.NaN }] }
    expect(recostPrescription(before, broken)).toBe(before)
  })
})

describe('Full override display after a same-day deload', () => {
  it('shows the full figures under Full and the deload figures otherwise', () => {
    const full = [ex('bench'), ex('squat')]
    const sore = reevaluatePrescriptionForToday(stored(full), signals({ soreMusclesInSession: ['chest'] }), state, NOW, figureSignals).prescription
    expect(prescriptionFiguresAsTrained(sore, true)).toEqual(prescriptionFigures(full, figureSignals))
    expect(prescriptionFiguresAsTrained(sore, false)).toEqual(prescriptionFigures(sore.exercises, figureSignals))
  })
})

describe('Workout Review apply figures', () => {
  it('fullSessionAlongside adds only what Full changes to the stored whole-session figures', () => {
    const rows = [
      ex('bench', { sets: 2, reps: 8, pct: 50, restSec: 120, deloaded: true, preDeload: FULL }),
      ex('squat'),
    ]
    const storedFigures = { estimatedSessionDurationMin: 50, weeklyVolumeContribution: { chest: 2, quads: 4, back: 6 } }
    const f = fullSessionAlongside(rows, storedFigures, figureSignals)!
    const asIs = prescriptionFigures(rows, figureSignals)
    const full = prescriptionFigures(rows.map(rowUnderFull), figureSignals)
    expect(f.estimatedSessionDurationMin).toBe(50 + full.estimatedSessionDurationMin - asIs.estimatedSessionDurationMin)
    expect(f.weeklyVolumeContribution).toEqual({ chest: 4, triceps: 1, quads: 4, back: 6 })
    expect(fullSessionAlongside([ex('bench'), ex('squat')], storedFigures, figureSignals)).toBeNull()
  })
})
