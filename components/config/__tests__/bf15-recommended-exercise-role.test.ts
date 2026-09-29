import { describe, it, expect } from 'vitest'
import { roleForSelectedExercise, musclesForSelectedExercise } from '../recommended-exercise-role'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import type { ExerciseLibraryEntry, ExerciseRole } from '@trainingai/shared/types/program'

const entry = (n: number, name = 'X'): ExerciseLibraryEntry => ({
  id: name, name,
  muscles: Array.from({ length: n }, (_, i) => ({ muscle: `m${i}`, role: i === 0 ? 'main' : 'secondary' })),
  equipment: ['barbell'], exerciseType: 'weighted',
})

const session = (roles: (ExerciseRole | undefined)[], budget?: number) =>
  ({ exercises: roles.map(r => ({ exerciseRole: r })), timeBudgetMinutes: budget })

describe('BF-15 — a newly named exercise starts on a recommended role', () => {
  it('⛔ never recommends primary, which is the defect', () => {
    // The fallback used to be `primary`, so unclassified work was prescribed like a main lift —
    // the owner's "bicep curls increase to a main level".
    for (const muscles of [1, 2, 4, 8]) {
      const role = roleForSelectedExercise(entry(muscles), session([undefined, undefined]), 0)
      expect(role, `${muscles} muscles`).not.toBe('primary')
    }
  })

  it('gives a multi-muscle lift Secondary while the session has a slot for one', () => {
    expect(roleForSelectedExercise(entry(3), session([undefined, undefined, undefined], 60), 0)).toBe('secondary')
  })

  it('falls to accessory once the session’s secondary slots are taken', () => {
    // A 60-minute session carries 2 secondaries; with both used the next one is accessory.
    const full = session(['secondary', 'secondary', undefined], 60)
    expect(roleForSelectedExercise(entry(3), full, 2)).toBe(UNCLASSIFIED_EXERCISE_ROLE)
  })

  it('gives a single-muscle exercise accessory — the bicep-curl case', () => {
    expect(roleForSelectedExercise(entry(1), session([undefined], 60), 0)).toBe(UNCLASSIFIED_EXERCISE_ROLE)
  })

  it('⛔ never overwrites a role the lifter chose', () => {
    // Renaming an exercise must not silently re-grade it. The recommendation is a starting pill.
    const chosen = session(['primary', undefined], 60)
    expect(roleForSelectedExercise(entry(4), chosen, 0)).toBe('primary')
  })

  it('counts only the OTHER slots, not the one being named', () => {
    // Were the slot itself counted, its own 'secondary' would consume a slot and push it down.
    const self = session(['secondary', 'secondary'], 60)
    expect(roleForSelectedExercise(entry(3), { exercises: [{}, { exerciseRole: 'secondary' }], timeBudgetMinutes: 60 }, 0))
      .toBe('secondary')
    expect(roleForSelectedExercise(entry(3), self, 0)).toBe('secondary')
  })

  it('recommends nothing for a name the catalogue does not hold', () => {
    // No muscle count to reason from; the engine's `accessory` default already covers it, and
    // guessing here would be a number invented rather than read.
    expect(roleForSelectedExercise(undefined, session([undefined]), 0)).toBeUndefined()
  })

  it('treats a session with no configured length as the editor’s 60-minute default', () => {
    expect(roleForSelectedExercise(entry(3), session([undefined, undefined]), 0)).toBe('secondary')
  })
})

describe('BF-15 — the catalogue fields extracted alongside it', () => {
  it('splits main from secondary muscles and keeps every one in muscleGroups', () => {
    expect(musclesForSelectedExercise(entry(3))).toEqual({
      mainMuscles: ['m0'], secondaryMuscles: ['m1', 'm2'], muscleGroups: ['m0', 'm1', 'm2'],
    })
  })

  it('returns nothing for an unknown name, so the caller keeps what the slot had', () => {
    expect(musclesForSelectedExercise(undefined)).toEqual({})
  })
})
