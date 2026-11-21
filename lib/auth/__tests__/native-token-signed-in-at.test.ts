// #3369 — a native access token carries when it was issued, so an account with a reset cut-off can
// tell a token minted after the reset from one a phone has held since before it.
// #3949 review N1: the stamp is the refresh row's `created_at` (the database clock that writes the
// cut-offs), never the app server's clock.
import { describe, it, expect, vi } from 'vitest'

const ROW_CREATED_AT = new Date('2026-11-21T04:05:06.789Z')
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    createNativeRefreshToken: async () => ({ id: '11111111-1111-4111-8111-111111111111', createdAt: ROW_CREATED_AT, expiresAt: new Date(Date.now() + 86_400_000) }),
  }),
}))

const user = {
  id: '22222222-2222-4222-8222-222222222222', email: 'a@example.com', isActive: true, isAdmin: false,
  createdAt: new Date(), timezone: 'Australia/Brisbane',
}

describe('issueNativeSession', () => {
  it('stamps signedInAt with the issuing row\'s created_at, in whole seconds', async () => {
    process.env.AUTH_SECRET = 'native-stamp-secret-value-long-enough-to-derive'
    const { issueNativeSession } = await import('../mobile/session')
    const { sessionTokenFrom } = await import('../session-token')
    const session = await issueNativeSession(user)
    const token = await sessionTokenFrom(new Headers({ authorization: `Bearer ${session.accessToken}` }))
    expect(token?.signedInAt).toBe(Math.floor(ROW_CREATED_AT.getTime() / 1000))
    expect(token?.nativeTokenId).toBe('11111111-1111-4111-8111-111111111111')
  })
})
