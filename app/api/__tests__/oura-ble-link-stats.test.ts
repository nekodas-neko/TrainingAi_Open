// #2469. POST /api/oura-ble/link-stats — the ring link's counters, cumulative since the service
// started. Each guard case is built to fail on THAT guard only (every other field valid).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OuraLinkStatsWrite } from '@/lib/data/repository'

const authMock = vi.fn(async (): Promise<{ user: { id: string; isAdmin: boolean } } | null> => ({ user: { id: 'u1', isAdmin: true } }))
vi.mock('@/auth', () => ({ auth: () => authMock() }))
const requireAdmin = vi.fn(async (_userId: string, _isAdmin: boolean) => {})
vi.mock('@/lib/admin', () => ({
  requireAdmin: (userId: string, isAdmin: boolean) => requireAdmin(userId, isAdmin),
  adminErrorResponse: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
}))
const rateLimit = vi.fn((_key: string, _max: number, _windowMs: number) => true)
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (k: string, m: number, w: number) => rateLimit(k, m, w) }))
const insertOuraLinkStats = vi.fn(async (_userId: string, _stats: OuraLinkStatsWrite) => {})
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ insertOuraLinkStats })),
}))

import { POST } from '@/app/api/oura-ble/link-stats/route'

const post = (body: unknown) => POST(new Request('http://x/api/oura-ble/link-stats', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

// Every number distinct, so a field read from the wrong key cannot pass.
const STARTED_AT = Date.UTC(2026, 9, 7, 2, 0, 0)
const valid = {
  serviceStartedAt: STARTED_AT,
  serviceUptimeMs: 7_200_000,
  state: 'ready',
  connectCount: 14,
  dropCount: 13,
  totalConnectedMs: 6_100_000,
  lastTimeToConnectMs: 2_300,
  consecutiveFailures: 1,
}

beforeEach(() => {
  insertOuraLinkStats.mockClear()
  rateLimit.mockClear()
  rateLimit.mockImplementation(() => true)
  requireAdmin.mockReset()
  authMock.mockImplementation(async () => ({ user: { id: 'u1', isAdmin: true } }))
})

describe('POST /api/oura-ble/link-stats (#2469)', () => {
  it('persists every field, with the start instant as a Date, for the session user', async () => {
    const res = await post(valid)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(insertOuraLinkStats).toHaveBeenCalledTimes(1)
    expect(insertOuraLinkStats).toHaveBeenCalledWith('u1', {
      serviceStartedAt: new Date(STARTED_AT),
      serviceUptimeMs: 7_200_000,
      state: 'ready',
      connectCount: 14,
      dropCount: 13,
      totalConnectedMs: 6_100_000,
      lastTimeToConnectMs: 2_300,
      consecutiveFailures: 1,
    })
    expect(rateLimit.mock.calls[0][0]).toBe('oura-ble-link-stats:u1')
  })

  it('stores the optional fields as null when an older status omits them', async () => {
    const { lastTimeToConnectMs: _a, consecutiveFailures: _b, ...rest } = valid
    const res = await post(rest)
    expect(res.status).toBe(200)
    const stored = insertOuraLinkStats.mock.calls[0][1]
    expect(stored.lastTimeToConnectMs).toBeNull()
    expect(stored.consecutiveFailures).toBeNull()
  })

  it('records a state the schema has never seen', async () => {
    const res = await post({ ...valid, state: 'authenticating-v2' })
    expect(res.status).toBe(200)
    expect(insertOuraLinkStats.mock.calls[0][1].state).toBe('authenticating-v2')
  })

  it('401s without a session and writes nothing', async () => {
    authMock.mockImplementation(async () => null)
    const res = await post(valid)
    expect(res.status).toBe(401)
    expect(insertOuraLinkStats).not.toHaveBeenCalled()
  })

  it('refuses a non-admin before reading the body', async () => {
    requireAdmin.mockImplementation(async () => { throw new Error('forbidden') })
    const res = await post(valid)
    expect(res.status).toBe(403)
    expect(insertOuraLinkStats).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('429s when the rate limit is spent', async () => {
    rateLimit.mockImplementation(() => false)
    const res = await post(valid)
    expect(res.status).toBe(429)
    expect(insertOuraLinkStats).not.toHaveBeenCalled()
  })

  it('400s on an unknown field (strict)', async () => {
    const res = await post({ ...valid, battery: 80 })
    expect(res.status).toBe(400)
    expect(insertOuraLinkStats).not.toHaveBeenCalled()
  })

  it('400s on a negative counter', async () => {
    const res = await post({ ...valid, dropCount: -1 })
    expect(res.status).toBe(400)
  })

  it('400s on a fractional counter', async () => {
    const res = await post({ ...valid, connectCount: 1.5 })
    expect(res.status).toBe(400)
  })

  it('400s on a start instant past the Date range', async () => {
    const res = await post({ ...valid, serviceStartedAt: 8_640_000_000_000_001 })
    expect(res.status).toBe(400)
  })

  it('400s on a missing counter', async () => {
    const { totalConnectedMs: _t, ...rest } = valid
    const res = await post(rest)
    expect(res.status).toBe(400)
  })

  it('400s on an empty state', async () => {
    const res = await post({ ...valid, state: '' })
    expect(res.status).toBe(400)
  })
})
