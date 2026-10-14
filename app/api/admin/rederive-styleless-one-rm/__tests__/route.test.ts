// Issue 2357: the admin door to the styleless 1RM re-derive. The work itself is tested in
// app/api/agent-actions/__tests__/route.test.ts (against Postgres) and in
// packages/shared/src/__tests__/1rm-ms44-arithmetic.test.ts (the planner); this pins the door:
// who may call it, that it is a dry run unless told otherwise, and that it acts on the caller only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER = 'user-2357'
const TZ = 'Europe/London' // not DEFAULT_TZ, so the test can tell which zone reached the work

const authMock = vi.fn()
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const requireAdmin = vi.fn()
vi.mock('@/lib/admin', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin')>()),
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}))

const rateLimit = vi.fn(() => true)
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }))

const repo = { marker: 'repo' }
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))

const rederive = vi.fn()
vi.mock('@/lib/workout/rederive-styleless-one-rm', () => ({ rederiveStylelessOneRm: (a: unknown) => rederive(a) }))

const call = async (qs = '') => {
  const { POST } = await import('../route')
  return POST(new NextRequest(`http://localhost/api/admin/rederive-styleless-one-rm${qs}`, { method: 'POST' }))
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: USER, timezone: TZ, isAdmin: true } })
  requireAdmin.mockReset().mockResolvedValue(undefined)
  rateLimit.mockReset().mockReturnValue(true)
  rederive.mockReset().mockResolvedValue({ ok: true, report: { dryRun: true, summary: { wouldWrite: 3 } } })
})

describe('POST /api/admin/rederive-styleless-one-rm (issue 2357)', () => {
  it('401 with no session, and nothing runs', async () => {
    authMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(rederive).not.toHaveBeenCalled()
  })

  it('refuses a non-admin through requireAdmin, and nothing runs', async () => {
    const { AdminError } = await import('@/lib/admin')
    requireAdmin.mockRejectedValue(new AdminError())
    expect((await call()).status).toBe(403)
    expect(rederive).not.toHaveBeenCalled()
  })

  it('429 when rate-limited, keyed to the caller and this job', async () => {
    rateLimit.mockReturnValue(false)
    expect((await call()).status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith(`${USER}:rederive-styleless-one-rm`, 4, 60_000)
    expect(rederive).not.toHaveBeenCalled()
  })

  it('is a dry run by default, for the caller, in the caller\'s timezone', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ dryRun: true, summary: { wouldWrite: 3 } })
    expect(rederive).toHaveBeenCalledWith({ repo, userId: USER, tz: TZ, dryRun: true })
  })

  it('writes only on dryRun=false', async () => {
    await call('?dryRun=false')
    expect(rederive).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }))
    await call('?dryRun=true')
    expect(rederive).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it('rejects any other dryRun value before running', async () => {
    const res = await call('?dryRun=no')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/dryRun/)
    expect(rederive).not.toHaveBeenCalled()
  })

  it('a rolled-back write is a 409 that says so', async () => {
    rederive.mockResolvedValue({ ok: false, error: 'wrote 1 of 2 planned logs; rolled back' })
    const res = await call('?dryRun=false')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/rolled back/)
  })
})
