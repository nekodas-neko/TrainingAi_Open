// #2813 — GET /api/nutrition/food-items/[id]: the route's own rules. The ownership scoping itself is
// proven against Postgres in lib/data/postgres/__tests__/read-food-item-and-supplement-day.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ID = '11111111-1111-4111-8111-111111111111'
const item = { id: ID, userId: 'u1', name: 'Oats', brand: null, servingSizeG: 40, calories: 150 }

const getFoodItemById = vi.fn(async (..._a: unknown[]) => item as typeof item | null)
const auth = vi.fn(async () => ({ user: { id: 'u1' } }) as { user: { id: string } } | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

vi.mock('@/auth', () => ({ auth: () => auth() }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getFoodItemById })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))

import { GET } from '@/app/api/nutrition/food-items/[id]/route'

const get = (id: string) => GET(new Request(`http://x/api/nutrition/food-items/${id}`), { params: Promise.resolve({ id }) })

describe('GET /api/nutrition/food-items/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'u1' } })
    rateLimit.mockReturnValue(true)
    getFoodItemById.mockResolvedValue(item)
  })

  it('returns the owner their item, scoped to the session user, private and uncached', async () => {
    const res = await get(ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: ID, name: 'Oats' })
    expect(getFoodItemById).toHaveBeenCalledWith('u1', ID)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('answers 404 when the repository finds nothing (unknown id and another user\'s id look the same)', async () => {
    getFoodItemById.mockResolvedValue(null)
    const res = await get(ID)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('answers 400 for a malformed id without touching the repository', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
    expect(getFoodItemById).not.toHaveBeenCalled()
  })

  it('answers 401 with no session and 429 over the rate limit', async () => {
    auth.mockResolvedValue(null)
    expect((await get(ID)).status).toBe(401)
    auth.mockResolvedValue({ user: { id: 'u1' } })
    rateLimit.mockReturnValue(false)
    expect((await get(ID)).status).toBe(429)
    expect(getFoodItemById).not.toHaveBeenCalled()
  })
})
