// #2076. How a native refresh token becomes its stored form: SHA-256, lowercase hex, and only for an
// input shaped like a real 256-bit-or-longer token.
import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { hashRefreshToken, isRefreshTokenHash, REFRESH_TOKEN_RE } from '../refresh-token-hash'

describe('hashRefreshToken (#2076)', () => {
  it('is the lowercase hex SHA-256 of the token', () => {
    const raw = randomBytes(32).toString('base64url')
    const h = hashRefreshToken(raw)
    expect(h).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(isRefreshTokenHash(h)).toBe(true)
  })

  it('is deterministic, and different tokens give different hashes', () => {
    const raw = randomBytes(32).toString('base64url')
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw))
    expect(hashRefreshToken(raw)).not.toBe(hashRefreshToken(randomBytes(32).toString('base64url')))
  })

  it('never returns the token itself or anything containing it', () => {
    const raw = randomBytes(48).toString('base64url')
    expect(hashRefreshToken(raw)).not.toContain(raw)
  })

  it('accepts 32 random bytes and up, base64url', () => {
    expect(randomBytes(32).toString('base64url')).toMatch(REFRESH_TOKEN_RE)
    expect(hashRefreshToken(randomBytes(96).toString('base64url'))).not.toBeNull()
  })

  it('refuses anything shorter or differently shaped, rather than hashing it', () => {
    const short = randomBytes(31).toString('base64url') // 42 chars: under 256 bits
    for (const bad of ['', short, 'a'.repeat(129), `${'a'.repeat(43)}=`, `${'a'.repeat(43)} `, `${'a'.repeat(42)}/`, '😀'.repeat(43)]) {
      expect(hashRefreshToken(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(hashRefreshToken(undefined as unknown as string)).toBeNull()
  })

  it('isRefreshTokenHash accepts only 64 lowercase hex characters', () => {
    expect(isRefreshTokenHash('a'.repeat(64))).toBe(true)
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null, 42]) {
      expect(isRefreshTokenHash(bad)).toBe(false)
    }
  })
})
