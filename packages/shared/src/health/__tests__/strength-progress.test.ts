import { describe, it, expect } from 'vitest'
import { computeBarMetric } from '../strength-progress'
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

function makeExercise(overrides: Partial<ExerciseSummary> = {}): ExerciseSummary {
  return {
    exercise: 'Bench Press',
    weight: null,
    date: null,
    sessionName: 'Push',
    estimated1rm: null,
    target80: null,
    personalRecord1rm: null,
    exerciseType: 'weighted',
    lastReps: null,
    maxReps: null,
    ...overrides,
  }
}

describe('computeBarMetric — mode "latest"', () => {
  it('computes pct against the max and labels with the 1RM max', () => {
    const ex = makeExercise({ estimated1rm: 96, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric).not.toBeNull()
    expect(metric!.pct).toBeCloseTo((96 / 98) * 100, 5)
    expect(metric!.label).toBe('98 kg')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('uses gold when at or above 99.5% of PR', () => {
    const ex = makeExercise({ estimated1rm: 98, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 even if estimated1rm exceeds the stored PR', () => {
    const ex = makeExercise({ estimated1rm: 105, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('falls back to estimated1rm as the PR when personalRecord1rm is null', () => {
    const ex = makeExercise({ estimated1rm: 96, personalRecord1rm: null })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.label).toBe('96 kg')
  })

  it('returns null when estimated1rm is null', () => {
    const ex = makeExercise({ estimated1rm: null, personalRecord1rm: 98 })
    expect(computeBarMetric(ex, 'latest')).toBeNull()
  })
})

describe('computeBarMetric — mode "working", weighted exercises', () => {
  it('bar compares last working weight against the 1RM max; label shows the best 1RM', () => {
    const ex = makeExercise({ weight: 92.5, personalRecord1rm: 98, estimated1rm: 96 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBeCloseTo((92.5 / 98) * 100, 5)
    expect(metric!.label).toBe('98 kg')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('returns null when no working weight has been logged', () => {
    const ex = makeExercise({ weight: null, personalRecord1rm: 98 })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })

  it('treats a missing PR as 100%', () => {
    const ex = makeExercise({ weight: 60, personalRecord1rm: null })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 when weight exceeds PR', () => {
    const ex = makeExercise({ weight: 110, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
  })
})

describe('computeBarMetric — mode "working", bodyweight exercises', () => {
  it('bar compares last reps against all-time max reps; label shows the max reps', () => {
    const ex = makeExercise({
      exercise: 'Pull-Up',
      exerciseType: 'bodyweight',
      lastReps: 10,
      maxReps: 12,
    })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBeCloseTo((10 / 12) * 100, 5)
    expect(metric!.label).toBe('12 reps')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('uses gold when lastReps meets maxReps', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 12, maxReps: 12 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 when lastReps exceeds maxReps', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 15, maxReps: 12 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
  })

  it('returns null when lastReps is null', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: null, maxReps: 12 })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })

  it('returns null when maxReps is null', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 10, maxReps: null })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })
})
