import { createHash } from 'crypto'

// #2076. The one way a native-app refresh token becomes the value stored in
// `native_refresh_tokens.token_hash`. The token itself is never stored: the server hands it to the
// app once, and every later use is resolved by hashing what the app presents and looking the hash
// up. Nothing in PR a issues a token; this file only fixes how one is hashed, so the table's
// `token_hash` CHECK and the code that will write it agree from the start.
//
// Plain SHA-256, no pepper. A pepper (HMAC with a server secret) protects secrets a person could
// guess, such as passwords, after a database leak. A refresh token is at least 256 random bits, so
// its hash cannot be reversed or guessed either way. That argument only holds if the token really
// is long and random, which is why a shorter or differently shaped input is refused rather than
// hashed: a short token hashed here would look as safe in the table as a real one.

/** A lowercase hex SHA-256 of a refresh token. Only `hashRefreshToken` makes one, so a repository
 *  method that takes this type cannot be handed the raw token by mistake. */
export type RefreshTokenHash = string & { readonly __brand: 'RefreshTokenHash' }

/** base64url, 43–128 characters: 43 is 32 random bytes (256 bits), the shortest token accepted. */
export const REFRESH_TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/
const HASH_RE = /^[0-9a-f]{64}$/

/** The stored form of a presented refresh token, or `null` when the input is not shaped like one
 *  (the caller answers 401; nothing malformed is ever hashed or looked up). */
export function hashRefreshToken(raw: string): RefreshTokenHash | null {
  if (typeof raw !== 'string' || !REFRESH_TOKEN_RE.test(raw)) return null
  return createHash('sha256').update(raw, 'ascii').digest('hex') as RefreshTokenHash
}

/** For values read back from the database or a fixture: true when `v` is a stored-form hash. */
export function isRefreshTokenHash(v: unknown): v is RefreshTokenHash {
  return typeof v === 'string' && HASH_RE.test(v)
}
