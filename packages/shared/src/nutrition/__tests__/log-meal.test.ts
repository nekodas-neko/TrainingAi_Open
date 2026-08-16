import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SavedMeal, SavedMealItem } from '../../types/nutrition'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    upsertFoodLog:  vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/cache-groups', () => ({ invalidateNutritionWrite: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/meal-reminders', () => ({ cancelMealReminder: vi.fn(() => Promise.resolve()) }))

import { logMealItems, savedMealItemToWithItem } from '../log-meal'

describe('logMealItems — local food_items mirror (offline-first path)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('mirrors each saved-meal item into local food_items before writing the food_log', async () => {
    const meal: SavedMeal = {
      id: 'meal-a', userId: 'u1', name: 'Saved Meal', createdAt: new Date(),
      items: [{
        id: 'smi-1', savedMealId: 'meal-a', foodItemId: 'item-2', quantityMultiplier: 1.5,
        foodItem: {
          id: 'item-2', userId: 'u1', name: 'Rice', brand: 'Generic', servingSizeG: 150,
          calories: 200, proteinG: 4, carbsG: 44, fatG: 0, fiberG: 1, sugarG: 0,
          sodiumMg: 5, satFatG: 0, source: 'manual', region: 'AU', createdAt: new Date(),
        },
      }],
      totals: { calories: 200, proteinG: 4, carbsG: 44, fatG: 0 },
    }

    await logMealItems(meal, '2026-07-05', 'meal-type-1', 'u1')

    expect(fakeStore.upsertFoodItem).toHaveBeenCalledTimes(1)
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'item-2', name: 'Rice', brand: 'Generic', servingSizeG: 150,
      calories: 200, proteinG: 4, carbsG: 44, fatG: 0, source: 'manual',
    }))
    expect(fakeStore.upsertFoodLog).toHaveBeenCalledTimes(1)
    expect(fakeStore.upsertFoodLog).toHaveBeenCalledWith(expect.objectContaining({
      foodItemId: 'item-2', mealTypeId: 'meal-type-1', quantityMultiplier: 1.5,
    }))
    // the item must be mirrored before the log write, or a JOIN in between would drop it
    const upsertItemOrder = fakeStore.upsertFoodItem.mock.invocationCallOrder[0]
    const upsertLogOrder = fakeStore.upsertFoodLog.mock.invocationCallOrder[0]
    expect(upsertItemOrder).toBeLessThan(upsertLogOrder)
  })

  it('mirrors every item for a multi-item saved meal', async () => {
    const meal: SavedMeal = {
      id: 'meal-b', userId: 'u1', name: 'Big Meal', createdAt: new Date(),
      items: [
        {
          id: 'smi-2', savedMealId: 'meal-b', foodItemId: 'item-3', quantityMultiplier: 1,
          foodItem: {
            id: 'item-3', userId: 'u1', name: 'Chicken', servingSizeG: 200,
            calories: 330, proteinG: 40, carbsG: 0, fatG: 18,
            source: 'manual', region: 'AU', createdAt: new Date(),
          },
        },
        {
          id: 'smi-3', savedMealId: 'meal-b', foodItemId: 'item-4', quantityMultiplier: 2,
          foodItem: {
            id: 'item-4', userId: 'u1', name: 'Broccoli', servingSizeG: 100,
            calories: 34, proteinG: 3, carbsG: 7, fatG: 0,
            source: 'manual', region: 'AU', createdAt: new Date(),
          },
        },
      ],
      totals: { calories: 398, proteinG: 46, carbsG: 7, fatG: 18 },
    }

    await logMealItems(meal, '2026-07-05', 'meal-type-1', 'u1')

    expect(fakeStore.upsertFoodItem).toHaveBeenCalledTimes(2)
    expect(fakeStore.upsertFoodLog).toHaveBeenCalledTimes(2)
  })

  it('returns the optimistic FoodLogWithItem entries so the caller can append without a refetch', async () => {
    const meal: SavedMeal = {
      id: 'meal-c', userId: 'u1', name: 'Saved Meal', createdAt: new Date(),
      items: [{
        id: 'smi-4', savedMealId: 'meal-c', foodItemId: 'item-5', quantityMultiplier: 1.5,
        foodItem: {
          id: 'item-5', userId: 'u1', name: 'Rice', servingSizeG: 150,
          calories: 200, proteinG: 4, carbsG: 44, fatG: 0,
          source: 'manual', region: 'AU', createdAt: new Date(),
        },
      }],
      totals: { calories: 300, proteinG: 6, carbsG: 66, fatG: 0 },
    }

    const logs = await logMealItems(meal, '2026-07-05', 'meal-type-1', 'u1')

    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      date: '2026-07-05', mealTypeId: 'meal-type-1', foodItemId: 'item-5',
      quantityMultiplier: 1.5, calories: 300, proteinG: 6, carbsG: 66, fatG: 0,
    })
    expect(logs[0].foodItem.name).toBe('Rice')
  })
})

const baseItem = (overrides: Partial<SavedMealItem> = {}): SavedMealItem => ({
  id: 'smi1', savedMealId: 'sm1', foodItemId: 'fi1', quantityMultiplier: 2,
  foodItem: {
    id: 'fi1', userId: 'u1', name: 'Rice Thins', brand: 'Brand',
    servingSizeG: 100, calories: 120, proteinG: 3, carbsG: 25, fatG: 1,
    fiberG: 2, sugarG: 1, sodiumMg: 50, satFatG: 0.2,
    source: 'manual', region: '', createdAt: new Date(),
  },
  ...overrides,
})

describe('savedMealItemToWithItem', () => {
  it('scales macros by the item quantity and embeds the food item for offline render', () => {
    const log = { id: 'log1', date: '2026-07-04', mealTypeId: 'mt1', loggedAt: '2026-07-04T08:00:00.000Z' }
    const wi = savedMealItemToWithItem(baseItem(), log)
    expect(wi).toMatchObject({
      id: 'log1', date: '2026-07-04', mealTypeId: 'mt1', foodItemId: 'fi1',
      quantityMultiplier: 2, calories: 240, proteinG: 6, carbsG: 50, fatG: 2,
    })
    expect(wi.foodItem.name).toBe('Rice Thins')
    expect(wi.loggedAt).toBeInstanceOf(Date)
  })

  it('rounds protein/carbs/fat to one decimal', () => {
    const item = baseItem({
      quantityMultiplier: 1.5,
      foodItem: { ...baseItem().foodItem, proteinG: 3.33, carbsG: 0, fatG: 0 },
    })
    const wi = savedMealItemToWithItem(item, { id: 'l', date: '2026-07-04', mealTypeId: 'm', loggedAt: '2026-07-04T08:00:00.000Z' })
    expect(wi.proteinG).toBe(5) // 3.33 * 1.5 = 4.995 -> r1 -> 5
  })
})
