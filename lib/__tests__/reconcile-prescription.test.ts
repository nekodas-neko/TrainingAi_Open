import { describe, it, expect } from 'vitest'
import {
  normalizePctFraction,
  resolvePhase,
  resolvePhaseAction,
  normalizeStoredPrescription,
  reconcilePrescriptionExercises,
  reconcilePrescription,
  MIN_WORKING_SETS,
  type ReconcileExercise,
  type ReconcileSignalExercise,
} from '@trainingai/shared/ai-periodization/reconcile-prescription'

const ex = (id: string, over: Partial<ReconcileExercise> = {}): ReconcileExercise => ({
  sessionExerciseId: id, name: id, sets: 4, reps: 6, pct: 75, restSec: 120, ...over,
})
const sig = (id: string, role = 'primary', name = id): ReconcileSignalExercise => ({
  sessionExerciseId: id, name, role,
})

describe('normalizePctFraction', () => {
  it('promotes a 0-1 fraction to a percentage', () => {
    expect(normalizePctFraction(0.74)).toBe(74)
  })
  it('leaves an already-percentage value alone', () => {
    expect(normalizePctFraction(75)).toBe(75)
  })
  it('does NOT promote exactly 1 — genuinely ambiguous, must not become the dangerous 100%', () => {
    expect(normalizePctFraction(1)).toBe(1)
  })
})

describe('resolvePhase', () => {
  it('forces the current phase when phase_action is "stay", ignoring a hallucinated model phase', () => {
    expect(resolvePhase('realisation', 'stay', 'accumulation')).toBe('accumulation')
  })
  it('trusts the model phase for any non-"stay" action', () => {
    expect(resolvePhase('intensification', 'transition_recommended', 'accumulation')).toBe('intensification')
  })
})

describe('reconcilePrescriptionExercises — drop / dedupe / backfill', () => {
  const signals = [sig('bench'), sig('row'), sig('curl', 'accessory')]

  it('drops a hallucinated session_exercise_id not present in signals', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('row'), ex('curl'), ex('ghost-id')],
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.exercises.map(e => e.sessionExerciseId).sort()).toEqual(['bench', 'curl', 'row'])
    expect(out.droppedIds).toEqual(['ghost-id'])
  })

  it('de-dupes a repeated id, keeping the first occurrence (matches workout-data\'s own .find)', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench', { sets: 4 }), ex('bench', { sets: 8 }), ex('row'), ex('curl')],
      signals, 'hypertrophy', 'accumulation',
    )
    const bench = out.exercises.filter(e => e.sessionExerciseId === 'bench')
    expect(bench).toHaveLength(1)
    expect(bench[0].sets).toBe(4)
  })

  it('backfills an omitted exercise with deterministic zone-midpoint defaults, not a zero/null entry', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('row')], // 'curl' omitted
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.backfilledIds).toEqual(['curl'])
    const curl = out.exercises.find(e => e.sessionExerciseId === 'curl')
    expect(curl).toBeDefined()
    expect(curl!.sets).toBeGreaterThan(0)
    expect(curl!.reps).toBeGreaterThan(0)
    expect(curl!.pct).toBeGreaterThan(0)
    expect(curl!.restSec).toBeGreaterThan(0)
  })

  it('never returns fewer exercises than signals has, and never more unique ids than signals has', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('bench'), ex('ghost')], // dupe + hallucination + 'row'/'curl' omitted
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.exercises).toHaveLength(signals.length)
    expect(new Set(out.exercises.map(e => e.sessionExerciseId)).size).toBe(signals.length)
  })
})

describe('reconcilePrescription — the composed pass (the known live incident)', () => {
  const signals = [sig('bench'), sig('row')]
  const deloadOverride = { sets: 2, reps: 10, pct: 50, restSec: 120 }

  it('a model-omitted, deterministically-deloaded exercise gets the DELOAD override, not the zone-midpoint default', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench')], // 'row' omitted by the model, AND it's sore/deloaded
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(['row']),
      deloadOverride,
    })
    const row = out.exercises.find(e => e.sessionExerciseId === 'row')
    expect(row).toMatchObject(deloadOverride)
    expect(out.backfilledIds).toContain('row')
  })

  it('a deloaded exercise the model DID echo still gets overridden by the deterministic values, and its pre-deload numbers are preserved', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row', { sets: 5, reps: 8, pct: 82, restSec: 90 })],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(['row']),
      deloadOverride,
    })
    const row = out.exercises.find(e => e.sessionExerciseId === 'row')
    expect(row).toMatchObject(deloadOverride)
    expect(out.preDeloadById.get('row')).toMatchObject({ sets: 5, reps: 8, pct: 82, restSec: 90 })
  })

  it('forces the current phase on a "stay" response even if the model hallucinated a different phase', () => {
    const out = reconcilePrescription({
      modelPhase: 'realisation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.phase).toBe('accumulation')
  })

  it('normalizes an ambiguous pct===1 to the safe (floor) end via the 30-100 clamp, not 100%', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench', { pct: 1 }), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.exercises.find(e => e.sessionExerciseId === 'bench')!.pct).toBe(30)
  })

  it('raises a model-authored single-set exercise to the working-set floor', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench', { sets: 1 }), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.exercises.find(e => e.sessionExerciseId === 'bench')!.sets).toBe(MIN_WORKING_SETS)
    expect(out.exercises.find(e => e.sessionExerciseId === 'row')!.sets).toBe(4)
  })

  it('downgrades a no-op transition to "stay" and keeps the current phase', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'transition_recommended',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.phaseAction).toBe('stay')
    expect(out.phase).toBe('accumulation')
  })

  it('leaves a genuine transition intact', () => {
    const out = reconcilePrescription({
      modelPhase: 'intensification',
      phaseAction: 'transition_recommended',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.phaseAction).toBe('transition_recommended')
    expect(out.phase).toBe('intensification')
  })
})

