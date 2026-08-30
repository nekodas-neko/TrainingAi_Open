// BF-38 — the web route must ASK for the existing row, and the offline push must not.
//
// The de-duplication itself is proven in `lib/data/postgres/__tests__/food-item-duplicate-create.ts`
// and the rule in `packages/shared/src/nutrition/__tests__/food-item-identity.test.ts`. What is left
// is one boolean at one call site, and a boolean nothing asserts is a boolean that quietly flips
// back: mutation testing showed removing `reuseExisting: true` here left every other test green.
//
// The flag is per-caller on purpose. An interactive create uses whatever id comes back, so reusing
// is safe; the offline push arrives with an id a queued `food_logs` mutation already references, so
// substituting a different one would break its foreign key.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createFoodItem = vi.fn(async (_userId: string, data: Record<string, unknown>) => ({
  id: 'server-id', userId: 'u1', ...data, createdAt: new Date(),
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ createFoodItem })) }))

import { POST } from '@/app/api/nutrition/food-items/route'

const post = (body: unknown) => POST(new Request('http://x/api/nutrition/food-items', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

const MAC_AND_CHEESE = {
  name: 'LOADED MAC & CHEESE', brand: 'CORE POWERFOODS',
  servingSizeG: 350, calories: 672, proteinG: 44, carbsG: 70, fatG: 22, source: 'ai',
}

describe('POST /api/nutrition/food-items', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('asks the repository to reuse an existing identical row', async () => {
    const res = await post(MAC_AND_CHEESE)
    expect(res.status).toBe(201)
    expect(createFoodItem).toHaveBeenCalledWith('u1', expect.anything(), { reuseExisting: true })
  })

  it('still sanitises before the match, so the candidate is what would be stored', async () => {
    // A duplicate is decided on the numbers that reach the column. Matching on the raw body would
    // miss every row that sanitiseNutrition had corrected on its way in.
    await post({ ...MAC_AND_CHEESE, calories: 9999 })
    const [, data] = createFoodItem.mock.calls[0]
    expect(data.calories).not.toBe(9999)
  })
})
