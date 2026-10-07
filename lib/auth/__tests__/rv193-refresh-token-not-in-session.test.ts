import { describe, it, expect } from 'vitest'
import { encode } from 'next-auth/jwt'
import { authConfig } from '@/auth.config'
import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

const SECRET = 'rv193-test-secret-value-long-enough-to-derive'
const SALT = 'authjs.session-token'
process.env.AUTH_SECRET = SECRET

const buildSession = async (token: Partial<JWT>) =>
  (await authConfig.callbacks!.session!({
    session: { user: {}, expires: '' } as unknown as Session,
    token,
  } as never)) as Session & { refreshToken?: string }

const cookie = (value: string) => new Headers({ cookie: `${SALT}=${encodeURIComponent(value)}` })

describe('RV-193 — the refresh token stays out of the browser-readable session', () => {
  it('is absent from the session even when the JWT carries it', async () => {
    const session = await buildSession({ userId: 'u1', refreshToken: 'google-refresh-secret' })
    expect(session.refreshToken).toBeUndefined()
    expect(JSON.stringify(session)).not.toContain('google-refresh-secret')
  })

  it('still builds the rest of the session — the claim was removed, not the callback', async () => {
    const session = await buildSession({
      userId: 'u1', refreshToken: 'google-refresh-secret', timezone: 'Australia/Brisbane',
      isActive: true, isAdmin: true,
    })
    expect(session.user.id).toBe('u1')
    expect(session.user.timezone).toBe('Australia/Brisbane')
    expect(session.isActive).toBe(true)
    expect(session.user.isAdmin).toBe(true)
  })

  it('the SERVER can still read it, from a really-encrypted cookie', async () => {
    const { googleRefreshTokenFrom } = await import('@/lib/auth/session-token')
    const jwt = await encode({
      token: { userId: 'u1', refreshToken: 'google-refresh-secret' },
      secret: SECRET, salt: SALT, maxAge: 60 * 60,
    })
    expect(await googleRefreshTokenFrom(cookie(jwt))).toBe('google-refresh-secret')
  })

  it('answers null for a signed-in caller who never granted calendar access', async () => {
    const { googleRefreshTokenFrom } = await import('@/lib/auth/session-token')
    const jwt = await encode({ token: { userId: 'u1' }, secret: SECRET, salt: SALT, maxAge: 60 * 60 })
    expect(await googleRefreshTokenFrom(cookie(jwt))).toBeNull()
  })

  it('treats an empty-string claim as no token', async () => {
    const { googleRefreshTokenFrom } = await import('@/lib/auth/session-token')
    const jwt = await encode({
      token: { userId: 'u1', refreshToken: '' }, secret: SECRET, salt: SALT, maxAge: 60 * 60,
    })
    expect(await googleRefreshTokenFrom(cookie(jwt))).toBeNull()
  })

  it.each([
    ['no cookie at all', () => new Headers()],
    ['a cookie that is not a JWT', () => cookie('not-a-jwt-at-all')],
  ])('answers null for %s, without throwing', async (_label, make) => {
    const { googleRefreshTokenFrom } = await import('@/lib/auth/session-token')
    expect(await googleRefreshTokenFrom(make())).toBeNull()
  })
})
