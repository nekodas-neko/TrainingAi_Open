// #3830: an Apple sign-in onto an invited address activates the account only when Apple reports the
// email verified and it is not a private-relay address. The route decides; the repository applies.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT, generateKeyPair } from 'jose'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), verify: vi.fn(), issue: vi.fn(), family: vi.fn(),
  repository: {
    getAppleAuthAttempt: vi.fn(), consumeAppleAuthAttempt: vi.fn(), getUserByProvider: vi.fn(),
    createProviderUser: vi.fn(), isInvited: vi.fn(),
  },
}))
vi.mock('@/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/data', () => ({ getRepository: async () => mocks.repository, getRepositoryAsync: async () => mocks.repository }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/auth/apple', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth/apple')>(), verifyAppleIdentityToken: mocks.verify }))
vi.mock('@/lib/auth/mobile/session', () => ({ issueNativeSession: mocks.issue, presentedNativeFamily: mocks.family }))
import { POST as complete } from '@/app/api/auth/apple/complete/route'
import { appleEmailIsAuthoritative, appleNonceHash } from '@/lib/auth/apple'

const attemptId = '1aaad26d-22ef-4b26-98ba-d55d2d166f70'
const attempt = { id: attemptId, nonceHash: appleNonceHash('nonce'), userId: null }
const finish = () => complete(new NextRequest('https://example.com/api/auth/apple/complete', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attemptId, identityToken: 'proof' }),
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.repository.getAppleAuthAttempt.mockResolvedValue(attempt)
  mocks.repository.consumeAppleAuthAttempt.mockResolvedValue(attempt)
  mocks.repository.getUserByProvider.mockResolvedValue(null)
  mocks.repository.isInvited.mockResolvedValue(true)
  mocks.repository.createProviderUser.mockImplementation(async (_p, _s, _e, _n, opts) => ({ id: 'u', isActive: opts?.activate === true }))
  mocks.issue.mockResolvedValue({ ok: true })
})

describe('#3830 Apple sign-in applies an invite only to a verified, real address', () => {
  it('a verified real address that is invited activates', async () => {
    mocks.verify.mockResolvedValue({ subject: 's', email: 'sam@example.com', emailVerified: true, privateRelay: false })
    expect((await finish()).status).toBe(200)
    expect(mocks.repository.createProviderUser).toHaveBeenCalledWith('apple', 's', 'sam@example.com', undefined, { activate: true })
  })
  it('a verified real address that is not invited stays pending', async () => {
    mocks.repository.isInvited.mockResolvedValue(false)
    mocks.verify.mockResolvedValue({ subject: 's', email: 'sam@example.com', emailVerified: true, privateRelay: false })
    expect((await finish()).status).toBe(403)
    expect(mocks.repository.createProviderUser).toHaveBeenCalledWith('apple', 's', 'sam@example.com', undefined, { activate: false })
  })
  // #3854: an unverified address never reaches the route with an email: the verifier drops it (see
  // `verifyAppleIdentityToken` below). What the route sees is no email, and it creates nothing.
  it('an address the verifier dropped creates no account and never consults the invite list', async () => {
    mocks.verify.mockResolvedValue({ subject: 's', email: undefined, emailVerified: false, privateRelay: false })
    const res = await finish()
    expect(res.status).toBe(400)
    expect(mocks.repository.isInvited).not.toHaveBeenCalled()
    expect(mocks.repository.createProviderUser).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })
  it('a private-relay address stays pending, by claim or by domain', async () => {
    mocks.verify.mockResolvedValue({ subject: 's', email: 'x@privaterelay.appleid.com', emailVerified: true, privateRelay: false })
    expect((await finish()).status).toBe(403)
    mocks.verify.mockResolvedValue({ subject: 's', email: 'sam@example.com', emailVerified: true, privateRelay: true })
    expect((await finish()).status).toBe(403)
    expect(mocks.repository.isInvited).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })
})

