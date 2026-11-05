// #3476 — GET /api/nutrition/food-items/retired: the route's own rules. What the repository reads is
// proven against Postgres in lib/nutrition/__tests__/merge-look-alike-foods.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const answer = { retired: [{ id: 'r1', deletedAt: '2026-11-05T10:00:00.000Z' }], keepers: [{ id: 'k1', name: 'Oats' }] }
const listRetiredFoodItems = vi.fn(async (..._a: unknown[]) => answer)
const auth = vi.fn(async () => ({ user: { id: 'u1' } }) as { user: { id: string } } | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

vi.mock('@/auth', () => ({ auth: () => auth() }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ listRetiredFoodItems })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))

import { GET } from '@/app/api/nutrition/food-items/retired/route'

const get = (query = '') => GET(new Request(`http://x/api/nutrition/food-items/retired${query}`))

describe('GET /api/nutrition/food-items/retired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'u1' } })
    rateLimit.mockReturnValue(true)
  })

  it('reads from ten minutes before the cursor, for the session user, private and uncached', async () => {
    const res = await get('?since=2026-11-05T10:00:00.000Z')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject(answer)
    expect(Date.parse(body.at)).not.toBeNaN()
    const [userId, since] = listRetiredFoodItems.mock.calls[0] as [string, Date]
    expect(userId).toBe('u1')
    expect(since.toISOString()).toBe('2026-11-05T09:50:00.000Z')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('reads from the beginning with no cursor', async () => {
    await get()
    expect((listRetiredFoodItems.mock.calls[0] as [string, Date])[1].getTime()).toBe(0)
  })

  it('answers 400 for a cursor that is not a timestamp, without reading', async () => {
    for (const bad of ['?since=yesterday', '?since=2026-11-05', '?since=']) {
      expect((await get(bad)).status).toBe(400)
    }
    expect(listRetiredFoodItems).not.toHaveBeenCalled()
  })

  it('answers 401 with no session and 429 over the rate limit', async () => {
    auth.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    auth.mockResolvedValue({ user: { id: 'u1' } })
    rateLimit.mockReturnValue(false)
    expect((await get()).status).toBe(429)
    expect(listRetiredFoodItems).not.toHaveBeenCalled()
  })
})
