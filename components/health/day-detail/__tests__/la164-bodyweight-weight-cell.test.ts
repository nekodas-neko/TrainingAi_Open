// LA-164 — a bodyweight lift on Health → Day reads as bodyweight, not "0kg".
//
// `0kg` is not a small number on a chin-up, it is the wrong quantity: nothing was added to the bar
// and the lift is the body. `/api/day-log` carries `exerciseType` (RV-219's engine half, resolved
// from `exercise_library` via `exercise_logs.exercise_id`), so the card can tell the two apart —
// and only that field can, which is why the em dash stays a weighted-lift story.
import { describe, it, expect } from 'vitest'
import { exerciseWeight } from '../exercise-weight'
import type { DayExercise } from '@/app/api/day-log/route'

const ex = (p: Partial<DayExercise>) => ({ weightKg: null, exerciseType: null, ...p }) as DayExercise

describe('the day card weight cell', () => {
  it('reads BW for a bodyweight lift with nothing added — the bug', () => {
    expect(exerciseWeight(ex({ exerciseType: 'bodyweight', weightKg: 0 }))).toEqual({ value: 'BW', unit: null })
  })

  it('reads BW when the weight is absent rather than zero', () => {
    expect(exerciseWeight(ex({ exerciseType: 'bodyweight' }))).toEqual({ value: 'BW', unit: null })
  })

  it('keeps the unit on added weight, because "BW +10" is ambiguous without it', () => {
    expect(exerciseWeight(ex({ exerciseType: 'bodyweight', weightKg: 10 }))).toEqual({ value: 'BW +10', unit: 'kg' })
  })

  it('leaves a weighted lift exactly as it was', () => {
    expect(exerciseWeight(ex({ exerciseType: 'weighted', weightKg: 60 }))).toEqual({ value: 60, unit: 'kg' })
  })

  // The distinction the type exists for: an unrecorded weight is NOT bodyweight, and a card that
  // guessed from `weightKg === 0` alone would call every unlogged set a chin-up.
  it('an unknown type with no weight stays an em dash, not BW', () => {
    expect(exerciseWeight(ex({ exerciseType: null }))).toEqual({ value: '—', unit: 'kg' })
  })

  it('an unknown type at 0 kg stays 0 — absent evidence is not bodyweight', () => {
    expect(exerciseWeight(ex({ exerciseType: null, weightKg: 0 }))).toEqual({ value: 0, unit: 'kg' })
  })
})
