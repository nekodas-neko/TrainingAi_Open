// #3369 — a native access token carries when it was issued, so an account with a reset cut-off can
// tell a token minted after the reset from one a phone has held since before it.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    createNativeRefreshToken: async () => ({ id: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 86_400_000) }),
  }),
}))

describe('issueNativeSession', () => {
  it('stamps signedInAt with the time it was issued', async () => {
    process.env.AUTH_SECRET = 'native-stamp-secret-value-long-enough-to-derive'
    const { issueNativeSession } = await import('../mobile/session')
    const { sessionTokenFrom } = await import('../session-token')
    const before = Math.floor(Date.now() / 1000)
    const session = await issueNativeSession({
      id: '22222222-2222-4222-8222-222222222222', email: 'a@example.com', isActive: true, isAdmin: false,
      createdAt: new Date(), timezone: 'Australia/Brisbane',
    })
    const token = await sessionTokenFrom(new Headers({ authorization: `Bearer ${session.accessToken}` }))
    expect(token?.signedInAt).toBeGreaterThanOrEqual(before)
    expect(token?.signedInAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })
})
