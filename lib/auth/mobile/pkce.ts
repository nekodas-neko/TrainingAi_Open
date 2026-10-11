import { createHash, timingSafeEqual } from 'crypto'
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/
export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

export function computePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_RE.test(verifier) || !PKCE_CHALLENGE_RE.test(challenge)) {
    return false
  }
  const a = Buffer.from(computePkceChallenge(verifier))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}
