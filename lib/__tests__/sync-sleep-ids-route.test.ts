// Issue 2752 — GET /api/sync/sleep-ids, the server half of the device's ghost-night sweep.
// Pinned: it answers only the signed-in user, from that user's id (never a param); it rate-limits
// per user before reading; it is never cached; and a read failure is a 500, never an empty list
// (the device reads an empty list as "skip", but a 200 [] from a broken read must not exist at all).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn()
const listSleepSessionIds = vi.fn()
const rateLimit = vi.fn()
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ listSleepSessionIds }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '@/app/api/sync/sleep-ids/route'

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'u-2752' } })
  rateLimit.mockReturnValue(true)
  listSleepSessionIds.mockResolvedValue({ asOf: new Date('2026-10-11T00:00:00.000Z'), ids: ['a', 'b'] })
})

describe('GET /api/sync/sleep-ids (#2752)', () => {
  it("returns the signed-in user's ids and the read time, uncached", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ asOf: '2026-10-11T00:00:00.000Z', ids: ['a', 'b'] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(listSleepSessionIds).toHaveBeenCalledWith('u-2752')
    expect(rateLimit).toHaveBeenCalledWith('sync-sleep-ids:u-2752', 10, 60_000)
  })

  it('is 401 without a session, and reads nothing', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(listSleepSessionIds).not.toHaveBeenCalled()
  })

  it('is 429 when rate-limited, and reads nothing', async () => {
    rateLimit.mockReturnValue(false)
    const res = await GET()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests' })
    expect(listSleepSessionIds).not.toHaveBeenCalled()
  })

  it('is a 500, not an empty list, when the read fails', async () => {
    listSleepSessionIds.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sleep id read failed' })
  })
})
