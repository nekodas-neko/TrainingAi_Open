import { describe, it, expect } from 'vitest'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '@trainingai/shared/ai-periodization/reevaluate'
import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'
import type { EmergencyState } from '@trainingai/shared/ai-periodization/emergency-deload'

const ex = (id: string, overrides: Partial<AiPrescriptionExercise> = {}): AiPrescriptionExercise => ({
  sessionExerciseId: id,
  name: id,
  sets: 3,
  reps: 8,
  pct: 75,
  restSec: 90,
  ...overrides,
})

const basePrescription = (exercises: AiPrescriptionExercise[]): AiPrescription => ({
  phase: 'accumulation',
  phaseAction: 'stay',
  exercises,
  estimatedSessionDurationMin: 60,
  weeklyVolumeContribution: {},
  deload: false,
  reasoning: 'test',
  confidence: 0.8,
})

const baseState: EmergencyState = {
  phase: 'accumulation',
  prescription: null,
  prescriptionStatus: 'accepted',
  prescriptionExpiresAt: null,
}

const baseSignals: ReevaluationSignals = {
  soreMusclesInSession: [],
  hoursSinceLastSession: 48,
  activeInjuredMusclesInSession: [],
  trainingGoal: 'powerbuilding',
  illnessFlag: null,
  exercises: [
    { sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
    { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quads', role: 'main' }] },
  ],
}

describe('reevaluatePrescriptionForToday — no-op cases', () => {
  it('returns unchanged when nothing is sore and nothing was previously deloaded', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const result = reevaluatePrescriptionForToday(prescription, baseSignals, baseState)
    expect(result.changed).toBe(false)
    expect(result.needsRegenerate).toBe(false)
    expect(result.prescription).toBe(prescription)
  })
})

describe('reevaluatePrescriptionForToday — soreness clears (drops a stale deload)', () => {
  it('restores the pre-deload sets/reps/pct/restSec when soreness has cleared', () => {
    const prescription = basePrescription([
      ex('bench', {
        sets: 2, reps: 8, pct: 50, restSec: 120,
        deloaded: true, deloadNote: 'Deload — chest still sore',
        preDeload: { sets: 4, reps: 6, pct: 80, restSec: 150 },
      }),
      ex('squat'),
    ])
    // No soreness today.
    const result = reevaluatePrescriptionForToday(prescription, baseSignals, baseState)
    expect(result.changed).toBe(true)
    const bench = result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!
    expect(bench.deloaded).toBe(false)
    expect(bench.deloadNote).toBeUndefined()
    expect(bench.preDeload).toBeUndefined()
    expect(bench).toMatchObject({ sets: 4, reps: 6, pct: 80, restSec: 150 })
  })
})

describe('reevaluatePrescriptionForToday — new soreness applies a deload', () => {
  it('applies the deload override and stashes preDeload when a muscle is freshly sore', () => {
    const prescription = basePrescription([ex('bench', { sets: 4, reps: 6, pct: 80, restSec: 150 }), ex('squat')])
    const signals: ReevaluationSignals = { ...baseSignals, soreMusclesInSession: ['chest'] }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    expect(result.changed).toBe(true)
    const bench = result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!
    expect(bench.deloaded).toBe(true)
    expect(bench.deloadNote).toMatch(/chest/)
    expect(bench.preDeload).toEqual({ sets: 4, reps: 6, pct: 80, restSec: 150 })
    // Deload override values for 'powerbuilding'.
    expect(bench.sets).toBe(2)
    expect(bench.restSec).toBe(120)
    // Squat is unaffected — not sore.
    const squat = result.prescription.exercises.find(e => e.sessionExerciseId === 'squat')!
    expect(squat.deloaded).toBeUndefined()
  })

  it('flags needsRegenerate instead of returning a synthesized whole-session deload when most of the session is sore', () => {
    // Single-exercise session where the only exercise is sore -> affected.length*2 > exercises.length.
    const prescription = basePrescription([ex('bench')])
    const signals: ReevaluationSignals = {
      ...baseSignals,
      soreMusclesInSession: ['chest'],
      exercises: [{ sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] }],
    }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    expect(result.needsRegenerate).toBe(true)
    expect(result.changed).toBe(false)
    expect(result.prescription).toBe(prescription)
  })
})

