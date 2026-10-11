import { timingSafeEqual } from 'crypto'
import { PKCE_CHALLENGE_RE } from './pkce'

export const MOBILE_CHALLENGE_COOKIE = 'ta_mobile_challenge'
export const MOBILE_CHALLENGE_MAX_AGE_S = 10 * 60

export function challengeMatchesCookie(challenge: string, cookieValue: string | undefined): boolean {
  if (!cookieValue || !PKCE_CHALLENGE_RE.test(challenge) || !PKCE_CHALLENGE_RE.test(cookieValue)) {
    return false
  }
  return timingSafeEqual(Buffer.from(challenge), Buffer.from(cookieValue))
}
