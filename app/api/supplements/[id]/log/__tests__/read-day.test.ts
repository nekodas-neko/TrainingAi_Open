// #2813 — GET /api/supplements/[id]/log?date=: parameter handling and error mapping. The manual /
// food-derived split and the ownership scoping run against Postgres in
// lib/data/postgres/__tests__/read-food-item-and-supplement-day.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { NotFoundError } from '@trainingai/shared/errors'

const ID = '22222222-2222-4222-8222-222222222222'
const day = { supplementId: ID, date: '2026-10-15', supplementDeleted: false, manual: null, foodDerived: [], total: null }

const getSupplementDayLog = vi.fn(async (..._a: unknown[]) => day as unknown)
const auth = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Pacific/Auckland' } }) as { user: { id: string; timezone: string } } | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

vi.mock('@/auth', () => ({ auth: () => auth() }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getSupplementDayLog })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))

import { GET } from '@/app/api/supplements/[id]/log/route'

const get = (id: string, qs: string) =>
  GET(new NextRequest(`http://x/api/supplements/${id}/log${qs}`), { params: Promise.resolve({ id }) })

describe('GET /api/supplements/[id]/log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'u1', timezone: 'Pacific/Auckland' } })
    rateLimit.mockReturnValue(true)
    getSupplementDayLog.mockResolvedValue(day)
  })

  it('returns the day for the session user, private and uncached', async () => {
    const res = await get(ID, '?date=2026-10-15')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(day)
    expect(getSupplementDayLog).toHaveBeenCalledWith('u1', ID, '2026-10-15')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('accepts the slash form the client emits and queries by the dash-keyed date', async () => {
    await get(ID, '?date=2026/10/15')
    expect(getSupplementDayLog).toHaveBeenCalledWith('u1', ID, '2026-10-15')
  })

  it('passes a local-midnight date straight through in a zone far from UTC', async () => {
    // 2026-10-15 00:00 in Auckland (UTC+13) is still 2026-10-14 in UTC. The date is the user's local
    // day as given; converting it through UTC would read the wrong day.
    await get(ID, '?date=2026-10-15')
    expect(getSupplementDayLog.mock.calls[0][2]).toBe('2026-10-15')
  })

  it.each(['', '?date=', '?date=15-10-2026', '?date=2026-02-31', '?date=2026-13-45', '?date=2026-10-15T00:00'])(
    'answers 400 for a missing or impossible date (%s)', async (qs) => {
      expect((await get(ID, qs)).status).toBe(400)
      expect(getSupplementDayLog).not.toHaveBeenCalled()
    })

  it('answers 400 for a malformed supplement id', async () => {
    expect((await get('nope', '?date=2026-10-15')).status).toBe(400)
    expect(getSupplementDayLog).not.toHaveBeenCalled()
  })

  it('answers 404 when the repository refuses the supplement as not the user\'s', async () => {
    getSupplementDayLog.mockRejectedValue(new NotFoundError('Supplement'))
    const res = await get(ID, '?date=2026-10-15')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Supplement not found' })
  })

  it('answers 401 with no session and 429 over the rate limit', async () => {
    auth.mockResolvedValue(null)
    expect((await get(ID, '?date=2026-10-15')).status).toBe(401)
    auth.mockResolvedValue({ user: { id: 'u1', timezone: 'Pacific/Auckland' } })
    rateLimit.mockReturnValue(false)
    expect((await get(ID, '?date=2026-10-15')).status).toBe(429)
    expect(getSupplementDayLog).not.toHaveBeenCalled()
  })
})
