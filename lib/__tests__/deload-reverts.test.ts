import { describe, it, expect } from 'vitest'
import { applyDeloadReverts } from '@/components/workout/utils'
import type { WorkoutExercise } from '@/app/api/workout-data/route'

const style = (pct: number) => [{ pct, reps: 8, restSec: 120, useFor1rm: true }] as WorkoutExercise['progressionStyle']

const deloadedEx = {
  name: 'Hip Thrust',
  defaultSets: 2,
  progressionStyle: style(52),
  deloaded: true,
  deloadNote: 'Deload — glutes still sore',
  preDeloadStyle: style(72),
  preDeloadSets: 3,
} as WorkoutExercise

const normalEx = { name: 'Squat', defaultSets: 3, progressionStyle: style(70) } as WorkoutExercise

describe('applyDeloadReverts', () => {
  it('returns the array untouched with no reverts', () => {
    const out = applyDeloadReverts([deloadedEx, normalEx], [])
    expect(out[0].deloaded).toBe(true)
    expect(out[0].progressionStyle).toBe(deloadedEx.progressionStyle)
  })

  it('swaps a reverted exercise back to its original prescription', () => {
    const out = applyDeloadReverts([deloadedEx, normalEx], ['Hip Thrust'])
    expect(out[0].deloaded).toBe(false)
    expect(out[0].deloadReverted).toBe(true)
    expect(out[0].progressionStyle).toBe(deloadedEx.preDeloadStyle)
    expect(out[0].defaultSets).toBe(3)
    expect(out[1]).toBe(normalEx)
  })

  it('ignores revert names that are not deloaded or lack preDeloadStyle', () => {
    const out = applyDeloadReverts([normalEx], ['Squat'])
    expect(out[0]).toBe(normalEx)
  })
})
