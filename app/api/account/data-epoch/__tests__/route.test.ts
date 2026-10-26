import { describe, it, expect, vi, beforeEach } from 'vitest'

// #3369 — what a device compares with its own record to learn it is behind an admin reset.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
const repo = vi.hoisted(() => ({ getUserById: vi.fn() }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
const limiter = vi.hoisted(() => ({ allow: true }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => limiter.allow) }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

describe('GET /api/account/data-epoch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limiter.allow = true
    session.current = { user: { id: 'u1' } }
  })

  it('401 without a session', async () => {
    session.current = null
    const { GET } = await import('../route')
    expect((await GET()).status).toBe(401)
    expect(repo.getUserById).not.toHaveBeenCalled()
  })

  it('answers 0 for an account that was never reset', async () => {
    repo.getUserById.mockResolvedValue({ id: 'u1', sessionsValidFrom: null })
    const { GET } = await import('../route')
    const res = await GET()
    expect(await res.json()).toEqual({ epoch: 0 })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('answers the reset moment in whole seconds', async () => {
    repo.getUserById.mockResolvedValue({ id: 'u1', sessionsValidFrom: new Date('2026-10-26T01:00:00.999Z') })
    const { GET } = await import('../route')
    expect(await (await GET()).json()).toEqual({ epoch: Math.floor(Date.parse('2026-10-26T01:00:00Z') / 1000) })
  })

  it('401 when the account is gone, and 429 over the limit', async () => {
    repo.getUserById.mockResolvedValue(null)
    const { GET } = await import('../route')
    expect((await GET()).status).toBe(401)
    limiter.allow = false
    expect((await GET()).status).toBe(429)
  })

  it('500 with no detail when the read fails', async () => {
    repo.getUserById.mockRejectedValue(new Error('db down: secret detail'))
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
