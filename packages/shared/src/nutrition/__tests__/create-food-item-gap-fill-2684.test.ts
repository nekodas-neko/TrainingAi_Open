// Issue 2684, device half. `createFoodItem` returns the saved duplicate (BF-38); when that copy is a
// pre-fix row with no picture or barcode and the scan just fetched them, they were thrown away.
// Now the gap is filled on the saved row — same id, add-only — and the change rides the outbox.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FoodItem } from '../../types/nutrition'
import { FoodItemPushSchema } from '../../validation/food-item'
import { FOOD_ITEM_IMAGE_MAX_BYTES } from '../meal-image'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    findFoodItemsByCalories: vi.fn<(calories: number) => Promise<FoodItem[]>>().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    queueMutation: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateFoodItems: vi.fn(() => Promise.resolve()) }))

import { createFoodItem } from '../create-food-item'

const BAR = {
  name: 'Protein Bar', brand: 'Acme', servingSizeG: 40, calories: 150, proteinG: 20, carbsG: 10, fatG: 5,
  source: 'barcode' as const,
}
const PIC = 'data:image/webp;base64,AAAA'

const stored = (over: Partial<FoodItem> = {}): FoodItem => ({
  id: 'existing-1', userId: '', name: 'Protein Bar', brand: 'Acme',
  servingSizeG: 40, calories: 150, proteinG: 20, carbsG: 10, fatG: 5,
  source: 'barcode', region: '', createdAt: new Date('2026-08-01T00:00:00Z'), ...over,
})

describe('createFoodItem fills a saved duplicate\'s missing picture and barcode (issue 2684)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored()])
  })

  it('an imageless, code-less duplicate gains both, under the SAME id, locally and in the outbox', async () => {
    const got = await createFoodItem({ ...BAR, imageDataUri: PIC, barcode: '9300000000017' }, 'u1')
    expect(got).toMatchObject({ id: 'existing-1', imageDataUri: PIC, barcode: '9300000000017' })
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'existing-1', imageDataUri: PIC, barcode: '9300000000017', name: 'Protein Bar',
    }))
    const mut = fakeStore.queueMutation.mock.calls[0][0]
    expect(mut.domain).toBe('food_items')
    expect(mut.payload).toMatchObject({ id: 'existing-1', imageDataUri: PIC, barcode: '9300000000017' })
    // The queued payload must clear the same schema the push branch parses it with, null fields included.
    expect(FoodItemPushSchema.safeParse(JSON.parse(JSON.stringify(mut.payload))).success).toBe(true)
  })

  it('a duplicate that already has a picture keeps it; only the barcode is added', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored({ imageDataUri: 'data:image/webp;base64,OLD' })])
    const got = await createFoodItem({ ...BAR, imageDataUri: PIC, barcode: '123' }, 'u1')
    expect(got).toMatchObject({ imageDataUri: 'data:image/webp;base64,OLD', barcode: '123' })
  })

  it('a different non-null barcode is not overwritten, and with nothing else to add nothing is written', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored({ barcode: '111', imageDataUri: PIC })])
    const got = await createFoodItem({ ...BAR, imageDataUri: 'data:image/webp;base64,NEW', barcode: '222' }, 'u1')
    expect(got.barcode).toBe('111')
    expect(got.imageDataUri).toBe(PIC)
    expect(fakeStore.upsertFoodItem).not.toHaveBeenCalled()
    expect(fakeStore.queueMutation).not.toHaveBeenCalled()
  })

  it('a different barcode is kept while a missing picture is still filled', async () => {
    fakeStore.findFoodItemsByCalories.mockResolvedValue([stored({ barcode: '111' })])
    const got = await createFoodItem({ ...BAR, imageDataUri: PIC, barcode: '222' }, 'u1')
    expect(got).toMatchObject({ barcode: '111', imageDataUri: PIC })
    expect(fakeStore.queueMutation.mock.calls[0][0].payload).toMatchObject({ barcode: '111', imageDataUri: PIC })
  })

  it('a scan that offers neither writes nothing', async () => {
    await createFoodItem(BAR, 'u1')
    expect(fakeStore.upsertFoodItem).not.toHaveBeenCalled()
    expect(fakeStore.queueMutation).not.toHaveBeenCalled()
  })

  it('an over-cap picture is dropped for the picture only; the barcode still fills', async () => {
    const huge = 'data:image/webp;base64,' + 'A'.repeat(FOOD_ITEM_IMAGE_MAX_BYTES * 2)
    const got = await createFoodItem({ ...BAR, imageDataUri: huge, barcode: '555' }, 'u1')
    expect(got.imageDataUri ?? null).toBeNull()
    expect(got.barcode).toBe('555')
  })
})
