import { getToken } from 'next-auth/jwt'
import type { JWT } from 'next-auth/jwt'

export async function sessionTokenFrom(headers: Headers): Promise<JWT | null> {
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
