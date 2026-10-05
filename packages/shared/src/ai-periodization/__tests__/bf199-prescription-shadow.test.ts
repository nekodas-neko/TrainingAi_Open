// BF-199 Phase 1 — the shadow record pairs each given exercise with the rules prescriber's, by id.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  // OR-209. RV-65 asks whether the model still earns its call, and that is answered by the delta
  // between what the model chose and what the chain produced. Only instrumentation can ever supply it.
  describe('the model\'s own numbers (OR-209)', () => {
    const final = rx('accumulation', 'stay', [ex('a', 2, 10, 70.5, 143), ex('b', 2, 12, 66, 97)])
    const model = (id: string, sets: number, reps: number, pct: number, restSec: number) => ({ sessionExerciseId: id, sets, reps, pct, restSec })

    it('records what the model returned beside what was given, so the delta is readable', () => {
      const s = buildPrescriptionShadow({
        modelPhase: 'accumulation', modelPhaseAction: 'stay', final, rules: null,
        modelExercises: [model('a', 3, 7, 77.5, 209), model('b', 2, 12, 66, 97)],
      })
      expect(s.rows[0].model).toEqual({ sets: 3, reps: 7, pct: 77.5, restSec: 209 })
      expect(s.rows[0].given.pct - s.rows[0].model!.pct).toBeCloseTo(-7)
      expect(s.rows[1].model).toEqual({ sets: 2, reps: 12, pct: 66, restSec: 97 })
    })

    // The first live row had the model answering 0.775 for a given 77.5. Normalising here would hide
    // that the model does this, which is itself a finding, so the record stays raw.
    it('stores the model\'s pct exactly as returned, fraction and all', () => {
      const s = buildPrescriptionShadow({
        modelPhase: 'accumulation', modelPhaseAction: 'stay', final, rules: null,
        modelExercises: [model('a', 4, 10, 0.775, 140)],
      })
      expect(s.rows[0].model!.pct).toBe(0.775)
    })

    it('is null for an exercise the model omitted, and ignores one it invented', () => {
      const s = buildPrescriptionShadow({
        modelPhase: 'accumulation', modelPhaseAction: 'stay', final, rules: null,
        modelExercises: [model('a', 2, 10, 70, 140), model('ghost', 3, 5, 80, 120)],
      })
      expect(s.rows.map(r => r.model)).toEqual([{ sets: 2, reps: 10, pct: 70, restSec: 140 }, null])
      expect(s.rows).toHaveLength(2)
    })

    it('keeps the FIRST entry when the model repeats an id, as reconciliation does', () => {
      const s = buildPrescriptionShadow({
        modelPhase: 'accumulation', modelPhaseAction: 'stay', final, rules: null,
        modelExercises: [model('a', 2, 10, 70, 140), model('a', 4, 4, 90, 60)],
      })
      expect(s.rows[0].model).toEqual({ sets: 2, reps: 10, pct: 70, restSec: 140 })
    })

    // Null means "the model omitted it"; absent means "this row never recorded it". Not the same fact.
    it('leaves the key ABSENT when the caller passes no model numbers at all', () => {
      const s = buildPrescriptionShadow({ modelPhase: 'accumulation', modelPhaseAction: 'stay', final, rules: null })
      expect('model' in s.rows[0]).toBe(false)
    })
  })

  it('is wired: generation snapshots the raw answer BEFORE reconciliation rewrites it', () => {
    const src = readFileSync(join(process.cwd(), 'packages/shared/src/ai-periodization/generate-prescription.ts'), 'utf8')
    const snap = src.indexOf('const modelExercises = parsed.exercises.map')
    const rewrite = src.indexOf('parsed.exercises = reconciled.exercises.map')
    expect(snap, 'the snapshot is missing').toBeGreaterThan(-1)
    expect(rewrite, 'the rewrite moved').toBeGreaterThan(-1)
    expect(snap).toBeLessThan(rewrite)
    expect(src).toMatch(/rules: buildRulesPrescription\(signals, ''\), modelExercises/)
  })
})
