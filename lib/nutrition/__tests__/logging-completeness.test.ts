import { describe, it, expect } from 'vitest'
import {
  mealLoggingStatus,
  mealLoggingComplete,
} from '@trainingai/shared/nutrition/meal-logging-status'
import { foodLoggingCoverage } from '../logging-completeness'
import type { WorkoutRepository } from '@/lib/data/repository'

describe('meal logging coverage', () => {
  it('does not infer breakfast from recorded lunch and dinner', () => {
    expect(mealLoggingStatus('breakfast', ['lunch', 'dinner'], [])).toBe('not_recorded')
    expect(mealLoggingComplete(['breakfast', 'lunch', 'dinner'], ['lunch', 'dinner'], [])).toBe(
      false,
    )
    expect(
      mealLoggingComplete(['breakfast', 'lunch', 'dinner'], ['lunch', 'dinner'], ['breakfast']),
    ).toBe(true)
    expect(mealLoggingStatus('lunch', ['lunch'], ['lunch'])).toBe('recorded')
    expect(mealLoggingComplete([], [], [])).toBe(false)
  })
  it('replaces a legacy completion claim when meal-level data says a meal is unknown', async () => {
    const repo = {
      listMealLoggingCompleteness: async () => [
        { date: '2026-10-10', complete: false },
        { date: '2026-10-11', complete: true },
      ],
    } as WorkoutRepository
    const coverage = await foodLoggingCoverage(repo, 'user', '2026-10-01', '2026-10-12', [
      '2026-10-09',
      '2026-10-10',
    ])
    expect([...coverage.complete]).toEqual(['2026-10-09', '2026-10-11'])
  })
  it('only supplies zero intake when all meals were explicitly skipped', async () => {
    const repo = {
      listMealLoggingCompleteness: async () => [
        { date: '2026-10-10', complete: false, zeroIntake: true },
        { date: '2026-10-11', complete: true, zeroIntake: true },
      ],
    } as WorkoutRepository
    expect([
      ...(await foodLoggingCoverage(repo, 'user', '2026-10-01', '2026-10-12', [])).zeroIntake,
    ]).toEqual(['2026-10-11'])
  })
  it('does not trust legacy completion when the meal-status read fails', async () => {
    const repo = {
      listMealLoggingCompleteness: async () => {
        throw new Error('offline')
      },
    } as WorkoutRepository
    expect(
      (await foodLoggingCoverage(repo, 'user', '2026-10-01', '2026-10-12', ['2026-10-10']))
        .complete.size,
    ).toBe(0)
  })
})
