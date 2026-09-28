// LB-158. `food_items.barcode` existed on the server, in the Zod schema, in the outbox push
// branch (Q-131 fixed that half) and in `rowToFoodItem` — and held nothing, because no client
// ever SET it. Measured in production on 2026-09-26: 341 of the owner's food items, **zero**
// barcodes, including all 42 whose `source` is literally `'barcode'`.
//
// These pin the chain end to end: the code reaches the created row, it reaches the outbox, and
// the next scan of the same product is answered from the library instead of the network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FoodItem } from '../../types/nutrition'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    findFoodItemsByCalories: vi.fn<(calories: number) => Promise<FoodItem[]>>().mockResolvedValue([]),
    getFoodItemByBarcode: vi.fn<(code: string) => Promise<FoodItem | null>>().mockResolvedValue(null),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateFoodItems: vi.fn(() => Promise.resolve()) }))

import { createFoodItem } from '../create-food-item'
import { lookupBarcode, foodItemToScanResult } from '../barcode-lookup'

const TIN = {
  name: 'Chickpeas', brand: 'Edgell', servingSizeG: 100,
  calories: 120, proteinG: 7, carbsG: 15, fatG: 2,
  source: 'barcode' as const,
}

const saved = (over: Partial<FoodItem> = {}): FoodItem => ({
  id: 'saved-1', userId: '', name: 'Chickpeas', brand: 'Edgell',
  servingSizeG: 100, calories: 120, proteinG: 7, carbsG: 15, fatG: 2,
  source: 'barcode', region: '', barcode: '9300601000876',
  createdAt: new Date('2026-09-01T00:00:00Z'), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  fakeStore.findFoodItemsByCalories.mockResolvedValue([])
  fakeStore.getFoodItemByBarcode.mockResolvedValue(null)
})

describe('createFoodItem carries the barcode', () => {
  it('writes it to the local row and the outbox payload', async () => {
    const item = await createFoodItem({ ...TIN, barcode: '9300601000876' }, 'user-1')

    expect(item.barcode).toBe('9300601000876')
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: '9300601000876' }),
    )
    // The push branch reads `p.barcode` off this payload — it has since Q-131, against a field
    // no client sent. This is the half that was missing.
    expect(fakeStore.queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ barcode: '9300601000876' }),
      }),
    )
  })

  // Every other create path — typed by hand, a photo scan, an OFF text search — has no code, and
  // must not invent one.
  it('leaves it absent when the food did not come from a scan', async () => {
    const item = await createFoodItem({ ...TIN, source: 'manual' }, 'user-1')
    expect(item.barcode).toBeUndefined()
    expect(fakeStore.upsertFoodItem).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: null }),
    )
  })
})

describe('lookupBarcode', () => {
  it('answers from the library without touching the network', async () => {
    const stored = saved()
    fakeStore.getFoodItemByBarcode.mockResolvedValue(stored)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const found = await lookupBarcode('9300601000876', 'user-1')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(found.kind).toBe('found')
    // The stored row itself, so the caller reuses the id its logs already point at rather than
    // creating a second row and leaning on BF-38 to collapse it.
    expect(found.kind === 'found' && found.localItem).toBe(stored)
    fetchSpy.mockRestore()
  })

  it('falls through to the route when the library has never seen the code', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Chickpeas', barcode: '9300601000876' }), { status: 200 }),
    )
    const found = await lookupBarcode('9300601000876', 'user-1')
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(found.kind === 'found' && found.localItem).toBeNull()
    fetchSpy.mockRestore()
  })

  // The route draws this line and the reason is in its own comment: a database that is down is
  // not a product that does not exist, and the two send the user somewhere different.
  it('keeps unavailable, notFound and a dead request apart', async () => {
    const cases: [Response | Error, string][] = [
      [new Response(JSON.stringify({ unavailable: true }), { status: 503 }), 'unavailable'],
      [new Response(JSON.stringify({ notFound: true }), { status: 404 }), 'notFound'],
      [new Response(JSON.stringify({ error: 'boom' }), { status: 500 }), 'error'],
      [new Error('offline'), 'error'],
    ]
    for (const [outcome, kind] of cases) {
      const fetchSpy = outcome instanceof Error
        ? vi.spyOn(globalThis, 'fetch').mockRejectedValue(outcome)
        : vi.spyOn(globalThis, 'fetch').mockResolvedValue(outcome)
      expect((await lookupBarcode('9300601000876', 'user-1')).kind).toBe(kind)
      fetchSpy.mockRestore()
    }
  })

  // No signed-in user means no store, so there is nothing to ask — but the route still answers.
  it('goes straight to the route with no user', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Chickpeas' }), { status: 200 }),
    )
    expect((await lookupBarcode('9300601000876')).kind).toBe('found')
    expect(fakeStore.getFoodItemByBarcode).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('foodItemToScanResult', () => {
  it('re-states a saved food as a barcode result, code included', () => {
    const r = foodItemToScanResult(saved())
    expect(r.barcode).toBe('9300601000876')
    expect(r.origin).toBe('barcode')
    expect(r.name).toBe('Chickpeas')
    expect(r.calories).toBe(120)
  })
})

describe('the local upsert must not erase a stored code', () => {
  const backend = readFileSync(
    join(process.cwd(), 'lib/local-store/sqlite-backend.ts'), 'utf8',
  )

  /**
   * The reachable case, and the reason this is COALESCE rather than `excluded`: a product is
   * scanned once (code stored), and every later write to that same id offers null — logging it
   * again from Recent, a saved meal that contains it, a hydrate from a payload that lacks the
   * column. Under `barcode=excluded.barcode` the first of those wipes it and the feature is dead
   * on the second scan.
   */
  it('COALESCEs the barcode on conflict, unlike every other column', () => {
    expect(backend).toMatch(/barcode\s*=\s*COALESCE\(\s*excluded\.barcode\s*,\s*food_items\.barcode\s*\)/i)
    expect(backend).not.toMatch(/barcode\s*=\s*excluded\.barcode(?!\s*,\s*food_items)/i)
  })

  it('selects the column in the pull delta, or the device mirrors nothing', () => {
    const adapter = readFileSync(
      join(process.cwd(), 'lib/data/postgres/adapter.ts'), 'utf8',
    )
    expect(adapter).toMatch(/barcode:\s*s\.foodItems\.barcode/)
  })
})
