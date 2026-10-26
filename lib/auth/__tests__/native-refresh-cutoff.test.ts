// #3369 (f) — the refresh path honours the account's cut-off, and stamps the epoch into the token it mints.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UID = '22222222-2222-4222-8222-222222222222'
const TOKEN_ID = '11111111-1111-4111-8111-111111111111'
const repo = vi.hoisted(() => ({
  stored: null as null | Record<string, unknown>,
  user: null as null | Record<string, unknown>,
  rotate: vi.fn(),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    findNativeRefreshTokenByHash: async () => repo.stored,
    getUserById: async () => repo.user,
    rotateNativeRefreshToken: repo.rotate,
  }),
}))

const RAW = 'A'.repeat(43)
const cutoff = new Date('2026-10-26T02:00:00Z')
beforeEach(() => {
  process.env.AUTH_SECRET = 'native-refresh-secret-value-long-enough-to-derive'
  repo.stored = { id: TOKEN_ID, userId: UID, familyId: 'f', revokedAt: null, rotatedAt: null, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date('2026-10-26T03:00:00Z') }
  repo.user = { id: UID, email: 'a@example.com', isActive: true, isAdmin: false, createdAt: new Date(), timezone: 'Australia/Brisbane', sessionsValidFrom: cutoff }
  repo.rotate.mockReset()
  repo.rotate.mockResolvedValue({ id: TOKEN_ID, expiresAt: new Date(Date.now() + 86_400_000) })
})

describe('rotateNativeSession and the reset cut-off', () => {
  it('refuses a refresh token created before the cut-off, and rotates nothing', async () => {
    repo.stored = { ...repo.stored!, createdAt: new Date('2026-10-26T01:59:59Z') }
    const { rotateNativeSession } = await import('../mobile/session')
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
    expect(repo.rotate).not.toHaveBeenCalled()
  })

  it('accepts one created after it, and the token it mints carries the account epoch', async () => {
    const { rotateNativeSession } = await import('../mobile/session')
    const { sessionTokenFrom } = await import('../session-token')
    const out = await rotateNativeSession(RAW)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const token = await sessionTokenFrom(new Headers({ authorization: `Bearer ${out.body.accessToken}` }))
    expect(token?.dataEpoch).toBe(Math.floor(cutoff.getTime() / 1000))
  })

  it('an account that was never reset has epoch 0 and is unaffected', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null }
    repo.stored = { ...repo.stored!, createdAt: new Date('2020-01-01T00:00:00Z') }
    const { rotateNativeSession } = await import('../mobile/session')
    const { sessionTokenFrom } = await import('../session-token')
    const out = await rotateNativeSession(RAW)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect((await sessionTokenFrom(new Headers({ authorization: `Bearer ${out.body.accessToken}` })))?.dataEpoch).toBe(0)
  })
})