describe('normalizeStoredPrescription', () => {
  const presc = (over: Record<string, unknown> = {}) => ({
    phase: 'accumulation' as const,
    phaseAction: 'stay',
    exercises: [
      { sessionExerciseId: 'a', sets: 4, pct: 80 },
      { sessionExerciseId: 'b', sets: 3, pct: 70 },
    ],
    ...over,
  })

  it('returns the SAME object when there is nothing to correct', () => {
    const p = presc()
    expect(normalizeStoredPrescription(p, 'accumulation')).toBe(p)
  })

  it('downgrades a stored no-op transition on read', () => {
    const out = normalizeStoredPrescription(
      presc({ phaseAction: 'transition_recommended' }), 'accumulation')
    expect(out.phaseAction).toBe('stay')
  })

  it('leaves a stored genuine transition alone', () => {
    const out = normalizeStoredPrescription(
      presc({ phase: 'intensification', phaseAction: 'transition_recommended' }), 'accumulation')
    expect(out.phaseAction).toBe('transition_recommended')
  })

  // Four single-set exercises were live on 2026-07-28, one of them on an auto_applied session
  // — i.e. actually loading the bar. The generation-time floor cannot reach a stored row.
  it('raises a stored single-set exercise to the floor', () => {
    const out = normalizeStoredPrescription(
      presc({ exercises: [{ sessionExerciseId: 'a', sets: 1 }, { sessionExerciseId: 'b', sets: 3 }] }),
      'accumulation')
    expect(out.exercises.map(e => e.sets)).toEqual([MIN_WORKING_SETS, 3])
  })

  it('corrects both a no-op transition and a single set in one pass', () => {
    const out = normalizeStoredPrescription(
      presc({
        phaseAction: 'transition_recommended',
        exercises: [{ sessionExerciseId: 'a', sets: 1 }],
      }),
      'accumulation')
    expect(out.phaseAction).toBe('stay')
    expect(out.exercises[0].sets).toBe(MIN_WORKING_SETS)
  })

  it('never lowers a set count', () => {
    const out = normalizeStoredPrescription(
      presc({ exercises: [{ sessionExerciseId: 'a', sets: 6 }] }), 'accumulation')
    expect(out.exercises[0].sets).toBe(6)
  })

  it('tolerates a prescription with no exercises array', () => {
    const p = { phase: 'accumulation' as const, phaseAction: 'stay' }
    expect(normalizeStoredPrescription(p, 'accumulation')).toBe(p)
  })
})

describe('resolvePhaseAction', () => {
  it('downgrades transition_recommended when the target equals the current phase', () => {
    expect(resolvePhaseAction('accumulation', 'transition_recommended', 'accumulation')).toBe('stay')
  })

  it('keeps transition_recommended when the phase actually changes', () => {
    expect(resolvePhaseAction('intensification', 'transition_recommended', 'accumulation'))
      .toBe('transition_recommended')
  })

  it('never touches a recovery action, whatever the phase field says', () => {
    for (const action of ['deload_recommended', 'session_swap_recommended', 'rest_day_recommended']) {
      expect(resolvePhaseAction('accumulation', action, 'accumulation')).toBe(action)
    }
  })

  it('leaves "stay" alone', () => {
    expect(resolvePhaseAction('realisation', 'stay', 'accumulation')).toBe('stay')
  })
})

describe('normalizeStoredPrescription — role caps', () => {
  const presc = (over: Record<string, unknown> = {}) => ({
    phase: 'accumulation' as const,
    phaseAction: 'stay',
    exercises: [
      { sessionExerciseId: 'a', sets: 4, pct: 80 },
      { sessionExerciseId: 'b', sets: 3, pct: 70 },
    ],
    ...over,
  })

  it('applies the role caps on read when roles are supplied', () => {
    // The live Upper shape: an accessory heavier and longer than the primary, stored six
    // days before the generation-time rule existed.
    const out = normalizeStoredPrescription(
      presc({
        exercises: [
          { sessionExerciseId: 'incline', sets: 4, pct: 76 },
          { sessionExerciseId: 'skull', sets: 5, pct: 77.5 },
        ],
      }),
      'accumulation',
      new Map([['incline', 'primary'], ['skull', 'accessory']]),
    )
    expect(out.exercises.find(e => e.sessionExerciseId === 'skull'))
      .toEqual({ sessionExerciseId: 'skull', sets: 4, pct: 76 })
  })

  it('skips the role caps entirely when no roles are supplied', () => {
    const p = presc({
      exercises: [
        { sessionExerciseId: 'incline', sets: 4, pct: 76 },
        { sessionExerciseId: 'skull', sets: 5, pct: 77.5 },
      ],
    })
    expect(normalizeStoredPrescription(p, 'accumulation')).toBe(p)
  })

  it('caps before flooring, so a ceiling clamp can never land under the set floor', () => {
    const out = normalizeStoredPrescription(
      presc({
        exercises: [
          { sessionExerciseId: 'main', sets: 4, pct: 80 },
          { sessionExerciseId: 'acc', sets: 1, pct: 90 },
        ],
      }),
      'accumulation',
      new Map([['main', 'primary'], ['acc', 'accessory']]),
    )
    const acc = out.exercises.find(e => e.sessionExerciseId === 'acc')!
    expect(acc.sets).toBe(2)   // floored, not left at 1
    expect(acc.pct).toBe(80)   // and still capped to the anchor
  })
})
