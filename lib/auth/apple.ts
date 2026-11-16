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
  const privateRelay = payload.is_private_email === true || payload.is_private_email === 'true'
  return { subject: payload.sub, email, emailVerified: verifiedEmail, privateRelay }
}

export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com'

/**
 * #3830: whether Apple vouches for the address enough for an invite to activate the account. Only a
 * verified, real address does: a private-relay address is Apple's forwarder, not the invited inbox.
 * Fails closed: anything missing or unclear is false.
 */
export function appleEmailIsAuthoritative(identity: { email?: string; emailVerified?: boolean; privateRelay?: boolean }) {
  if (!identity.email || identity.emailVerified !== true || identity.privateRelay !== false) {
    return false
  }
  return !identity.email.trim().toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`)
}
