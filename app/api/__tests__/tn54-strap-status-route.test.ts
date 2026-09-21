import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TN-54 — the route half. The service posts a status; nothing about the strap should be able to
 * make that a 500 or a silent drop, because a status that does not arrive is the exact state the
 * table exists to distinguish from a healthy one.
 */
const insertStrapStatus = vi.fn(
  async (_userId: string, _status: import('@/lib/data/repository').StrapStatusWrite) => undefined)
const getLatestStrapStatus = vi.fn(async () => null as unknown)
const listStrapStatus = vi.fn(async () => [] as unknown[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1' } }) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ insertStrapStatus, getLatestStrapStatus, listStrapStatus }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST, GET } from '@/app/api/strap-status/route'

const post = (body: unknown) => POST(new Request('http://localhost/api/strap-status', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => { insertStrapStatus.mockClear(); getLatestStrapStatus.mockClear(); listStrapStatus.mockClear() })

describe('TN-54 POST /api/strap-status', () => {
  it('stores the give-up the service used to only log', async () => {
    const res = await post({
      state: 'stopped', batteryPercent: 12, lastSampleAt: Date.parse('2026-09-15T23:11:00Z'),
      consecutiveFailures: 6, worn: false,
    })
    expect(res.status).toBe(200)
    expect(insertStrapStatus).toHaveBeenCalledTimes(1)
    const written = insertStrapStatus.mock.calls[0][1]
    expect(written.lastSampleAt?.toISOString()).toBe('2026-09-15T23:11:00.000Z')
  })

  it('accepts the minimal status — a failing strap may know nothing but its state', async () => {
    // The first status after a failed connect has no battery, no sample and no contact reading.
    // Requiring any of them would reject precisely the report worth having.
    const res = await post({ state: 'disconnected' })
    expect(res.status).toBe(200)
    const written = insertStrapStatus.mock.calls[0][1]
    expect(written).toMatchObject({ batteryPercent: null, lastSampleAt: null, consecutiveFailures: 0, worn: null })
  })

  it('accepts a state string the server has never heard of', async () => {
    expect((await post({ state: 'firmware-handshake-timeout' })).status).toBe(200)
  })

  it('refuses a key no column has — the Q-464 shape', async () => {
    const res = await post({ state: 'ready', batteryPct: 50 })
    expect(res.status).toBe(400)
    expect(insertStrapStatus).not.toHaveBeenCalled()
  })

  it('refuses an out-of-range battery and an unbounded timestamp', async () => {
    expect((await post({ state: 'ready', batteryPercent: 140 })).status).toBe(400)
    expect((await post({ state: 'ready', lastSampleAt: 9e15 })).status).toBe(400)
    expect(insertStrapStatus).not.toHaveBeenCalled()
  })

  it('refuses an empty state — a row that says nothing is worse than no row', async () => {
    expect((await post({ state: '' })).status).toBe(400)
  })
})

describe('TN-54 GET /api/strap-status', () => {
  it('answers "has this device ever reported" with null rather than an empty object', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.latest).toBeNull()
    expect(body.recent).toEqual([])
  })

  it('does not let a response of this shape be cached anywhere', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