describe('reevaluatePrescriptionForToday — emergency deload condition (AI-3 fix)', () => {
  it('flags needsRegenerate when hoursSinceLastSession is fresh and 3+ muscles are sore', () => {
    // A 3-exercise session with only one sore keeps per-exercise-deload from independently
    // escalating to whole_session, isolating the emergency-condition path.
    const prescription = basePrescription([ex('bench'), ex('squat'), ex('row')])
    const signals: ReevaluationSignals = {
      ...baseSignals,
      hoursSinceLastSession: 20,
      // Only 'chest' actually matches an exercise (bench) — biceps/shoulders match
      // nothing in this session, so per-exercise-deload's own whole-session escalation
      // (>half the session affected) can't independently fire; only the emergency
      // condition (length >= 3, regardless of matching) can produce needsRegenerate here.
      soreMusclesInSession: ['chest', 'biceps', 'shoulders'],
      exercises: [
        { sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
        { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quads', role: 'main' }] },
        { sessionExerciseId: 'row', name: 'Row', muscleAssignments: [{ muscle: 'upper back', role: 'main' }] },
      ],
    }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    expect(result.needsRegenerate).toBe(true)
  })

  it('does not trigger emergency when hoursSinceLastSession is null (unknown, not "just trained")', () => {
    // Only one exercise sore (of two) so the per-exercise-deload whole-session escalation
    // doesn't independently trigger needsRegenerate — isolates the emergency-only path.
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const signals: ReevaluationSignals = {
      ...baseSignals,
      hoursSinceLastSession: null,
      soreMusclesInSession: ['chest'],
    }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    expect(result.needsRegenerate).toBe(false)
  })

  it('is suppressed while phase is already deload', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const signals: ReevaluationSignals = {
      ...baseSignals,
      hoursSinceLastSession: 20,
      soreMusclesInSession: ['chest', 'quads', 'shoulders'],
    }
    const result = reevaluatePrescriptionForToday(prescription, signals, { ...baseState, phase: 'deload' })
    expect(result.needsRegenerate).toBe(false)
  })
})

describe('reevaluatePrescriptionForToday — still-sore refreshes the note only', () => {
  it('updates deloadNote wording without re-applying the override values', () => {
    const prescription = basePrescription([
      ex('bench', {
        sets: 2, reps: 8, pct: 50, restSec: 120,
        deloaded: true, deloadNote: 'Deload — chest still sore',
        preDeload: { sets: 4, reps: 6, pct: 80, restSec: 150 },
      }),
    ])
    const signals: ReevaluationSignals = {
      ...baseSignals,
      soreMusclesInSession: ['pecs'], // different label, still matches 'chest' muscle group
      exercises: [{ sessionExerciseId: 'bench', name: 'Bench Press', muscleAssignments: [{ muscle: 'chest', role: 'main' }] }],
    }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    const bench = result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!
    expect(bench.deloaded).toBe(true)
    expect(bench.preDeload).toEqual({ sets: 4, reps: 6, pct: 80, restSec: 150 })
    // Values are untouched (not re-applied) while it stays deloaded across a refresh.
    expect(bench.sets).toBe(2)
  })
})

describe('reevaluatePrescriptionForToday — illness radar', () => {
  it('deloads every exercise in place on "elevated" without regenerating', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const result = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: 'elevated' }, baseState)
    expect(result.needsRegenerate).toBe(false)
    expect(result.changed).toBe(true)
    for (const e of result.prescription.exercises) {
      expect(e.deloaded).toBe(true)
      expect(e.deloadNote).toBe('Deload — illness radar: elevated')
      expect(e.preDeload).toBeDefined()
    }
  })

  it('restores preDeload values once the flag clears (self-reverting)', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const sick = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: 'fever' }, baseState)
    const recovered = reevaluatePrescriptionForToday(sick.prescription, baseSignals, baseState)
    expect(recovered.changed).toBe(true)
    for (const [i, e] of recovered.prescription.exercises.entries()) {
      expect(e.deloaded).toBe(false)
      expect(e.sets).toBe(prescription.exercises[i].sets)
      expect(e.pct).toBe(prescription.exercises[i].pct)
    }
  })

  it('keeps the soreness note where an exercise is both sore and illness-flagged', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    const result = reevaluatePrescriptionForToday(
      prescription, { ...baseSignals, soreMusclesInSession: ['chest'], illnessFlag: 'elevated' }, baseState)
    const bench = result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!
    const squat = result.prescription.exercises.find(e => e.sessionExerciseId === 'squat')!
    expect(bench.deloadNote).toContain('sore')
    expect(squat.deloadNote).toBe('Deload — illness radar: elevated')
  })

  it('does nothing on "watch"/"learning"/"normal"', () => {
    const prescription = basePrescription([ex('bench'), ex('squat')])
    for (const flag of ['watch', 'learning', 'normal'] as const) {
      const result = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: flag }, baseState)
      expect(result.changed).toBe(false)
    }
  })
})

