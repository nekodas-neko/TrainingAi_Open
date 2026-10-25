import { getToken, decode } from 'next-auth/jwt'
import type { JWT } from 'next-auth/jwt'
import { NATIVE_SESSION_SALT } from './session'

export async function sessionTokenFrom(headers: Headers): Promise<JWT | null> {
  const bearer = headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
  if (bearer && process.env.AUTH_SECRET) {
    try {
      const native = await decode({ token: bearer, secret: process.env.AUTH_SECRET, salt: NATIVE_SESSION_SALT })
      if (typeof native?.nativeTokenId === 'string' || typeof native?.nativeSessionKey === 'string') return native
    } catch {}
  }
  return getToken({
    req: { headers },
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  })
}

export async function googleRefreshTokenFrom(headers: Headers): Promise<string | null> {
  const token = await sessionTokenFrom(headers)
  return typeof token?.refreshToken === 'string' && token.refreshToken.length > 0
    ? token.refreshToken
    : null
}
