import { describe, it, expect } from 'vitest'
import { reconcileReview, type ReviewSignalExercise, type ReviewModelExercise, type SetShape } from '../reconcile'

function sig(over: Partial<ReviewSignalExercise> & { sessionExerciseId: string; role: string; position: number }): ReviewSignalExercise {
  return {
    name: over.name ?? over.sessionExerciseId,
    muscleContributions: over.muscleContributions ?? [{ muscle: 'chest', weight: 1 }],
    transitionSec: over.transitionSec ?? 120,
    timeProfile: over.timeProfile ?? null,
    ...over,
  }
}

function model(over: Partial<ReviewModelExercise> & { sessionExerciseId: string; action: ReviewModelExercise['action'] }): ReviewModelExercise {
  return {
    name: over.name ?? over.sessionExerciseId,
    sets: over.sets ?? 3,
    reps: over.reps ?? 8,
    pct: over.pct ?? 70,
    restSec: over.restSec ?? 90,
    ...over,
  }
}

const shape = (sets: number, reps: number, pct: number, restSec: number): SetShape => ({ sets, reps, pct, restSec })

describe('reconcileReview', () => {
  it('drops an over-target accessory, shrinking duration and weekly volume', () => {
    const signalExercises = [
      sig({ sessionExerciseId: 'a', role: 'primary', position: 0, transitionSec: 120 }),
      sig({ sessionExerciseId: 'b', role: 'accessory', position: 1, transitionSec: 60 }),
    ]
    const currentParams = new Map([
      ['a', shape(4, 5, 80, 150)],
      ['b', shape(3, 12, 65, 90)],
    ])
    const p = reconcileReview({
      signalExercises,
      modelExercises: [
        model({ sessionExerciseId: 'a', action: 'keep', sets: 4, reps: 5, pct: 80, restSec: 150 }),
        model({ sessionExerciseId: 'b', action: 'drop', dropReason: 'chest already over weekly target' }),
      ],
      currentParams,
      weeklyTargets: { chest: 12 },
      weeklyLogged: { chest: 20 },
      budgetMin: 45,
    })

    expect(p.droppedIds).toEqual(['b'])
    const b = p.exercises.find(e => e.sessionExerciseId === 'b')!
    expect(b.action).toBe('drop')
    expect(b.after).toBeNull()
    expect(b.reason).toContain('over')
    // Dropping 3 sets of a main-chest exercise removes 3 weighted chest sets.
    expect(p.weeklyImpact.chest).toBe(-3)
    // Only exercise 'a' survives: 4*(10+5*4) + 4*150 + 120 = 120+600+120 = 840s -> 14 min.
    expect(p.projectedDurationMin).toBe(14)
    expect(p.fitsBudget).toBe(true)
  })

  it('refuses to drop the only primary (main compound lift)', () => {
    const p = reconcileReview({
      signalExercises: [
        sig({ sessionExerciseId: 'a', role: 'primary', position: 0 }),
        sig({ sessionExerciseId: 'b', role: 'accessory', position: 1 }),
      ],
      modelExercises: [model({ sessionExerciseId: 'a', action: 'drop', dropReason: 'save time' })],
      currentParams: new Map([['a', shape(3, 5, 80, 150)], ['b', shape(3, 10, 65, 90)]]),
      weeklyTargets: {},
      weeklyLogged: {},
      budgetMin: 60,
    })
    const a = p.exercises.find(e => e.sessionExerciseId === 'a')!
    expect(a.action).toBe('keep')
    expect(a.guardAdjusted).toBe(true)
    expect(p.droppedIds).toEqual([])
  })

  it('allows dropping one of two primaries (at least one remains)', () => {
    const p = reconcileReview({
      signalExercises: [
        sig({ sessionExerciseId: 'a', role: 'primary', position: 0, muscleContributions: [{ muscle: 'chest', weight: 1 }] }),
        sig({ sessionExerciseId: 'b', role: 'primary', position: 1, muscleContributions: [{ muscle: 'shoulders', weight: 1 }] }),
      ],
      modelExercises: [model({ sessionExerciseId: 'b', action: 'drop', dropReason: 'over budget with two compounds' })],
      currentParams: new Map([['a', shape(4, 5, 80, 180)], ['b', shape(4, 5, 80, 180)]]),
      weeklyTargets: {},
      weeklyLogged: {},
      budgetMin: 30,
    })
    expect(p.droppedIds).toEqual(['b'])
    // The remaining primary is untouched.
    expect(p.exercises.find(e => e.sessionExerciseId === 'a')!.action).toBe('keep')
  })

  it('refuses to drop the only coverage of an under-target muscle', () => {
    const p = reconcileReview({
      signalExercises: [
        sig({ sessionExerciseId: 'a', role: 'primary', position: 0, muscleContributions: [{ muscle: 'chest', weight: 1 }] }),
        sig({ sessionExerciseId: 'b', role: 'accessory', position: 1, muscleContributions: [{ muscle: 'back', weight: 1 }] }),
      ],
      modelExercises: [model({ sessionExerciseId: 'b', action: 'drop', dropReason: 'time' })],
      currentParams: new Map([['a', shape(3, 5, 80, 150)], ['b', shape(3, 10, 65, 90)]]),
      weeklyTargets: { back: 10 },
      weeklyLogged: { back: 2 },
      budgetMin: 60,
    })
    const b = p.exercises.find(e => e.sessionExerciseId === 'b')!
    expect(b.action).toBe('keep')
    expect(b.guardAdjusted).toBe(true)
    expect(b.reason).toContain('back')
  })

  it('allows dropping one of two under-target-muscle exercises (coverage remains)', () => {
    const p = reconcileReview({
      signalExercises: [
        sig({ sessionExerciseId: 'a', role: 'accessory', position: 0, muscleContributions: [{ muscle: 'back', weight: 1 }] }),
        sig({ sessionExerciseId: 'b', role: 'accessory', position: 1, muscleContributions: [{ muscle: 'back', weight: 1 }] }),
      ],
      modelExercises: [model({ sessionExerciseId: 'a', action: 'drop', dropReason: 'time' })],
      currentParams: new Map([['a', shape(3, 10, 65, 90)], ['b', shape(3, 10, 65, 90)]]),
      weeklyTargets: { back: 20 },
      weeklyLogged: { back: 2 },
      budgetMin: 60,
    })
    expect(p.droppedIds).toEqual(['a'])
  })

  it('treats an adjust equal to current as a keep', () => {
    const p = reconcileReview({
      signalExercises: [sig({ sessionExerciseId: 'a', role: 'secondary', position: 0 })],
      modelExercises: [model({ sessionExerciseId: 'a', action: 'adjust', sets: 3, reps: 8, pct: 70, restSec: 90 })],
      currentParams: new Map([['a', shape(3, 8, 70, 90)]]),
      weeklyTargets: {},
      weeklyLogged: {},
      budgetMin: 60,
    })
    expect(p.adjustedIds).toEqual([])
    expect(p.exercises[0].action).toBe('keep')
  })

  it('clamps an adjust to the role floor and pct bounds; normalizes a fractional pct', () => {
    const p = reconcileReview({
      signalExercises: [sig({ sessionExerciseId: 'a', role: 'primary', position: 0 })],
      modelExercises: [model({ sessionExerciseId: 'a', action: 'adjust', sets: 1, reps: 5, pct: 0.85, restSec: 200 })],
      currentParams: new Map([['a', shape(4, 5, 80, 180)]]),
      weeklyTargets: {},
      weeklyLogged: {},
      budgetMin: 60,
    })
    const a = p.exercises[0]
    expect(a.action).toBe('adjust')
    expect(a.after).toEqual({ sets: 2, reps: 5, pct: 85, restSec: 200 })
  })

  it('records invented ids and backfills a model omission as keep', () => {
    const p = reconcileReview({
      signalExercises: [
        sig({ sessionExerciseId: 'a', role: 'primary', position: 0 }),
        sig({ sessionExerciseId: 'b', role: 'accessory', position: 1 }),
      ],
      modelExercises: [
        model({ sessionExerciseId: 'ghost', action: 'drop', dropReason: 'nope' }),
        model({ sessionExerciseId: 'a', action: 'keep' }),
      ],
      currentParams: new Map([['a', shape(3, 5, 80, 150)], ['b', shape(3, 10, 65, 90)]]),
      weeklyTargets: {},
      weeklyLogged: {},
      budgetMin: 60,
    })
    expect(p.invalidIds).toEqual(['ghost'])
    const b = p.exercises.find(e => e.sessionExerciseId === 'b')!
    expect(b.action).toBe('keep')
    expect(b.before).toEqual(shape(3, 10, 65, 90))
  })
})
