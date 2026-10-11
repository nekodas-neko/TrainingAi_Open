import { decode, encode } from 'next-auth/jwt'
import type { User } from '@trainingai/shared/types/user'
import { userClaims } from '../user'
import { SESSION_MAX_AGE_SECONDS } from '../session'

export async function issueNativeSession(user: User) {
  if (!user.isActive || !process.env.AUTH_SECRET) {
    throw new Error('Cannot issue session')
  }
  const secret = process.env.AUTH_SECRET
  const salt = process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token'
  const accessToken = await encode({
    secret, salt,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: { ...userClaims(user), userId: user.id, name: user.name ?? null, email: user.email },
  })
  const token = await decode({ token: accessToken, secret, salt })
  if (!token?.exp) {
    throw new Error('Cannot read session expiry')
  }
  return { ok: true, accessToken, tokenType: 'Bearer', expiresAt: token.exp }
}
