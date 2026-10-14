// Oura OAuth tokens at rest (#2858). `oura_tokens.access_token` and `refresh_token` hold only what
// this module writes: AES-256-GCM ciphertext under a key derived from `OURA_TOKEN_KEY`.
//
// - The key is HKDF-SHA256 over the secret, so the secret can be any long random string and the
//   cipher still gets a uniform 32-byte key.
// - Each value is bound to its user and its column through the GCM additional data. A ciphertext
//   copied to another user's row, or from `refresh_token` into `access_token`, does not decrypt.
// - Missing key: encryption and decryption both throw `OuraTokenKeyMissingError`. Nothing ever
//   writes a plaintext token as a fallback, and nothing reads one back.
// - A stored value that does not decrypt (tampered, a different key, or the plaintext left over
//   from the Cloud integration removed on 2026-08-13) reads as `null`: no connection.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
/** A shorter secret is refused rather than stretched: HKDF cannot add entropy that is not there. */
export const MIN_TOKEN_KEY_LENGTH = 32
const HKDF_SALT = 'trainingai/oura_tokens'
const HKDF_INFO = 'oura_tokens v1 aes-256-gcm'

export type OuraTokenColumn = 'access_token' | 'refresh_token'

/** Ciphertext as stored in `oura_tokens`. Branded so a plaintext token cannot be passed as one. */
export type EncryptedOuraToken = string & { readonly __brand: 'EncryptedOuraToken' }

export class OuraTokenKeyMissingError extends Error {
  constructor() {
    super(`OURA_TOKEN_KEY is not set (or shorter than ${MIN_TOKEN_KEY_LENGTH} characters), so Oura tokens cannot be stored or read.`)
    this.name = 'OuraTokenKeyMissingError'
  }
}

const cache = new Map<string, { secret: string; key: Buffer }>()

/**
 * A 32-byte key derived from `OURA_TOKEN_KEY` for one purpose. Each purpose gets its own HKDF `info`,
 * so a value sealed for one (a stored token, a pending grant) never opens as another.
 */
export function deriveOuraKey(info: string): Buffer {
  const secret = process.env.OURA_TOKEN_KEY
  if (!secret || secret.length < MIN_TOKEN_KEY_LENGTH) throw new OuraTokenKeyMissingError()
  const hit = cache.get(info)
  if (hit?.secret === secret) return hit.key
  const key = Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, info, 32))
  cache.set(info, { secret, key })
  return key
}

function tokenKey(): Buffer {
  return deriveOuraKey(HKDF_INFO)
}

/** True when a usable key is configured. Routes check it first to fail closed with a clear error. */
export function hasOuraTokenKey(): boolean {
  try {
    tokenKey()
    return true
  } catch {
    return false
  }
}

function additionalData(userId: string, column: OuraTokenColumn): Buffer {
  return Buffer.from(`oura_tokens:${userId}:${column}`, 'utf8')
}

export function encryptOuraToken(plaintext: string, userId: string, column: OuraTokenColumn): EncryptedOuraToken {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(additionalData(userId, column))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}.${tag.toString('base64url')}` as EncryptedOuraToken
}

/**
 * The plaintext, or `null` when `stored` is not a value this key wrote for this user and column.
 * Throws only `OuraTokenKeyMissingError`, so a missing key is never mistaken for "not connected".
 */
export function decryptOuraToken(stored: string | null | undefined, userId: string, column: OuraTokenColumn): string | null {
  const key = tokenKey()
  if (!stored) return null
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const iv = Buffer.from(parts[1], 'base64url')
  const body = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(additionalData(userId, column))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
