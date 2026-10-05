// BF-199 Phase 1 — the shadow record pairs each given exercise with the rules prescriber's, by id.
import { describe, it, expect } from 'vitest'
import { buildPrescriptionShadow } from '../prescription-shadow'

const ex = (id: string, sets: number, reps: number, pct: number, restSec: number) =>
  ({ sessionExerciseId: id, name: id, sets, reps, pct, restSec })
const rx = (phase: string, action: string, exercises: ReturnType<typeof ex>[]) =>
  ({ phase, phaseAction: action, exercises, estimatedSessionDurationMin: 50, weeklyVolumeContribution: {}, deload: false, reasoning: '', confidence: 0.8 }) as never

describe('buildPrescriptionShadow', () => {
  it('keeps the model\'s own phase apart from the final one, and pairs exercises by id', () => {
    const s = buildPrescriptionShadow({
      modelPhase: 'intensification', modelPhaseAction: 'transition_recommended',
      final: rx('accumulation', 'stay', [ex('a', 2, 10, 70.5, 143), ex('b', 2, 12, 66, 97)]),
      rules: rx('accumulation', 'stay', [ex('b', 2, 12, 66, 90), ex('a', 2, 10, 70, 120)]),
    })
    expect(s).toMatchObject({ modelPhase: 'intensification', modelPhaseAction: 'transition_recommended', finalPhase: 'accumulation', finalPhaseAction: 'stay' })
    expect(s.rows[0]).toEqual({ sessionExerciseId: 'a', name: 'a', given: { sets: 2, reps: 10, pct: 70.5, restSec: 143 }, rules: { sets: 2, reps: 10, pct: 70, restSec: 120 } })
    expect(s.rows[1].rules).toEqual({ sets: 2, reps: 12, pct: 66, restSec: 90 })
  })

  it('records an exercise the rules path could not prescribe as rules: null', () => {
    const s = buildPrescriptionShadow({ modelPhase: 'accumulation', modelPhaseAction: 'stay', final: rx('accumulation', 'stay', [ex('a', 2, 10, 70, 90)]), rules: null })
    expect(s.rows[0].rules).toBeNull()
  })
})
