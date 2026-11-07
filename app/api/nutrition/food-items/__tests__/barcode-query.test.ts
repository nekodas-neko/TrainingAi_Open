// #3651 — GET /api/nutrition/food-items?barcode=: a scan resolves against the whole library. The
// read itself is proven against Postgres in lib/data/postgres/__tests__/food-items-by-barcode.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const searchFoodItems = vi.fn(async (..._a: unknown[]) => [{ id: 'newest' }])
const findFoodItemsByBarcode = vi.fn(async (..._a: unknown[]) => [{ id: 'scanned' }])
const auth = vi.fn(async () => ({ user: { id: 'u1' } }) as { user: { id: string } } | null)

vi.mock('@/auth', () => ({ auth: () => auth() }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ searchFoodItems, findFoodItemsByBarcode })) }))

import { GET } from '@/app/api/nutrition/food-items/route'

const get = (query: string) => GET(new Request(`http://x/api/nutrition/food-items${query}`))

describe('GET /api/nutrition/food-items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'u1' } })
  })

  it('reads by barcode for the session user, private and uncached', async () => {
    const res = await get('?barcode=9300000000011')
    expect(await res.json()).toEqual([{ id: 'scanned' }])
    expect(findFoodItemsByBarcode).toHaveBeenCalledWith('u1', '9300000000011')
    expect(searchFoodItems).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('keeps the name search for q', async () => {
    expect(await (await get('?q=oats')).json()).toEqual([{ id: 'newest' }])
    expect(searchFoodItems).toHaveBeenCalledWith('u1', 'oats')
    expect(findFoodItemsByBarcode).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty or oversized barcode without reading, and 401 with no session', async () => {
    for (const bad of ['?barcode=', '?barcode=%20', `?barcode=${'1'.repeat(65)}`]) {
      expect((await get(bad)).status).toBe(400)
    }
    expect(findFoodItemsByBarcode).not.toHaveBeenCalled()
    auth.mockResolvedValue(null)
    expect((await get('?barcode=9300000000011')).status).toBe(401)
  })
})
