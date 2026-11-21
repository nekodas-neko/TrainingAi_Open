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
  repo.rotate.mockResolvedValue({ id: TOKEN_ID, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) })
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

// #3829 / #3949 review N1: the sign-in cut-off under its strict rule. Both times are the database
// clock (the row's `created_at`, the cut-off `endSignInsBefore` writes), so a row issued before the
// cut-off is refused even within the same second; there is no same-second survivor.
describe('rotateNativeSession and the sign-in cut-off (#3829)', () => {
  const signInCut = new Date('2026-11-16T23:00:01.000Z')
  it('refuses a token created a few milliseconds before the cut-off, in the same second', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null, signInsValidFrom: signInCut }
    repo.stored = { ...repo.stored!, createdAt: new Date('2026-11-16T23:00:00.995Z') }
    const { rotateNativeSession } = await import('../mobile/session')
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
    expect(repo.rotate).not.toHaveBeenCalled()
  })

  it('refuses one inside the second of a cut-off with a fraction (written by the app clock before this)', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null, signInsValidFrom: new Date('2026-11-16T23:00:00.500Z') }
    repo.stored = { ...repo.stored!, createdAt: new Date('2026-11-16T23:00:00.495Z') }
    const { rotateNativeSession } = await import('../mobile/session')
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts one created at the cut-off', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null, signInsValidFrom: signInCut }
    repo.stored = { ...repo.stored!, createdAt: signInCut }
    const { rotateNativeSession } = await import('../mobile/session')
    expect((await rotateNativeSession(RAW)).ok).toBe(true)
  })

  it('refuses one from an earlier second, and fails closed on an invalid cut-off', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null, signInsValidFrom: signInCut }
    repo.stored = { ...repo.stored!, createdAt: new Date('2026-11-16T22:59:59.900Z') }
    const { rotateNativeSession } = await import('../mobile/session')
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
    repo.user = { ...repo.user!, signInsValidFrom: new Date('not a date') }
    repo.stored = { ...repo.stored!, createdAt: new Date('2026-11-17T00:00:00Z') }
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
    expect(repo.rotate).not.toHaveBeenCalled()
  })

  // #3949 review S3: a sign-out that commits after the read above is caught by the rotation's own
  // check, under its family lock; that is an ended sign-in, not a reused token.
  it('a cut-off the rotation finds under its lock is invalid, not reuse', async () => {
    repo.user = { ...repo.user!, sessionsValidFrom: null }
    const { NativeSignInCutOffError } = await import('@/lib/data/postgres/slices/native-refresh-tokens')
    repo.rotate.mockRejectedValue(new NativeSignInCutOffError())
    const { rotateNativeSession } = await import('../mobile/session')
    expect(await rotateNativeSession(RAW)).toEqual({ ok: false, reason: 'invalid' })
    // Any other failure still propagates (the route answers 503), never read as a cut-off.
    repo.rotate.mockRejectedValue(new Error('db down'))
    await expect(rotateNativeSession(RAW)).rejects.toThrow('db down')
  })
})
