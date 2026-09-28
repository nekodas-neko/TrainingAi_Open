// RV-193: the session object is what `GET /api/auth/session` hands to page JavaScript, so the
// Google refresh token must never be copied onto it. It stays in the encrypted JWT and is read
// server-side by `googleRefreshTokenFor`.
import { describe, it, expect } from 'vitest'
import { authConfig } from '@/auth.config'

describe('session callback', () => {
  it('never exposes the Google refresh token to the client session', async () => {
    const session = { user: {}, expires: '' }
    const token = { userId: 'u-1', refreshToken: 'secret-refresh-token', isActive: true }
    const out = await authConfig.callbacks!.session!({ session, token } as never)
    expect(JSON.stringify(out)).not.toContain('secret-refresh-token')
    expect((out as { user: { id: string } }).user.id).toBe('u-1')
  })
})
