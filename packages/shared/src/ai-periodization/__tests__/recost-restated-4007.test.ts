// #4007: a restated plan's minutes and weekly volume move with the rows the restate changed, and only with those.
// Pure functions, made-up lifts and numbers; no model (0 real requests).
import { describe, it, expect } from 'vitest'
import { recostRestated, prescriptionFigures, rowUnderFull, type FigureSignals } from '../prescription-figures'
import type { AiPrescription, AiPrescriptionExercise } from '../../types/ai-periodization'

const signals: FigureSignals = {
  exercises: ['a', 'b', 'c', 'd'].map((id, i) => ({
    sessionExerciseId: id, transitionSec: 180 + 30 * i, timeProfile: null,
    muscleAssignments: [{ muscle: ['Quads', 'Back', 'Biceps', 'Chest'][i], role: 'main' as const }, { muscle: 'Core', role: 'secondary' as const }],
  })),
}
const row = (id: string, sets: number, reps: number, restSec: number, extra: Partial<AiPrescriptionExercise> = {}): AiPrescriptionExercise =>
  ({ sessionExerciseId: id, name: `Lift ${id}`, sets, reps, pct: 70, restSec, ...extra })
const plan = (exercises: AiPrescriptionExercise[], extra: Partial<AiPrescription> = {}): AiPrescription => {
  const figures = prescriptionFigures(exercises, signals)
  return { phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.9, exercises, ...figures, ...extra } as AiPrescription
}
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

describe('recostRestated', () => {
  it('returns the same object when the restate changed nothing, or only a record', () => {
    const p = plan([row('a', 3, 8, 120), row('b', 3, 10, 90)])
    expect(recostRestated(p, p, signals)).toBe(p)
    const noted = { ...p, exercises: p.exercises.map(e => ({ ...e, liftPreference: { restSec: 120 } })) }
    expect(recostRestated(p, noted, signals)).toBe(noted)
  })

  it('equals a whole re-cost of the new rows when the stored figures were costed from the old rows (200 seeded cases)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed)
      const before = ['a', 'b', 'c', 'd'].map(id => row(id, 2 + Math.floor(r() * 4), 3 + Math.floor(r() * 12), 45 + Math.floor(r() * 150)))
      const after = before.map(e => r() < 0.5 ? { ...e, sets: Math.max(1, e.sets + (r() < 0.5 ? -1 : 1)), restSec: 45 + Math.floor(r() * 150), reps: 3 + Math.floor(r() * 12) } : e)
      const p = plan(before)
      const restated = { ...p, exercises: after }
      const out = recostRestated(p, restated, signals)
      const whole = prescriptionFigures(after, signals)
      // The duration is a rounded minute on each side: the shift can differ from a whole re-cost by that rounding only.
      expect(Math.abs(out.estimatedSessionDurationMin - whole.estimatedSessionDurationMin), `seed ${seed}`).toBeLessThanOrEqual(1)
      expect(out.weeklyVolumeContribution, `seed ${seed}`).toEqual(whole.weeklyVolumeContribution)
      expect(out.exercises, `seed ${seed}`).toBe(after)
    }
  })

  it('keeps what the stored figures include that the rows do not show: a budget-shortened session is shifted, not re-priced', () => {
    const exercises = [row('a', 3, 8, 120), row('b', 3, 10, 90)]
    const p = plan(exercises, { estimatedSessionDurationMin: 31 }) // stored from the budget stage's own costing
    const restated = { ...p, exercises: [row('a', 4, 8, 120), exercises[1]] }
    const out = recostRestated(p, restated, signals)
    const delta = prescriptionFigures(restated.exercises, signals).estimatedSessionDurationMin - prescriptionFigures(exercises, signals).estimatedSessionDurationMin
    expect(out.estimatedSessionDurationMin).toBe(31 + delta)
    expect(out.weeklyVolumeContribution.quads).toBe(p.weeklyVolumeContribution.quads + 1)
    expect(out.weeklyVolumeContribution.core).toBe(p.weeklyVolumeContribution.core + 0.5)
    expect(out.weeklyVolumeContribution.back).toBe(p.weeklyVolumeContribution.back)
  })

  it('a dropped exercise is not costed on either side', () => {
    const exercises = [row('a', 3, 8, 120), row('b', 3, 10, 90), row('c', 3, 10, 90)]
    const p = plan([exercises[0], exercises[1]], { droppedExerciseIds: ['c'] })
    const restated = { ...p, exercises: [exercises[0], exercises[1], row('c', 5, 10, 90)] }
    expect(recostRestated({ ...p, exercises }, restated, signals).estimatedSessionDurationMin).toBe(p.estimatedSessionDurationMin)
  })

  it('shifts the figures Full trains the same way, over the rows as Full trains them', () => {
    const deloaded = row('b', 2, 8, 60, { deloaded: true, preDeload: { sets: 4, reps: 8, pct: 70, restSec: 120 } })
    const exercises = [row('a', 3, 8, 120), deloaded]
    const full = prescriptionFigures(exercises.map(rowUnderFull), signals)
    const p = plan(exercises, { fullSession: full })
    const restated = { ...p, exercises: [row('a', 4, 8, 120), deloaded] }
    const out = recostRestated(p, restated, signals)
    const wholeFull = prescriptionFigures(restated.exercises.map(rowUnderFull), signals)
    expect(Math.abs(out.fullSession!.estimatedSessionDurationMin - wholeFull.estimatedSessionDurationMin)).toBeLessThanOrEqual(1)
    expect(out.fullSession!.weeklyVolumeContribution).toEqual(wholeFull.weeklyVolumeContribution)
    expect(out.exercises[1]).toBe(deloaded) // a deloaded row is never touched by the restate
  })

  it('never stores a figure that is not a real number', () => {
    const p = plan([row('a', 3, 8, 120)], { estimatedSessionDurationMin: 1 })
    const restated = { ...p, exercises: [row('a', 1, 1, 30)] }
    // 1 minute stored, rows now cost less than that: the figure would reach 0 or below, so the plan keeps its figures.
    const out = recostRestated(p, restated, signals)
    expect(out.estimatedSessionDurationMin).toBeGreaterThan(0)
    expect(Number.isFinite(out.estimatedSessionDurationMin)).toBe(true)
  })
})
