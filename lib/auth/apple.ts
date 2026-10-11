import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { safeCompare } from '@/lib/security/constant-time'

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'), { timeoutDuration: 5000 })
const audience = process.env.APPLE_NATIVE_CLIENT_ID || 'com.fitnessai.training'

export function appleNonceHash(nonce: string) {
  return createHash('sha256').update(nonce).digest('hex')
}

export async function verifyAppleIdentityToken(identityToken: string, nonceHash: string, key: Parameters<typeof jwtVerify>[1] = appleKeys) {
  const { payload } = await jwtVerify(identityToken, key, {
    algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience,
    requiredClaims: ['sub', 'iat', 'exp', 'nonce'], maxTokenAge: '10m', clockTolerance: 5,
  })
  if (!payload.sub || payload.sub.length > 255 || typeof payload.nonce !== 'string'
    || !safeCompare(appleNonceHash(payload.nonce), nonceHash)) {
    throw new Error('Invalid Apple identity')
  }
  const verifiedEmail = payload.email_verified === true || payload.email_verified === 'true'
  const email = verifiedEmail && typeof payload.email === 'string' && payload.email.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ? payload.email : undefined
  return { subject: payload.sub, email }
}
