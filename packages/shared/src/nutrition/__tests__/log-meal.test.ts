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

// BF-39 — every ingredient of one logging carries the same group, and the group is not the meal.
//
// This is the whole of the write half. The diary draws one row per `mealGroupId`, so if the items
// of one logging disagreed the meal would split, and if two loggings agreed they would merge and
// the second serving would vanish into the first.
describe('logMealItems — meal identity (BF-39)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const twoItemMeal = (): SavedMeal => ({
    id: 'meal-bf39', userId: 'u1', name: 'Protein Pancakes', createdAt: new Date(),
    items: [1, 2].map(n => ({
      id: `smi-${n}`, savedMealId: 'meal-bf39', foodItemId: `item-${n}`, quantityMultiplier: 1,
      foodItem: {
        id: `item-${n}`, userId: 'u1', name: `Ingredient ${n}`, servingSizeG: 100,
        calories: 100, proteinG: 5, carbsG: 10, fatG: 2, source: 'manual', region: 'AU',
        createdAt: new Date(),
      },
    })),
    totals: { calories: 200, proteinG: 10, carbsG: 20, fatG: 4 },
  })

  const groupsFrom = (mock: { mock: { calls: unknown[][] } }) =>
    mock.mock.calls.map(c => (c[0] as { mealGroupId?: string | null }).mealGroupId)

  it('stamps every row of one logging with the SAME group, and the meal on each', async () => {
    const logs = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')

    expect(fakeStore.upsertFoodLog).toHaveBeenCalledTimes(2)
    const groups = groupsFrom(fakeStore.upsertFoodLog)
    expect(new Set(groups).size).toBe(1)
    expect(groups[0]).toBeTruthy()
    for (const call of fakeStore.upsertFoodLog.mock.calls) {
      expect((call[0] as { savedMealId?: string }).savedMealId).toBe('meal-bf39')
    }
    // …and the optimistic rows carry it, so the caller groups without a refetch that would blank them.
    expect(new Set(logs.map(l => l.mealGroupId)).size).toBe(1)
    expect(logs.every(l => l.savedMealId === 'meal-bf39')).toBe(true)
  })

  it('gives a SECOND logging of the same meal a different group', async () => {
    await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')
    const first = groupsFrom(fakeStore.upsertFoodLog)[0]
    vi.clearAllMocks()
    await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')
    const second = groupsFrom(fakeStore.upsertFoodLog)[0]

    // Same meal, same day, same meal type — and two servings the diary must keep apart.
    expect(second).not.toBe(first)
  })

  // LB-49 — one optional argument, applied at write time.
  //
  // The entry that asked for this got two things wrong, and both are worth knowing rather than
  // re-deriving. It named the function `logMealFromSaved`, which does not exist. And it justified
  // the lane by calling it "the single shared write function both server paths call, which is the
  // Canonical-Runtime rule the push branch is CI-gated on" — it is client-side, called only from
  // `food-logger-sheet.tsx` and `saved-meals-sheet.tsx`, and neither an API route nor
  // `pushMutations` touches it. Consequently the sync chain it demanded ("local table column,
  // queueMutation payload, pushMutations branch and pull mapping in the same PR") is not needed:
  // scaling at write time means the existing `quantityMultiplier` field carries the result, and no
  // schema, payload or push branch changes at all.
  //
  // It also named three write sites and there are five — both optimistic pushes were missed, which
  // is the pair that decides whether the diary agrees with the database.
  describe('scale (LB-49)', () => {
    it('scales every write site, so the stored row and the optimistic row agree', async () => {
      const logs = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1', undefined, 1.5)

      const stored = fakeStore.upsertFoodLog.mock.calls
        .map(c => (c[0] as { quantityMultiplier: number }).quantityMultiplier)
      const queued = fakeStore.queueMutation.mock.calls
        .map(c => (c[0] as { payload: { quantityMultiplier: number } }).payload.quantityMultiplier)

      expect(stored).toEqual([1.5, 1.5])
      expect(queued).toEqual([1.5, 1.5])
      expect(logs.map(l => l.quantityMultiplier)).toEqual([1.5, 1.5])
    })

    // The number the owner would see. Two 100 kcal ingredients at one serving are 200; at 1.5 they
    // are 300. Asserted as an absolute, not as a ratio against another computed value — a mutation
    // that scaled both sides would survive a relative assertion.
    it('the day gains the scaled calories, not the definition\u2019s', async () => {
      const whole = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')
      expect(whole.reduce((n, l) => n + l.calories, 0)).toBe(200)

      vi.clearAllMocks()
      const half = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1', undefined, 1.5)
      expect(half.reduce((n, l) => n + l.calories, 0)).toBe(300)
      expect(half.map(l => l.proteinG)).toEqual([7.5, 7.5])
    })

    // The guarantee that lets this ship ahead of any UI: every existing caller passes nothing.
    it('defaults to a whole serving, leaving today\u2019s output untouched', async () => {
      const explicit = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1', undefined, 1)
      const storedExplicit = fakeStore.upsertFoodLog.mock.calls
        .map(c => (c[0] as { quantityMultiplier: number }).quantityMultiplier)
      vi.clearAllMocks()
      const implicit = await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')
      const storedImplicit = fakeStore.upsertFoodLog.mock.calls
        .map(c => (c[0] as { quantityMultiplier: number }).quantityMultiplier)

      expect(storedExplicit).toEqual(storedImplicit)
      expect(explicit.map(l => l.calories)).toEqual(implicit.map(l => l.calories))
      expect(storedImplicit).toEqual([1, 1])
    })

    // A meal whose items are not one-to-one: the scale multiplies what is there rather than
    // replacing it, so a half-portion ingredient stays half of whatever was eaten.
    it('multiplies the per-item multiplier rather than replacing it', async () => {
      const meal = twoItemMeal()
      meal.items[0].quantityMultiplier = 0.5
      await logMealItems(meal, '2026-08-30', 'mt-1', 'u1', undefined, 1.5)

      expect(fakeStore.upsertFoodLog.mock.calls
        .map(c => (c[0] as { quantityMultiplier: number }).quantityMultiplier)).toEqual([0.75, 1.5])
    })
  })

  it('puts both on the queued mutation, or the server gets ungrouped rows', async () => {
    await logMealItems(twoItemMeal(), '2026-08-30', 'mt-1', 'u1')
    const payloads = fakeStore.queueMutation.mock.calls.map(c => (c[0] as { payload: Record<string, unknown> }).payload)
    expect(payloads).toHaveLength(2)
    for (const p of payloads) expect(p.savedMealId).toBe('meal-bf39')
    expect(new Set(payloads.map(p => p.mealGroupId)).size).toBe(1)
  })
})
