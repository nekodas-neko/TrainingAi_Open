// F3-server: the pull route plumbs `?mode=restore` → getSyncDelta(windowDays=null)
// (full-history restore) and gates normal vs restore pulls on separate rate-limit
// buckets. The repo-level window semantics (null skips the 90-day floor) are proven
// DB-backed in lib/data/postgres/__tests__/sync-delta-window.test.ts; this proves the
// route wiring around it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TEST_USER_ID = 'user-1'

const getSyncDelta = vi.fn(async () => ({ bodyMetrics: [], syncedAt: '1970-01-01T00:00:00.000Z', hasMore: false }))
const rateLimit = vi.fn(() => true)
const authMock = vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } }))

vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getSyncDelta }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...args: unknown[]) => rateLimit(...args) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '../route'

function req(query = '') {
  return new NextRequest(`http://localhost/api/sync/pull${query}`)
}

describe('GET /api/sync/pull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimit.mockReturnValue(true)
    authMock.mockResolvedValue({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })
  })

  it('rejects an unauthenticated request with 401', async () => {
    authMock.mockResolvedValueOnce(null as never)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(getSyncDelta).not.toHaveBeenCalled()
  })

  it('normal pull passes windowDays=undefined (keeps the default 90-day floor)', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(getSyncDelta).toHaveBeenCalledTimes(1)
    // 3rd arg undefined → adapter default (90) applies; default path stays byte-identical.
    expect(getSyncDelta.mock.calls[0][2]).toBeUndefined()
  })

  it('mode=restore passes windowDays=null (full-history unclamp)', async () => {
    const res = await GET(req('?mode=restore'))
    expect(res.status).toBe(200)
    expect(getSyncDelta).toHaveBeenCalledTimes(1)
    expect(getSyncDelta.mock.calls[0][2]).toBeNull()
  })

  it('threads the since param through to getSyncDelta', async () => {
    const since = '2025-01-01T00:00:00.000Z'
    await GET(req(`?since=${since}`))
    expect((getSyncDelta.mock.calls[0][1] as Date).toISOString()).toBe(since)
  })

  it('normal and restore pulls use separate rate-limit buckets', async () => {
    await GET(req())
    await GET(req('?mode=restore'))
    const keys = rateLimit.mock.calls.map(c => c[0])
    expect(keys).toContain(`sync-pull:${TEST_USER_ID}`)
    expect(keys).toContain(`sync-pull-restore:${TEST_USER_ID}`)
  })

  it('returns 429 without touching the repo when the bucket is exhausted', async () => {
    rateLimit.mockReturnValue(false)
    const res = await GET(req('?mode=restore'))
    expect(res.status).toBe(429)
    expect(getSyncDelta).not.toHaveBeenCalled()
  })
})
