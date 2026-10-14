import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptOuraToken, encryptOuraToken, hasOuraTokenKey, OuraTokenKeyMissingError } from '../token-cipher'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const KEY = 'k'.repeat(48)

describe('Oura token encryption at rest (#2858)', () => {
  const saved = process.env.OURA_TOKEN_KEY
  beforeEach(() => { process.env.OURA_TOKEN_KEY = KEY })
  afterEach(() => { process.env.OURA_TOKEN_KEY = saved })

  it('round-trips a token and never stores it in the clear', () => {
    const stored = encryptOuraToken('access-abc', USER, 'access_token')
    expect(stored).not.toContain('access-abc')
    expect(stored.startsWith('v1.')).toBe(true)
    expect(decryptOuraToken(stored, USER, 'access_token')).toBe('access-abc')
  })

  it('uses a fresh IV each time, so the same token never encrypts the same way twice', () => {
    expect(encryptOuraToken('same', USER, 'access_token')).not.toBe(encryptOuraToken('same', USER, 'access_token'))
  })

  it('binds a value to its user and its column', () => {
    const stored = encryptOuraToken('refresh-xyz', USER, 'refresh_token')
    expect(decryptOuraToken(stored, OTHER, 'refresh_token')).toBeNull()
    expect(decryptOuraToken(stored, USER, 'access_token')).toBeNull()
  })

  it('reads a tampered value, a foreign key or a leftover plaintext token as no token', () => {
    const stored = encryptOuraToken('access-abc', USER, 'access_token')
    const parts = stored.split('.')
    const flipped = Buffer.from(parts[2], 'base64url')
    flipped[0] ^= 1
    expect(decryptOuraToken([parts[0], parts[1], flipped.toString('base64url'), parts[3]].join('.'), USER, 'access_token')).toBeNull()
    expect(decryptOuraToken('legacy-plaintext-token-from-2026-07', USER, 'access_token')).toBeNull()
    expect(decryptOuraToken(null, USER, 'access_token')).toBeNull()

    process.env.OURA_TOKEN_KEY = 'z'.repeat(48)
    expect(decryptOuraToken(stored, USER, 'access_token')).toBeNull()
  })

  it('fails closed without a key, or with one too short to be a secret', () => {
    for (const value of [undefined, '', 'short-key']) {
      if (value === undefined) delete process.env.OURA_TOKEN_KEY
      else process.env.OURA_TOKEN_KEY = value
      expect(hasOuraTokenKey()).toBe(false)
      expect(() => encryptOuraToken('t', USER, 'access_token')).toThrow(OuraTokenKeyMissingError)
      expect(() => decryptOuraToken('v1.a.b.c', USER, 'access_token')).toThrow(OuraTokenKeyMissingError)
    }
  })
})