describe('appleEmailIsAuthoritative', () => {
  it('fails closed on anything missing', () => {
    expect(appleEmailIsAuthoritative({ email: 'a@example.com', emailVerified: true, privateRelay: false })).toBe(true)
    expect(appleEmailIsAuthoritative({ email: 'a@example.com', emailVerified: true })).toBe(false)
    expect(appleEmailIsAuthoritative({ email: 'a@example.com', privateRelay: false })).toBe(false)
    expect(appleEmailIsAuthoritative({ emailVerified: true, privateRelay: false })).toBe(false)
    expect(appleEmailIsAuthoritative({ email: 'A@PrivateRelay.AppleID.com', emailVerified: true, privateRelay: false })).toBe(false)
  })
  it('reads email_verified and is_private_email from the signed token', async () => {
    const { verifyAppleIdentityToken: real } = await vi.importActual<typeof import('@/lib/auth/apple')>('@/lib/auth/apple')
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const sign = (claims: Record<string, unknown>) => new SignJWT({ nonce: 'nonce', ...claims })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('s').setIssuer('https://appleid.apple.com')
      .setAudience(process.env.APPLE_NATIVE_CLIENT_ID || 'com.fitnessai.training').setIssuedAt().setExpirationTime('5m').sign(privateKey)
    const real1 = await real(await sign({ email: 'a@example.com', email_verified: 'true', is_private_email: 'false' }), appleNonceHash('nonce'), async () => publicKey)
    expect(real1).toEqual({ subject: 's', email: 'a@example.com', emailVerified: true, privateRelay: false })
    const relay = await real(await sign({ email: 'r@privaterelay.appleid.com', email_verified: true, is_private_email: true }), appleNonceHash('nonce'), async () => publicKey)
    expect(appleEmailIsAuthoritative(relay)).toBe(false)
  })

  // #3854 item 5: Apple sends these claims as booleans or as the strings "true"/"false".
  it('reads is_private_email: "true" as a string as a relay address', async () => {
    const { verifyAppleIdentityToken: real } = await vi.importActual<typeof import('@/lib/auth/apple')>('@/lib/auth/apple')
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const sign = (claims: Record<string, unknown>) => new SignJWT({ nonce: 'nonce', ...claims })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('s').setIssuer('https://appleid.apple.com')
      .setAudience(process.env.APPLE_NATIVE_CLIENT_ID || 'com.fitnessai.training').setIssuedAt().setExpirationTime('5m').sign(privateKey)
    // A real-looking domain, so only the claim can mark it as a relay.
    const relay = await real(await sign({ email: 'a@example.com', email_verified: 'true', is_private_email: 'true' }), appleNonceHash('nonce'), async () => publicKey)
    expect(relay).toEqual({ subject: 's', email: 'a@example.com', emailVerified: true, privateRelay: true })
    expect(appleEmailIsAuthoritative(relay)).toBe(false)
  })

  // #3854 item 5: where an unverified email is actually handled. It never leaves the verifier.
  it('drops the email of a token that does not say it is verified', async () => {
    const { verifyAppleIdentityToken: real } = await vi.importActual<typeof import('@/lib/auth/apple')>('@/lib/auth/apple')
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const sign = (claims: Record<string, unknown>) => new SignJWT({ nonce: 'nonce', ...claims })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('s').setIssuer('https://appleid.apple.com')
      .setAudience(process.env.APPLE_NATIVE_CLIENT_ID || 'com.fitnessai.training').setIssuedAt().setExpirationTime('5m').sign(privateKey)
    for (const claims of [{ email_verified: false }, { email_verified: 'false' }, {}, { email_verified: 'yes' }, { email_verified: 1 }]) {
      const identity = await real(await sign({ email: 'a@example.com', is_private_email: false, ...claims }), appleNonceHash('nonce'), async () => publicKey)
      expect(identity).toEqual({ subject: 's', email: undefined, emailVerified: false, privateRelay: false })
      expect(appleEmailIsAuthoritative(identity)).toBe(false)
    }
  })
})
