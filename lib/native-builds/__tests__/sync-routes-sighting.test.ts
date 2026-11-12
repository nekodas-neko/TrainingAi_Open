// #3739. The sync routes call the sighting writer, and a failing or hanging write never changes or
// delays their response. The database is mocked: the write path itself is proven DB-backed in
// record-sighting.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.fn()
const reportServerError = vi.fn()
const delta = { bodyMetrics: [], syncedAt: '1970-01-01T00:00:00.000Z', hasMore: false }

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'user-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getSyncDelta: async () => delta, pushMutations: async () => ({ results: [], errors: [] }) }),
}))
vi.mock('@/lib/data/postgres/user-write-barrier', () => ({
  CUT_OFF: Symbol('cut-off'),
  withUserWriteBarrier: (_u: string, _s: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data/postgres/client', () => ({ getPool: () => ({ query }) }))

import { GET } from '@/app/api/sync/pull/route'
import { POST } from '@/app/api/sync/push/route'
import { resetSightingThrottleForTests } from '../record-sighting'

const pull = (headers: Record<string, string> = {}) =>
  GET(new NextRequest('http://localhost/api/sync/pull', { headers }))
const push = (headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/sync/push', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ mutations: [] }),
  }))
const NATIVE = { 'X-App-Build': '2000201', 'X-App-Version': '0.2.0' }

describe('sync routes record native build sightings (#3739)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSightingThrottleForTests()
  })

  it('pull writes a sighting with the headers and none without, with the same response', async () => {
    query.mockResolvedValue({ rowCount: 1 })
    const without = await pull()
    expect(query).not.toHaveBeenCalled()
    const withHeaders = await pull(NATIVE)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual(['user-1', 2000201, '0.2.0', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)])
    expect(withHeaders.status).toBe(without.status)
    expect(await withHeaders.json()).toEqual(await without.json())
  })

  it('a rejected write leaves the pull response unchanged and is reported', async () => {
    query.mockRejectedValue(new Error('connection refused'))
    const baseline = await (await pull()).json()
    const res = await pull(NATIVE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(baseline)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(1))
  })

  it('a write that never settles does not hold the pull or push response', async () => {
    query.mockReturnValue(new Promise(() => {}))
    expect((await pull(NATIVE)).status).toBe(200)
    resetSightingThrottleForTests()
    const res = await push(NATIVE)
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('a throwing pool leaves the push response unchanged', async () => {
    query.mockImplementation(() => { throw new Error('DATABASE_URL is not set') })
    const baseline = await (await push()).json()
    const res = await push(NATIVE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(baseline)
  })
})
