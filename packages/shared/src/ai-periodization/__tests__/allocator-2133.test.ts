import { describe, it, expect } from 'vitest'
import {
  allocateToBudget, fitToBudget, estimateSessionDurationSec, ALLOCATOR_SESSION_MUSCLE_CAP,
  type TimedExercise, type MuscleVolumeState,
} from '../time-budget'

// #2133 (owner direction 2026-09-24, proposal 2026-10-05): size a session to the time, not trim it
// toward a 2-set floor. Fixtures use the constant duration model (no measured profile) so every
// number here is plain arithmetic of the shared estimate.

const ex = (id: string, role: string, muscle: string, over: Partial<TimedExercise> = {}): TimedExercise => ({
  sessionExerciseId: id, role, sets: 4, reps: 8, restSec: 120, transitionSec: 180,
  muscleGroups: [{ muscle, weight: 1 }], ...over,
})
const PUSH = [
  ex('bench', 'primary', 'chest'),
  ex('ohp', 'secondary', 'shoulders'),
  ex('fly', 'accessory', 'chest'),
  ex('lateral', 'accessory', 'side-delts'),
  ex('pushdown', 'accessory', 'triceps'),
]
const minutes = (list: TimedExercise[]) => estimateSessionDurationSec(list) / 60
const setsOf = (list: TimedExercise[]) => Object.fromEntries(list.map(e => [e.sessionExerciseId, e.sets]))
const atMinimums = PUSH.map(e => ({ ...e, sets: e.role === 'primary' ? 3 : 2 }))
const volume = (entries: [string, number, number][]) =>
  new Map<string, MuscleVolumeState>(entries.map(([m, logged, mav]) => [m, { loggedBeforeSession: logged, mav }]))

describe('allocateToBudget', () => {
  it('starts every exercise at its minimum: the main lift 3 sets, the rest 2', () => {
    const budget = Math.ceil(minutes(atMinimums))
    const { exercises, droppedIds } = allocateToBudget(PUSH.map(e => ({ ...e, sets: 1 })), budget)
    expect(droppedIds).toEqual([])
    expect(setsOf(exercises)).toEqual({ bench: 3, ohp: 2, fly: 2, lateral: 2, pushdown: 2 })
  })

  it('drops a whole exercise when the minimums overrun, where the old trim floored every one', () => {
    const budget = Math.floor(minutes(atMinimums)) - 1
    const allocated = allocateToBudget(PUSH, budget)
    const trimmed = fitToBudget(PUSH, budget)
    expect(allocated.droppedIds).toHaveLength(1)
    expect(allocated.droppedIds).not.toContain('bench')
    expect(minutes(allocated.exercises)).toBeLessThanOrEqual(budget)
    expect(allocated.exercises.find(e => e.sessionExerciseId === 'bench')!.sets).toBeGreaterThanOrEqual(3)
    // The trim keeps all five instead, every one of them (the main lift too) on the 2-set floor:
    // the shape behind 21 of the owner's 23 measured sessions.
    expect(trimmed).toHaveLength(5)
    expect(trimmed.every(e => e.sets === 2)).toBe(true)
  })

  it('drops the exercise whose muscles are least behind the week', () => {
    const budget = Math.floor(minutes(atMinimums)) - 1
    // Triceps already past target; side delts far behind.
    const mv = volume([['chest', 4, 16], ['shoulders', 4, 12], ['side-delts', 0, 12], ['triceps', 14, 10]])
    expect(allocateToBudget(PUSH, budget, { muscleVolume: mv }).droppedIds).toEqual(['pushdown'])
  })

  it('spends time left over on the muscles furthest behind the week', () => {
    const budget = Math.ceil(minutes(atMinimums)) + 4
    const mv = volume([['chest', 12, 16], ['shoulders', 10, 12], ['side-delts', 0, 12], ['triceps', 9, 10]])
    const { exercises } = allocateToBudget(PUSH, budget, { muscleVolume: mv })
    const s = setsOf(exercises)
    expect(s.lateral).toBeGreaterThan(2)
    expect(s.pushdown).toBe(2)
    expect(minutes(exercises)).toBeLessThanOrEqual(budget)
  })

  it(`never takes one muscle past ${ALLOCATOR_SESSION_MUSCLE_CAP} weighted sets in a session, however long the day`, () => {
    // Three chest movements and all the time in the world: chest stops at the cap.
    const CHEST = [ex('bench', 'primary', 'chest'), ex('incline', 'secondary', 'chest'), ex('fly', 'accessory', 'chest')]
    const { exercises } = allocateToBudget(CHEST, 600)
    const chestSets = exercises.reduce((n, e) => n + e.sets, 0)
    expect(chestSets).toBeLessThanOrEqual(ALLOCATOR_SESSION_MUSCLE_CAP)
    expect(chestSets).toBeGreaterThan(7)
  })

  it('never buys past the weekly MRV', () => {
    const mv = volume([['side-delts', 20, 12]])
    const { exercises } = allocateToBudget([ex('lateral', 'accessory', 'side-delts')], 600, {
      muscleVolume: mv, mrvByMuscle: new Map([['side-delts', 23]]),
    })
    expect(exercises[0].sets).toBe(3)
  })

  it('holds a frozen (deloaded) row exactly as given: not reset, grown or dropped', () => {
    const deloaded = PUSH.map(e => (e.sessionExerciseId === 'ohp' ? { ...e, sets: 1 } : e))
    const roomy = allocateToBudget(deloaded, 600, { frozenIds: new Set(['ohp']) })
    expect(roomy.exercises.find(e => e.sessionExerciseId === 'ohp')!.sets).toBe(1)
    const tight = allocateToBudget(deloaded, 8, { frozenIds: new Set(['ohp']) })
    expect(tight.droppedIds).not.toContain('ohp')
  })

  it('keeps an earned set as its head start, and drops an earned exercise only after the rest', () => {
    const earned = PUSH.map(e => (e.sessionExerciseId === 'fly' ? { ...e, sets: 3 } : e))
    const roomy = allocateToBudget(earned, Math.ceil(minutes(atMinimums)) + 1, { protectedIds: new Set(['fly']) })
    expect(roomy.exercises.find(e => e.sessionExerciseId === 'fly')!.sets).toBeGreaterThanOrEqual(3)
    const tight = allocateToBudget(earned, Math.floor(minutes(atMinimums)) - 6, { protectedIds: new Set(['fly']) })
    expect(tight.droppedIds.length).toBeGreaterThan(0)
    expect(tight.droppedIds).not.toContain('fly')
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(PUSH)
    allocateToBudget(PUSH, 30)
    expect(JSON.stringify(PUSH)).toBe(before)
  })
})
