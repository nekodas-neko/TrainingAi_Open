/**
 * Issue 2219 (BF-35). A barcode scan, end to end with a fixture standing in for Open Food Facts:
 * lookup route -> the entry the capture sheet builds -> the outbox payload that becomes the
 * `food_items` row. Nothing here touches the network; `fetch` is stubbed and every URL it is asked
 * for is recorded.
 *
 * The field names in the fixture are the ones the app reads (`code`, `image_front_thumb_url`,
 * `image_thumb_url`) and the ones OFF's v2 product API documents for them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getMealTypes:   vi.fn().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    upsertFoodLog:  vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-2219' } }) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateNutritionWrite: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/meal-reminders', () => ({ cancelMealReminder: vi.fn(() => Promise.resolve()) }))

import { GET as getBarcode } from '@/app/api/nutrition/barcode/route'
import { logFoodEntries, scanOriginToSource } from '@trainingai/shared/nutrition/log-food'
import { FoodItemPushSchema } from '@trainingai/shared/validation/food-item'
import { rejectMealImage, FOOD_ITEM_IMAGE_MAX_BYTES } from '@trainingai/shared/nutrition/meal-image'
import { OFF_ATTRIBUTION } from '@trainingai/shared/nutrition/open-food-facts'
import type { NutritionScanResult } from '@trainingai/shared/types/nutrition'

const CODE = '9300675024235'
const THUMB = 'https://images.openfoodfacts.org/images/products/930/067/502/4235/front_en.3.100.jpg'
const JPEG = new Uint8Array(2048).fill(0x41)

const product = (over: Record<string, unknown> = {}) => ({
  status: 1,
  product: {
    code: CODE, product_name: 'Sunsol Granola', brands: 'Sunsol', serving_size: '45 g',
    nutriments: { 'energy-kcal_100g': 440, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 16 },
    image_front_thumb_url: THUMB,
    ...over,
  },
})

const requested: { url: string; init?: RequestInit }[] = []

function stubOff(body: unknown, image: { bytes?: Uint8Array; type?: string } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requested.push({ url, init })
    if (url.includes('/api/v2/product/')) {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response((image.bytes ?? JPEG) as unknown as BodyInit, { status: 200, headers: { 'content-type': image.type ?? 'image/jpeg' } })
  }))
}

const scan = async () => {
  const res = await getBarcode(new Request(`http://localhost/api/nutrition/barcode?code=${CODE}`))
  return { res, body: await res.json() as NutritionScanResult & { notFound?: boolean } }
}

beforeEach(() => { requested.length = 0; vi.clearAllMocks() })
afterEach(() => vi.unstubAllGlobals())

describe('barcode lookup -> stored row', () => {
  it('a product with a picture lands with a NON-NULL barcode and image in the queued row', async () => {
    stubOff(product())
    const { res, body } = await scan()
    expect(res.status).toBe(200)
    expect(body.barcode).toBe(CODE)
    expect(body.imageDataUri).toMatch(/^data:image\/jpeg;base64,/)

    // What food-logger-sheet builds from the scan result: source from the origin, the code from the
    // result, the picture from the form.
    await logFoodEntries([{
      name: body.name, brand: body.brand, servingSizeG: body.servingSizeG, calories: body.calories,
      proteinG: body.proteinG, carbsG: body.carbsG, fatG: body.fatG, quantityMultiplier: 1,
      source: scanOriginToSource(body.origin), barcode: body.barcode, imageDataUri: body.imageDataUri,
    }], '2026-10-01', 'meal-type-1', 'u-2219', 'Australia/Brisbane')

    const queued = fakeStore.queueMutation.mock.calls.find(([m]) => m.domain === 'food_items')![0].payload
    expect(queued.source).toBe('barcode')
    expect(queued.barcode).toBe(CODE)
    expect(queued.imageDataUri).toBe(body.imageDataUri)
    const parsed = FoodItemPushSchema.parse(queued)
    expect(rejectMealImage(parsed.imageDataUri, FOOD_ITEM_IMAGE_MAX_BYTES)).toBeNull()
  })

  it('the thumbnail is fetched once, from the Open Food Facts host, over https, refusing redirects', async () => {
    stubOff(product())
    await scan()
    const imageCalls = requested.filter(r => !r.url.includes('/api/v2/product/'))
    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0].url).toBe(THUMB)
    expect(imageCalls[0].init?.redirect).toBe('error')
    expect(imageCalls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a product with no picture still scans, and the image stays null (the placeholder)', async () => {
    stubOff(product({ image_front_thumb_url: undefined }))
    const { res, body } = await scan()
    expect(res.status).toBe(200)
    expect(body.barcode).toBe(CODE)
    expect(body.imageDataUri).toBeNull()
    expect(requested.filter(r => !r.url.includes('/api/v2/product/'))).toHaveLength(0)
  })

  it('falls back to the product\'s generic thumbnail when no front image is selected', async () => {
    const generic = 'https://images.openfoodfacts.org/images/products/930/067/502/4235/1.100.jpg'
    stubOff(product({ image_front_thumb_url: undefined, image_thumb_url: generic }))
    const { body } = await scan()
    expect(body.imageDataUri).toMatch(/^data:image\/jpeg/)
    expect(requested.some(r => r.url === generic)).toBe(true)
  })

  it('a picture over the cap is dropped, never stored unbounded', async () => {
    stubOff(product(), { bytes: new Uint8Array(FOOD_ITEM_IMAGE_MAX_BYTES + 1).fill(0x41) })
    const { res, body } = await scan()
    expect(res.status).toBe(200)
    expect(body.imageDataUri).toBeNull()
  })

  it('never fetches an image URL that is not on openfoodfacts.org (server-side request forgery)', async () => {
    for (const bad of [
      'http://images.openfoodfacts.org/x.jpg',
      'https://evil.example.com/x.jpg',
      'https://openfoodfacts.org.evil.example.com/x.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://user:pw@images.openfoodfacts.org/x.jpg',
    ]) {
      requested.length = 0
      stubOff(product({ image_front_thumb_url: bad }))
      const { res, body } = await scan()
      expect(res.status, bad).toBe(200)
      expect(body.imageDataUri, bad).toBeNull()
      expect(requested.filter(r => !r.url.includes('/api/v2/product/')), bad).toHaveLength(0)
    }
  })
})

describe('Open Food Facts attribution', () => {
  it('names the source and both licences', () => {
    expect(OFF_ATTRIBUTION).toMatch(/Open Food Facts/)
    expect(OFF_ATTRIBUTION).toMatch(/CC BY-SA/)
    expect(OFF_ATTRIBUTION).toMatch(/Open Database Licence/)
  })

  it('is rendered on the About screen', () => {
    const about = readFileSync(path.resolve(__dirname, '../../components/more/about-panel.tsx'), 'utf8')
    expect(about).toMatch(/\{OFF_ATTRIBUTION\}/)
  })
})
