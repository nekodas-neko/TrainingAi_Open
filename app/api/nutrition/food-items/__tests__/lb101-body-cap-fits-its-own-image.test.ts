// LB-101 — the route capped its whole body BELOW the image it permits.
//
// `MAX_BODY_BYTES` was a flat `8 * 1024`, written when the route carried no image at all. BF-35 then
// gave it `imageDataUri` with a 16 KB cap of its own — and base64 costs a third more than the bytes
// it encodes, so an image at its own permitted size is ~21.8 KB on the wire. `readJsonLimited` runs
// BEFORE `rejectMealImage`, so the save came back 413 and **the user lost the food, not the picture**.
//
// Measured 2026-09-13 driving the real capture flow: a 128 px WebP of a detailed source came back
// 6,612 bytes = 8,816 base64 characters and 413'd; a smooth photo-like source came back 1,410 and
// fitted. It bit detailed photos, not every photo, which is why BF-35's own testing missed it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FOOD_ITEM_IMAGE_MAX_BYTES, rejectMealImage } from '@trainingai/shared/nutrition/meal-image'

const createFoodItem = vi.fn(async (_userId: string, data: Record<string, unknown>) => ({
  id: 'server-id', userId: 'u1', ...data, createdAt: new Date(),
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ createFoodItem })) }))

import { POST } from '@/app/api/nutrition/food-items/route'

const post = (body: unknown) => POST(new Request('http://x/api/nutrition/food-items', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

const FOOD = {
  name: 'LOADED MAC & CHEESE', brand: 'CORE POWERFOODS',
  servingSizeG: 350, calories: 672, proteinG: 44, carbsG: 70, fatG: 22, source: 'ai',
}

/** A data URI whose DECODED payload is `bytes` — which is what the image cap is expressed in. */
const imageOf = (bytes: number) =>
  `data:image/webp;base64,${Buffer.alloc(bytes, 0x7f).toString('base64')}`

describe('the body cap admits an image at the size the route itself permits', () => {
  beforeEach(() => { vi.clearAllMocks() })

  /**
   * Just under the cap, not exactly at it, and the reason is worth knowing rather than rediscovering.
   * `mealImageBytes` is `ceil(base64Length * 0.75)`, which **ignores base64 padding**, so an image
   * whose decoded size is exactly 16,384 measures as 16,386 and `rejectMealImage` refuses it. The
   * effective cap is therefore about two bytes under the advertised one. That errs strict rather than
   * permissive and is left alone — but it means the exact-cap boundary belongs to the image validator,
   * not to the body cap this file is about, so asserting on it here would be testing the wrong thing.
   */
  it('accepts an image at the permitted size', async () => {
    const image = imageOf(FOOD_ITEM_IMAGE_MAX_BYTES - 16)
    expect(rejectMealImage(image, FOOD_ITEM_IMAGE_MAX_BYTES), 'premise: the validator permits it').toBeNull()
    const res = await post({ ...FOOD, imageDataUri: image })
    expect(res.status).not.toBe(413)
    expect(createFoodItem).toHaveBeenCalled()
  })

  /**
   * The measured case, and the one the workaround exists for: 6,612 bytes → 8,816 base64 characters,
   * which cleared the old 8,192-byte body cap on its own before the food's fields were even counted.
   */
  it('accepts the 6,612-byte thumbnail that was measured failing', async () => {
    const res = await post({ ...FOOD, imageDataUri: imageOf(6_612) })
    expect(res.status).not.toBe(413)
  })

  /**
   * The cap is DERIVED, not restated — that is the whole fix. Raising the image cap must raise this
   * by construction, because the two drifting apart is what produced the bug.
   */
  it('leaves room for the food-s own fields on top of a full-size image', async () => {
    const full = imageOf(FOOD_ITEM_IMAGE_MAX_BYTES - 16)
    const wire = JSON.stringify({ ...FOOD, imageDataUri: full }).length
    // Base64 of the image alone, before the name, brand and a dozen macro numbers.
    expect(full.length).toBeGreaterThan(Math.ceil(FOOD_ITEM_IMAGE_MAX_BYTES * 4 / 3))
    const res = await post({ ...FOOD, imageDataUri: full })
    expect(res.status, `a ${wire}-byte body must not 413`).not.toBe(413)
  })

  /**
   * The cap still caps. Raising it to fit one image must not turn the route into an open door — an
   * oversized image is refused by `rejectMealImage` with a message, which is a different outcome
   * from a 413 that says nothing about what was wrong.
   */
  it('still refuses an image well past the cap, and says why', async () => {
    const res = await post({ ...FOOD, imageDataUri: imageOf(FOOD_ITEM_IMAGE_MAX_BYTES * 4) })
    expect(res.status).not.toBe(201)
    expect(createFoodItem).not.toHaveBeenCalled()
  })

  it('still refuses a body that is simply enormous', async () => {
    const res = await post({ ...FOOD, name: 'x'.repeat(64 * 1024) })
    expect(res.status).toBe(413)
    expect(createFoodItem).not.toHaveBeenCalled()
  })
})
