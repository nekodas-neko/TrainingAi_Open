// BF-38, device half — the duplicate must never reach the outbox.
//
// The server's own check (`lib/data/postgres/slices/nutrition.ts`) is deliberately OFF for the push
// branch, because that path arrives with an id a queued `food_logs` mutation already references and
// substituting a different one would break its foreign key. So on the device this function is the
// only thing standing between "the owner logged their usual lunch again" and a third
// `LOADED MAC & CHEESE` row. These cases pin that: on a match nothing is written, nothing is
// queued, and the id handed back is the existing one — which is what the caller then logs against.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FoodItem } from '../../types/nutrition'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    findFoodItemsByCalories: vi.fn<(calories: number) => Promise<FoodItem[]>>().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateFoodItems: vi.fn(() => Promise.resolve()) }))

import { createFoodItem } from '../create-food-item'

const MAC_AND_CHEESE = {
  name: 'LOADED MAC & CHEESE', brand: 'CORE POWERFOODS',
  servingSizeG: 350, calories: 672, proteinG: 44, carbsG: 70, fatG: 22,
  source: 'ai' as const,
}

const stored = (over: Partial<FoodItem> = {}): FoodItem => ({
  id: 'existing-1', userId: '', name: 'LOADED MAC & CHEESE', brand: 'CORE POWERFOODS',
  servingSizeG: 350, calories: 672, proteinG: 44, carbsG: 70, fatG: 22,
  source: 'ai', region: '', createdAt: new Date('2026-08-01T00:00:00Z'), ...over,
})

describe('createFoodItem — the device de-duplication (BF-38)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeStore.findFoodItemsByCalories.mockResolvedValue([])
  })

  it('returns the row the user already has, and writes nothing', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored()])
    const item = await createFoodItem(MAC_AND_CHEESE, 'u1')

    expect(item.id).toBe('existing-1')
    // The three things that must NOT happen — a write, an outbox entry, a second id in flight.
    expect(fakeStore.upsertFoodItem).not.toHaveBeenCalled()
    expect(fakeStore.queueMutation).not.toHaveBeenCalled()
  })

  it('looks the candidates up by the calories it is about to store, not the raw input', async () => {
    // sanitiseNutrition runs first and the column is an integer, so a candidate set fetched with
    // the pre-rounding value would miss the row it is itself a duplicate of.
    await createFoodItem({ ...MAC_AND_CHEESE, calories: 672.4 }, 'u1')
    expect(fakeStore.findFoodItemsByCalories).toHaveBeenCalledWith(672)
  })

  it('writes and queues as before when nothing matches', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored({ servingSizeG: 300 })])
    const item = await createFoodItem(MAC_AND_CHEESE, 'u1')

    expect(item.id).not.toBe('existing-1')
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledTimes(1)
    expect(fakeStore.queueMutation).toHaveBeenCalledTimes(1)
    expect(fakeStore.queueMutation).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', domain: 'food_items',
    }))
  })

  it('does not reuse a row that differs in a number a log depends on', async () => {
    // mandarin: 42 kcal/80 g and 53 kcal/100 g in production. Same density, different servings —
    // and food_logs multiplies against the serving, so reusing one for the other changes the log.
    fakeStore.findFoodItemsByCalories.mockResolvedValue([
      stored({ id: 'mandarin-100', name: 'Mandarin', brand: undefined, servingSizeG: 100, calories: 53, proteinG: 0.8, carbsG: 13.3, fatG: 0.3 }),
    ])
    const item = await createFoodItem({
      name: 'Mandarin', servingSizeG: 100, calories: 53, proteinG: 0.8, carbsG: 13.3, fatG: 0.4,
      source: 'ai',
    }, 'u1')
    expect(item.id).not.toBe('mandarin-100')
    expect(fakeStore.queueMutation).toHaveBeenCalledTimes(1)
  })

  it('matches through the case and whitespace the model varies between calls', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored()])
    const item = await createFoodItem({
      ...MAC_AND_CHEESE, name: '  loaded   mac & cheese', brand: 'core powerfoods ',
    }, 'u1')
    expect(item.id).toBe('existing-1')
    expect(fakeStore.queueMutation).not.toHaveBeenCalled()
  })
})
