import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMobileAuthToken, consumeMobileAuthToken } from '../auth/mobile/tokens'

afterEach(() => vi.useRealTimers())

describe('mobile auth tokens', () => {
  it('round-trips cookie value and challenge, one time only', () => {
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    expect(consumeMobileAuthToken(token)).toEqual({ sessionCookieValue: 'cookie-value', challenge: 'challenge-abc' })
    expect(consumeMobileAuthToken(token)).toBeNull() // consumed
  })
  it('returns null for unknown tokens', () => {
    expect(consumeMobileAuthToken('nope')).toBeNull()
  })
  it('expires after 5 minutes', () => {
    vi.useFakeTimers()
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(consumeMobileAuthToken(token)).toBeNull()
  })
})

import { generateKeyPair, SignJWT } from 'jose'
import { appleNonceHash, verifyAppleIdentityToken } from '../auth/apple'
import { issueNativeSession } from '../auth/mobile/session'
import { sessionTokenFrom } from '../auth/session-token'

describe('Apple identity proof', () => {
  it('verifies signature, issuer, audience, freshness and nonce', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const nonce = 'native-attempt-nonce'
    const sign = (claims = {}, audience = 'com.fitnessai.training', issuer = 'https://appleid.apple.com') =>
      new SignJWT({ sub: 'apple-subject', nonce, email: 'hidden@privaterelay.appleid.com', email_verified: 'true', ...claims })
        .setProtectedHeader({ alg: 'RS256' }).setIssuedAt().setExpirationTime(typeof claims === 'object' && 'exp' in claims ? Number(claims.exp) : '5m').setIssuer(issuer).setAudience(audience).sign(privateKey)
    const hash = appleNonceHash(nonce)
    expect(await verifyAppleIdentityToken(await sign(), hash, async () => publicKey)).toEqual({ subject: 'apple-subject', email: 'hidden@privaterelay.appleid.com' })
    await expect(verifyAppleIdentityToken(await sign(), appleNonceHash('different'), async () => publicKey)).rejects.toThrow()
    await expect(verifyAppleIdentityToken(await sign({}, 'another-app'), hash, async () => publicKey)).rejects.toThrow()
    await expect(verifyAppleIdentityToken(await sign({}, undefined, 'https://attacker.example'), hash, async () => publicKey)).rejects.toThrow()
    await expect(verifyAppleIdentityToken(await sign({ exp: 1 }), hash, async () => publicKey)).rejects.toThrow()
    const other = await generateKeyPair('RS256')
    await expect(verifyAppleIdentityToken(await sign(), hash, async () => other.publicKey)).rejects.toThrow()
    expect((await verifyAppleIdentityToken(await sign({ email_verified: false }), hash, async () => publicKey)).email).toBeUndefined()
    expect((await verifyAppleIdentityToken(await sign({ email: undefined }), hash, async () => publicKey)).subject).toBe('apple-subject')
  })
  it('issues a bearer session compatible with existing backend auth', async () => {
    vi.stubEnv('AUTH_SECRET', 'synthetic-apple-session-secret-for-local-tests')
    try {
      const user = { id: 'apple-user', email: 'hidden@privaterelay.appleid.com', isActive: true, isAdmin: false, timezone: 'Australia/Brisbane', createdAt: new Date() }
      const response = await issueNativeSession(user)
      const token = await sessionTokenFrom(new Headers({ authorization: `Bearer ${response.accessToken}` }))
      expect(token?.userId).toBe(user.id)
      expect(token?.exp).toBe(response.expiresAt)
      expect(token).not.toHaveProperty('refreshToken')
      await expect(issueNativeSession({ ...user, isActive: false })).rejects.toThrow()
    } finally { vi.unstubAllEnvs() }
  })
})
