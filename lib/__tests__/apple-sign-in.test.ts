import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), verify: vi.fn(), issue: vi.fn(), rateLimit: vi.fn(() => true),
  repository: {
    createAppleAuthAttempt: vi.fn(), getAppleAuthAttempt: vi.fn(), consumeAppleAuthAttempt: vi.fn(),
    getUserByProvider: vi.fn(), linkIdentity: vi.fn(), getUserById: vi.fn(), createProviderUser: vi.fn(),
  },
}))
vi.mock('@/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/data', () => ({ getRepository: async () => mocks.repository }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/auth/apple', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth/apple')>(), verifyAppleIdentityToken: mocks.verify }))
vi.mock('@/lib/auth/mobile/session', () => ({ issueNativeSession: mocks.issue }))
import { POST as begin } from '@/app/api/auth/apple/begin/route'
import { POST as complete } from '@/app/api/auth/apple/complete/route'
import { IdentityConflict } from '@/lib/auth/identity'
import { appleNonceHash } from '@/lib/auth/apple'

const attemptId = '1aaad26d-22ef-4b26-98ba-d55d2d166f70'
const attempt = { id: attemptId, nonceHash: appleNonceHash('nonce'), userId: null }
const user = { id: 'account-id', isActive: true }
const send = (handler: typeof begin, body: unknown) => handler(new NextRequest('https://example.com/api/auth/apple', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const finish = () => send(complete, { attemptId, identityToken: 'signed-proof' })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.rateLimit.mockReturnValue(true)
  mocks.auth.mockResolvedValue({ user: { id: user.id } })
  mocks.repository.createAppleAuthAttempt.mockResolvedValue(attempt)
  mocks.repository.getAppleAuthAttempt.mockResolvedValue(attempt)
  mocks.repository.consumeAppleAuthAttempt.mockResolvedValue(attempt)
  mocks.repository.getUserByProvider.mockResolvedValue(user)
  mocks.repository.getUserById.mockResolvedValue(user)
  mocks.repository.linkIdentity.mockResolvedValue(true)
  mocks.repository.createProviderUser.mockResolvedValue(user)
  mocks.verify.mockResolvedValue({ subject: 'apple-subject' })
  mocks.issue.mockResolvedValue({ ok: true, accessToken: 'opaque-session' })
})

describe('native Apple endpoints', () => {
  it('creates fresh server nonce and requires authentication for linking', async () => {
    const result = await send(begin, {})
    expect(result.status).toBe(200)
    const body = await result.json()
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mocks.repository.createAppleAuthAttempt).toHaveBeenCalledWith(appleNonceHash(body.nonce), null)
    expect(result.headers.get('cache-control')).toContain('no-store')
    mocks.auth.mockResolvedValue(null)
    expect((await send(begin, { link: true })).status).toBe(401)
    expect(mocks.repository.createAppleAuthAttempt).toHaveBeenCalledTimes(1)
  })
  it('signs in by Apple subject when Apple no longer supplies email or name', async () => {
    expect((await finish()).status).toBe(200)
    expect(mocks.repository.getUserByProvider).toHaveBeenCalledWith('apple', 'apple-subject')
    expect(mocks.repository.createProviderUser).not.toHaveBeenCalled()
    expect(mocks.issue).toHaveBeenCalledWith(user)
  })
  it('rejects invalid proof and replay without issuing a session', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('Invalid signature'))
    expect((await finish()).status).toBe(401)
    expect(mocks.repository.consumeAppleAuthAttempt).not.toHaveBeenCalled()
    mocks.repository.consumeAppleAuthAttempt.mockResolvedValueOnce(null)
    expect((await finish()).status).toBe(401)
    expect(mocks.issue).not.toHaveBeenCalled()
  })
  it('requires verified email for a new identity and keeps pending users pending', async () => {
    mocks.repository.getUserByProvider.mockResolvedValue(null)
    expect((await finish()).status).toBe(400)
    mocks.verify.mockResolvedValue({ subject: 'apple-subject', email: 'hidden@privaterelay.appleid.com' })
    mocks.repository.createProviderUser.mockResolvedValue({ ...user, isActive: false })
    expect((await finish()).status).toBe(403)
    expect(mocks.issue).not.toHaveBeenCalled()
  })
  it('asks for existing-account login instead of silently merging an email collision', async () => {
    mocks.repository.getUserByProvider.mockResolvedValue(null)
    mocks.verify.mockResolvedValue({ subject: 'apple-subject', email: 'existing@example.com' })
    mocks.repository.createProviderUser.mockRejectedValue(new IdentityConflict())
    const result = await finish()
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'account_link_required' })
    expect(mocks.issue).not.toHaveBeenCalled()
  })
  it('binds linking to the original signed-in user and prevents identity transfer', async () => {
    mocks.repository.getAppleAuthAttempt.mockResolvedValue({ ...attempt, userId: user.id })
    mocks.auth.mockResolvedValueOnce({ user: { id: 'different-account' } })
    expect((await finish()).status).toBe(401)
    expect(mocks.verify).not.toHaveBeenCalled()
    mocks.repository.linkIdentity.mockResolvedValueOnce(false)
    expect((await finish()).status).toBe(409)
    expect(mocks.issue).not.toHaveBeenCalled()
    expect((await finish()).status).toBe(200)
    expect(mocks.repository.linkIdentity).toHaveBeenCalledWith(user.id, 'apple', 'apple-subject', undefined)
  })
  it('rejects malformed input, rate limits attempts, and preserves transient failure status', async () => {
    expect((await send(complete, { attemptId, identityToken: 'proof', userId: user.id })).status).toBe(400)
    mocks.rateLimit.mockReturnValueOnce(false)
    expect((await finish()).status).toBe(429)
    mocks.repository.getAppleAuthAttempt.mockRejectedValue(new Error('Database unavailable'))
    expect((await finish()).status).toBe(503)
    expect(mocks.issue).not.toHaveBeenCalled()
  })
})
