/**
 * Issue 2219 (BF-35). A scanned food's barcode and picture reach the SERVER, not only the phone.
 *
 * Production read 2026-09-24: 1 of 41 barcode-sourced food items carried an image. The device had
 * the picture all along; `logFoodEntries` (the path the capture sheet saves through) wrote it to the
 * local row and then queued the `food_items` outbox mutation WITHOUT it, so the server row stayed
 * NULL — and the next pull, which overwrites the local row with the server's, took the picture off
 * the phone as well. The sibling path (`createFoodItem`) carried it, which is why the one image
 * that did land came from there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FoodItemPushSchema } from '../../validation/food-item'
import { rejectMealImage, FOOD_ITEM_IMAGE_MAX_BYTES } from '../meal-image'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getMealTypes:   vi.fn().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    upsertFoodLog:  vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateNutritionWrite: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/meal-reminders', () => ({ cancelMealReminder: vi.fn(() => Promise.resolve()) }))

import { logFoodEntries, type NewFoodEntry } from '../log-food'

// A real (tiny) PNG, so the data URI passes the same validator the server runs.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const IMAGE = `data:image/png;base64,${PNG_B64}`

const SCANNED: NewFoodEntry = {
  name: 'Sunsol Granola', brand: 'Sunsol', servingSizeG: 45, calories: 200,
  proteinG: 5, carbsG: 28, fatG: 7, quantityMultiplier: 1,
  source: 'barcode', barcode: '9300675024235', imageDataUri: IMAGE,
}

function foodItemPayload() {
  const call = fakeStore.queueMutation.mock.calls.find(([m]) => m.domain === 'food_items')
  return call?.[0].payload as Record<string, unknown>
}

describe('logFoodEntries carries a scan\'s barcode and picture to the outbox', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('queues a food_items mutation with a NON-NULL barcode and imageDataUri', async () => {
    await logFoodEntries([SCANNED], '2026-10-01', 'meal-type-1', 'u1', 'Australia/Brisbane')
    const payload = foodItemPayload()
    expect(payload.barcode).toBe('9300675024235')
    expect(payload.imageDataUri).toBe(IMAGE)
  })

  it('the local row and the queued mutation agree on the picture', async () => {
    await logFoodEntries([SCANNED], '2026-10-01', 'meal-type-1', 'u1', 'Australia/Brisbane')
    const local = fakeStore.upsertFoodItem.mock.calls[0][0]
    expect(local.imageDataUri).toBe(foodItemPayload().imageDataUri)
    expect(local.barcode).toBe(foodItemPayload().barcode)
  })

  it('the queued payload passes the server\'s push schema and image validator unchanged', async () => {
    await logFoodEntries([SCANNED], '2026-10-01', 'meal-type-1', 'u1', 'Australia/Brisbane')
    const parsed = FoodItemPushSchema.safeParse(foodItemPayload())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(rejectMealImage(parsed.data.imageDataUri, FOOD_ITEM_IMAGE_MAX_BYTES)).toBeNull()
      expect(parsed.data.barcode).toBe('9300675024235')
    }
  })

  it('a typed food queues no picture and still validates (null is the placeholder)', async () => {
    await logFoodEntries(
      [{ ...SCANNED, source: 'manual', barcode: undefined, imageDataUri: null }],
      '2026-10-01', 'meal-type-1', 'u1', 'Australia/Brisbane',
    )
    const payload = foodItemPayload()
    expect(payload.imageDataUri ?? null).toBeNull()
    expect(FoodItemPushSchema.safeParse(payload).success).toBe(true)
  })

  it('the web fallback POST body also carries the barcode and picture', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'fi-1' }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await logFoodEntries([SCANNED], '2026-10-01', 'meal-type-1', undefined, 'Australia/Brisbane')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.barcode).toBe('9300675024235')
      expect(body.imageDataUri).toBe(IMAGE)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
