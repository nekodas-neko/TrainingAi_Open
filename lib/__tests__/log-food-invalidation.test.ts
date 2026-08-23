import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NewFoodEntry } from '@trainingai/shared/nutrition/log-food'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

const { invalidateNutritionWriteMock, pushThenRevalidateMock, getLocalStoreMock } = vi.hoisted(() => ({
  invalidateNutritionWriteMock: vi.fn(() => Promise.resolve()),
  pushThenRevalidateMock: vi.fn(),
  getLocalStoreMock: vi.fn(() => null as unknown),
}))
vi.mock('@/lib/cache-groups', () => ({
  invalidateNutritionWrite: invalidateNutritionWriteMock,
}))
vi.mock('@/lib/meal-reminders', () => ({
  cancelMealReminder: vi.fn(() => Promise.resolve()),
}))
// getLocalStore/pushMutations are exercised on the offline-first path elsewhere
// (local-store tests); these tests target the web-fallback branch, reached by
// omitting userId, which never calls getLocalStore in the first place.
vi.mock('@/lib/local-store', () => ({ getLocalStore: getLocalStoreMock }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: pushThenRevalidateMock }))

import { logFoodEntries } from '@trainingai/shared/nutrition/log-food'
import { logMealItems } from '@trainingai/shared/nutrition/log-meal'

// Regression test for the B6 bug: the primary food-log write paths invalidated
// nothing, leaving stale calorie/macro tiles after every meal logged.
describe('logFoodEntries / logMealItems — nutrition cache invalidation', () => {
  beforeEach(() => {
    invalidateNutritionWriteMock.mockClear()
    pushThenRevalidateMock.mockClear()
    getLocalStoreMock.mockReturnValue(null)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('logFoodEntries invalidates the nutrition cache group on the web-fallback path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'item-1' }) }) // createFoodItem
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'log-1', userId: 'u1', quantityMultiplier: 1, loggedAt: new Date().toISOString() }) }) // food-logs POST
    vi.stubGlobal('fetch', fetchMock)

    const entries: NewFoodEntry[] = [{
      name: 'Snack', servingSizeG: 100, calories: 200,
      proteinG: 5, carbsG: 20, fatG: 5, source: 'manual', quantityMultiplier: 1,
    }]
    await logFoodEntries(entries, '2026-07-03', 'meal-1') // no userId -> web fallback

    expect(invalidateNutritionWriteMock).toHaveBeenCalledTimes(1)
  })

  it('logMealItems invalidates the nutrition cache group on the web-fallback path', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'log-2' }) }))
    vi.stubGlobal('fetch', fetchMock)

    const meal: SavedMeal = {
      id: 'meal-a', userId: 'u1', name: 'Saved Meal', createdAt: new Date(),
      items: [{
        id: 'smi-1', savedMealId: 'meal-a', foodItemId: 'item-2', quantityMultiplier: 1,
        foodItem: {
          id: 'item-2', userId: 'u1', name: 'Rice', servingSizeG: 150,
          calories: 200, proteinG: 4, carbsG: 44, fatG: 0,
          source: 'manual', region: '', createdAt: new Date(),
        },
      }],
      totals: { calories: 200, proteinG: 4, carbsG: 44, fatG: 0 },
    }
    await logMealItems(meal, '2026-07-03', 'meal-1') // no userId -> web fallback

    expect(invalidateNutritionWriteMock).toHaveBeenCalledTimes(1)
  })
})

// LB-4: the offline-first branch invalidates BEFORE the push, which is correct on its own — the
// screen must repaint at once, and offline that is the only invalidation that will ever fire — and
// wrong on its own, because the refetch it triggers reads a server that does not have the write
// yet and re-caches the pre-log figures. The pair is the fix; these assert both halves are wired.
describe('logFoodEntries — the offline-first branch invalidates on both sides of the push', () => {
  beforeEach(() => {
    invalidateNutritionWriteMock.mockClear()
    pushThenRevalidateMock.mockClear()
  })

  function fakeStore() {
    return {
      upsertFoodItem: vi.fn(async () => {}),
      upsertFoodLog: vi.fn(async () => {}),
      queueMutation: vi.fn(async () => {}),
      getFoodItems: vi.fn(async () => []),
    }
  }

  it('invalidates immediately and hands the same invalidator to the push', async () => {
    getLocalStoreMock.mockReturnValue(fakeStore())
    const entries: NewFoodEntry[] = [{
      name: 'Snack', servingSizeG: 100, calories: 200,
      proteinG: 5, carbsG: 20, fatG: 5, source: 'manual', quantityMultiplier: 1,
    }]
    await logFoodEntries(entries, '2026-07-03', 'meal-1', 'u1')

    expect(invalidateNutritionWriteMock).toHaveBeenCalledTimes(1)
    expect(pushThenRevalidateMock).toHaveBeenCalledTimes(1)
    // The second argument is the revalidation the push runs once the server has the write. If it
    // were anything other than the same group invalidator, the two halves would evict different
    // keys and the stale one would survive.
    expect(pushThenRevalidateMock.mock.calls[0]?.[1]).toBe(invalidateNutritionWriteMock)
  })
})
