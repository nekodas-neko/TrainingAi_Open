import { describe, it, expect } from 'vitest'
import { computePkceChallenge, verifyPkce, PKCE_CHALLENGE_RE, PKCE_VERIFIER_RE } from '../pkce'

// RFC 7636 Appendix B vector
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('pkce', () => {
  it('computes the RFC 7636 S256 challenge', () => {
    expect(computePkceChallenge(VERIFIER)).toBe(CHALLENGE)
  })
  it('verifies a matching pair and rejects mismatches', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
    expect(verifyPkce(VERIFIER, CHALLENGE.slice(0, -1) + 'A')).toBe(false)
    expect(verifyPkce(VERIFIER + 'x', CHALLENGE)).toBe(false)
  })
  it('rejects malformed inputs before hashing', () => {
    expect(verifyPkce('short', CHALLENGE)).toBe(false)
    expect(verifyPkce(VERIFIER, 'not-base64url!!')).toBe(false)
    expect(verifyPkce('', '')).toBe(false)
  })
  it('format regexes match 43-char base64url', () => {
    expect(PKCE_VERIFIER_RE.test(VERIFIER)).toBe(true)
    expect(PKCE_CHALLENGE_RE.test(CHALLENGE)).toBe(true)
    expect(PKCE_CHALLENGE_RE.test(CHALLENGE + 'a')).toBe(false)
  })
})
