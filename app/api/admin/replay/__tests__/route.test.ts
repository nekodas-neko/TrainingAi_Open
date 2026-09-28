// TN-56 — the replay route: admin-only, a registered function and one of ITS parameters only,
// bounded inputs, one load per call however many bracket values, and a baseline at the defaults.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authOutcome = { current: { ok: true, via: 'session', userId: 'admin-1' } as Record<string, unknown> }
vi.mock('@/lib/admin/claude-token-auth', () => ({ authorizeAdminRequest: vi.fn(async () => authOutcome.current) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getUserById: async () => ({ timezone: 'Australia/Brisbane' }) })) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const load = vi.fn(async () => ({ xs: [1, 2, 3, 4] }))
vi.mock('@/lib/tuning/replay/registry', async orig => {
  const real = await orig<typeof import('@/lib/tuning/replay/registry')>()
  return {
    ...real,
    REPLAY_FUNCTIONS: {
      'count-above': {
        name: 'count-above', description: 'test', unit: 'n',
        params: [{ name: 'T', description: 'threshold', default: 2, min: 0, max: 10 }],
        load,
        evaluate: ({ xs }: { xs: number[] }, p: Record<string, number>) =>
          xs.map((x, i) => ({ date: `2026-09-0${i + 1}`, value: x > p.T ? x : null, stored: x > 2 ? x : null })),
      },
    },
  }
})

const post = async (body: unknown) => {
  const { POST } = await import('../route')
  return POST(new NextRequest('http://localhost/api/admin/replay', { method: 'POST', body: JSON.stringify(body) }))
}
const ok = { fn: 'count-above', from: '2026-09-01', to: '2026-09-04', param: 'T', values: [0, 3] }

beforeEach(() => {
  authOutcome.current = { ok: true, via: 'session', userId: 'admin-1' }
  load.mockClear()
})

describe('POST /api/admin/replay (TN-56)', () => {
  it('runs every bracket value off ONE load, with a baseline at the default', async () => {
    const res = await post(ok)
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(load).toHaveBeenCalledTimes(1)
    expect(body.baseline.value).toBe(2)
    expect(body.baseline.summary.matchesStored).toBe(2)
    expect(body.results.map((r: { value: number; summary: { nulls: number } }) => [r.value, r.summary.nulls])).toEqual([[0, 0], [3, 3]])
  })

  it('refuses a caller the shared admin check refuses', async () => {
    authOutcome.current = { ok: false, status: 403, error: 'Forbidden' }
    expect((await post(ok)).status).toBe(403)
    expect(load).not.toHaveBeenCalled()
  })

  it('reaches only registered functions and their own parameters, within their bounds', async () => {
    expect((await post({ ...ok, fn: 'rm -rf' })).status).toBe(400)
    expect((await post({ ...ok, param: 'OTHER' })).status).toBe(400)
    expect((await post({ ...ok, values: [11] })).status).toBe(400)
    expect(load).not.toHaveBeenCalled()
  })

  it('bounds the date range', async () => {
    expect((await post({ ...ok, from: '2026-09-04', to: '2026-09-01' })).status).toBe(400)
    expect((await post({ ...ok, from: '2026-01-01', to: '2026-09-01' })).status).toBe(400)
    expect((await post({ ...ok, from: '2026/09/01', to: '2026/09/04' })).status).toBe(200)
  })
})
