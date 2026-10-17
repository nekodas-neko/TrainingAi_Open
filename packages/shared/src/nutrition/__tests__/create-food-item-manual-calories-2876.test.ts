// #2876, device half. `createFoodItem` is the third write path that sanitises a food on its way in;
// the pure `sanitiseFoodItemNutrition` is tested in hand-entered-calories-2876.test.ts, but nothing
// there fails if this call goes back to the scan's unconditional repair, which reads untouched
// macro fields as 0 g and saved a typed 50 kcal food at 0 kcal.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    findFoodItemsByCalories: vi.fn().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    queueMutation: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateFoodItems: vi.fn(() => Promise.resolve()) }))

import { createFoodItem } from '../create-food-item'

const SNACK = { name: 'Hand-typed snack', servingSizeG: 30, calories: 50, proteinG: 0, carbsG: 0, fatG: 0 }

describe('createFoodItem keeps a hand-entered food\'s calories (#2876)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a manual 50 kcal food with no macros is stored, queued and returned at 50', async () => {
    const got = await createFoodItem({ ...SNACK, source: 'manual' }, 'u1')
    expect(got.calories).toBe(50)
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledWith(expect.objectContaining({ calories: 50 }))
    expect(fakeStore.queueMutation.mock.calls[0][0].payload).toMatchObject({ calories: 50 })
  })

  it('a scan of the same numbers is still repaired, so the source is what decides', async () => {
    const got = await createFoodItem({ ...SNACK, calories: 900, proteinG: 10, carbsG: 10, fatG: 2, source: 'barcode' }, 'u1')
    expect(got.calories).toBeLessThan(900)
  })
})