// Q-229. `prescriptionExpiresAt` was written at generation and then read in exactly one place —
// the emergency-deload suppression, which only asks whether a still-*pending* offer is still on
// the table. Nothing ever aged out a prescription the lifter was actually training against, so a
// session type left unused past its own window replayed its last AI numbers indefinitely. The
// owner hit it as an 8-day-old deload-era 52% served on a live Intensification day.
//
// The dates here are all derived from the clock rather than written down: a fixture pinned to an
// absolute date is a time bomb when the other side of the comparison is `now` (the
// scale-ble-day-keying lesson).
describe('reevaluatePrescriptionForToday — an applied prescription ages out (Q-229)', () => {
  const NOW = new Date('2026-08-14T03:00:00Z')
  const expired = new Date(NOW.getTime() - 60_000)
  const live = new Date(NOW.getTime() + 7 * 86_400_000)
  const prescription = basePrescription([ex('bench'), ex('squat')])

  for (const status of ['auto_applied', 'accepted', 'consumed'] as const) {
    it(`flags needsRegenerate for a ${status} prescription past its expiry`, () => {
      const result = reevaluatePrescriptionForToday(prescription, baseSignals,
        { ...baseState, prescriptionStatus: status, prescriptionExpiresAt: expired }, NOW)
      expect(result.needsRegenerate).toBe(true)
      // The caller keeps serving what it has while the regenerate runs in the background, so the
      // prescription must come back untouched rather than blanked.
      expect(result.prescription).toBe(prescription)
      expect(result.changed).toBe(false)
    })
  }

  it('leaves an unexpired prescription alone', () => {
    const result = reevaluatePrescriptionForToday(prescription, baseSignals,
      { ...baseState, prescriptionStatus: 'auto_applied', prescriptionExpiresAt: live }, NOW)
    expect(result.needsRegenerate).toBe(false)
  })

  it('does not age out a prescription with no expiry recorded', () => {
    const result = reevaluatePrescriptionForToday(prescription, baseSignals,
      { ...baseState, prescriptionStatus: 'auto_applied', prescriptionExpiresAt: null }, NOW)
    expect(result.needsRegenerate).toBe(false)
  })

  // A `pending` prescription is an OFFER, and its expiry already means something else: it is what
  // shouldTriggerEmergencyDeload reads to decide whether to stop re-offering. Ageing it out here
  // too would have this function and that one racing over one field for two purposes.
  it('does not age out a pending offer — that expiry belongs to the emergency-deload suppression', () => {
    const offer = { ...basePrescription([ex('bench')]), deload: true, phaseAction: 'deload_recommended' as const }
    const result = reevaluatePrescriptionForToday(offer, baseSignals,
      { ...baseState, prescription: offer, prescriptionStatus: 'pending', prescriptionExpiresAt: expired }, NOW)
    expect(result.needsRegenerate).toBe(false)
  })

  // Expiry is checked before the soreness re-derivation, so an expired prescription regenerates
  // rather than being patched — otherwise a stale plan could be "refreshed" into looking current.
  it('regenerates rather than re-deriving deloads when both would apply', () => {
    const sore = { ...baseSignals, soreMusclesInSession: ['chest'] }
    const result = reevaluatePrescriptionForToday(prescription, sore,
      { ...baseState, prescriptionStatus: 'auto_applied', prescriptionExpiresAt: expired }, NOW)
    expect(result.needsRegenerate).toBe(true)
    expect(result.changed).toBe(false)
  })
})

