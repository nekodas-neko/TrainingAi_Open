import { timingSafeEqual } from 'crypto'
import { PKCE_CHALLENGE_RE } from '@/lib/pkce'

/**
 * RV-195 ①. Binds a mobile sign-in's PKCE challenge to the browser tab that started it.
 *
 * `/auth-mobile-bridge` mints a token for whatever `?challenge=` it is handed. So a link straight to
 * the bridge, opened in a browser where the user is already signed in, minted a token for a
 * challenge the user never chose. `/mobile-signin/begin` now stores the challenge in this httpOnly
 * cookie before sending the tab to Google, and the bridge mints only when the query and the cookie
 * agree.
 */
export const MOBILE_CHALLENGE_COOKIE = 'ta_mobile_challenge'
export const MOBILE_CHALLENGE_MAX_AGE_S = 10 * 60

export function challengeMatchesCookie(challenge: string, cookieValue: string | undefined): boolean {
  if (!cookieValue || !PKCE_CHALLENGE_RE.test(challenge) || !PKCE_CHALLENGE_RE.test(cookieValue)) return false
  return timingSafeEqual(Buffer.from(challenge), Buffer.from(cookieValue))
}
