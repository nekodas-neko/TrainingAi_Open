import { createMobileAuthToken } from './tokens'
import { PKCE_CHALLENGE_RE } from './pkce'
import { MOBILE_CHALLENGE_COOKIE, challengeMatchesCookie } from './challenge-cookie'

type CookieStore = {
  get(name: string): { value: string } | undefined
  getAll(): { name: string; value: string }[]
}

export function mintMobileBridgeToken(challenge: string | undefined, cookieStore: CookieStore): string | null {
  if (!challenge || !PKCE_CHALLENGE_RE.test(challenge)
    || !challengeMatchesCookie(challenge, cookieStore.get(MOBILE_CHALLENGE_COOKIE)?.value)) {
    return null
  }
  const name = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token' : 'authjs.session-token'
  const chunks = cookieStore.getAll()
    .filter(x => x.name.startsWith(`${name}.`))
    .sort((x, y) => Number(x.name.slice(name.length + 1)) - Number(y.name.slice(name.length + 1)))
  if (chunks.some((x, i) => x.name !== `${name}.${i}`)) {
    return null
  }
  const value = chunks.length ? chunks.map(x => x.value).join('') : cookieStore.get(name)?.value
  return value ? createMobileAuthToken(value, challenge) : null
}
