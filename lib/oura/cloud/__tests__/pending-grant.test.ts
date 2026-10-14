import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openPendingGrant, PENDING_GRANT_MAX_AGE_MS, sealPendingGrant, type PendingGrant } from '../pending-grant'
import { decryptOuraToken, OuraTokenKeyMissingError } from '../token-cipher'

const USER = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-10-14T02:00:00Z')
const PENDING: PendingGrant = {
  userId: USER,
  client: 'android-preview',
  grant: { accessToken: 'acc-1', refreshToken: 'ref-1', expiresAt: new Date(NOW + 86400_000), scope: 'daily', ouraUserId: 'oura-u1' },
}

describe('the sealed pending grant a native connect carries back to the app', () => {
  const saved = process.env.OURA_TOKEN_KEY
  beforeEach(() => { process.env.OURA_TOKEN_KEY = 'k'.repeat(48) })
  afterEach(() => { process.env.OURA_TOKEN_KEY = saved })

  it('round-trips, and the handle shows no token', () => {
    const handle = sealPendingGrant(PENDING, NOW)
    expect(handle).not.toContain('acc-1')
    expect(handle).not.toContain('ref-1')
    expect(openPendingGrant(handle, NOW + 1000)).toEqual(PENDING)
  })

  it('expires with the connect window', () => {
    const handle = sealPendingGrant(PENDING, NOW)
    expect(openPendingGrant(handle, NOW + PENDING_GRANT_MAX_AGE_MS - 1)).not.toBeNull()
    expect(openPendingGrant(handle, NOW + PENDING_GRANT_MAX_AGE_MS)).toBeNull()
  })

  it('rejects tampering and a different key', () => {
    const handle = sealPendingGrant(PENDING, NOW)
    const parts = handle.split('.')
    const body = Buffer.from(parts[2], 'base64url')
    body[3] ^= 1
    expect(openPendingGrant([parts[0], parts[1], body.toString('base64url'), parts[3]].join('.'), NOW)).toBeNull()
    expect(openPendingGrant('p1.a.b.c', NOW)).toBeNull()
    process.env.OURA_TOKEN_KEY = 'z'.repeat(48)
    expect(openPendingGrant(handle, NOW)).toBeNull()
  })

  it('is keyed apart from stored tokens: neither opens as the other', () => {
    const handle = sealPendingGrant(PENDING, NOW)
    expect(decryptOuraToken(`v1.${handle.split('.').slice(1).join('.')}`, USER, 'access_token')).toBeNull()
  })

  it('fails closed without the key', () => {
    delete process.env.OURA_TOKEN_KEY
    expect(() => sealPendingGrant(PENDING, NOW)).toThrow(OuraTokenKeyMissingError)
  })
})