// #2402. `!isDeloaded && wasDeloaded && preDeload` reads as "the soreness or illness that deloaded
// this exercise has cleared, put it back". That is right for a row THIS function deloaded. But a
// whole-session deload (BF-198) and a deload PHASE (the rules fallback since #2512) also record
// `deloaded` + `preDeload` per row, and nothing here is flagging those rows: per-exercise deloads
// are off in a deload phase by design. So the very first read of the day turned a stored 2×6 @ 50%
// back into 3×8 @ 75% and wrote it back, while the bar kept deloading it. The card then described
// a session that never runs, which is the bug #2402 was filed for, arriving through a second door.
describe('reevaluatePrescriptionForToday — a whole-session or phase deload is not "soreness cleared" (#2402)', () => {
  const deloadedRow = (id: string) => ex(id, {
    sets: 2, reps: 6, pct: 50, restSec: 120, deloaded: true,
    preDeload: { sets: 3, reps: 8, pct: 75, restSec: 90 },
  })

  it('leaves the rows of a deload PHASE prescription deloaded', () => {
    const prescription = { ...basePrescription([deloadedRow('bench'), deloadedRow('squat')]), phase: 'deload' as const, deload: true }
    const result = reevaluatePrescriptionForToday(prescription, baseSignals, { ...baseState, phase: 'deload' })
    expect(result.changed).toBe(false)
    expect(result.prescription).toBe(prescription)
    expect(result.prescription.exercises.every(e => e.deloaded === true && e.sets === 2 && e.pct === 50)).toBe(true)
  })

  it('leaves the rows of a whole-session deload prescription alone even before the phase flips', () => {
    // An emergency deload is generated while the phase is still accumulation; accepting it flips
    // the phase later. Until then the stored plan is the deload and must read as one.
    const prescription = { ...basePrescription([deloadedRow('bench'), deloadedRow('squat')]), deload: true, phaseAction: 'deload_recommended' as const }
    const result = reevaluatePrescriptionForToday(
      prescription, baseSignals, { ...baseState, prescriptionStatus: 'auto_applied' },
    )
    expect(result.changed).toBe(false)
    expect(result.prescription.exercises.every(e => e.deloaded === true)).toBe(true)
  })

  it('still reverts a per-exercise deload once its soreness clears (unchanged)', () => {
    const prescription = basePrescription([deloadedRow('bench'), ex('squat')])
    const result = reevaluatePrescriptionForToday(prescription, baseSignals, baseState)
    expect(result.changed).toBe(true)
    expect(result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')).toMatchObject({ sets: 3, reps: 8, pct: 75, deloaded: false })
  })

  it('still refreshes the note on a deload-phase row that is flagged sore', () => {
    // Per-exercise deloads are off in a deload phase, so nothing is flagged and nothing changes;
    // the guard must not stop the other two branches from running for rows that ARE flagged.
    const prescription = basePrescription([deloadedRow('bench'), ex('squat')])
    const signals: ReevaluationSignals = { ...baseSignals, soreMusclesInSession: ['chest'] }
    const result = reevaluatePrescriptionForToday(prescription, signals, baseState)
    expect(result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!.deloaded).toBe(true)
  })
})
