import { createMobileAuthToken } from '@/lib/mobile-auth-tokens'
import { PKCE_CHALLENGE_RE } from '@/lib/pkce'
import { MOBILE_CHALLENGE_COOKIE, challengeMatchesCookie } from '@/lib/mobile-auth-challenge-cookie'

/**
 * The token `/auth-mobile-bridge` hands back to the APK, or null when it must refuse. Kept out of
 * the page so it can be tested without JSX.
 *
 * RV-195 ①: the challenge must be well-formed AND be the one this tab registered at
 * `/mobile-signin/begin`, and the tab must hold a session cookie to wrap.
 */
export function mintMobileBridgeToken(
  challenge: string | undefined,
  cookieStore: { get(name: string): { value: string } | undefined },
): string | null {
  if (!challenge || !PKCE_CHALLENGE_RE.test(challenge)) return null
  if (!challengeMatchesCookie(challenge, cookieStore.get(MOBILE_CHALLENGE_COOKIE)?.value)) return null
  const sessionCookie =
    cookieStore.get('__Secure-authjs.session-token') ?? cookieStore.get('authjs.session-token')
  if (!sessionCookie?.value) return null
  return createMobileAuthToken(sessionCookie.value, challenge)
}
