export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

export function sessionFromToken(session: Session, token: JWT): Session {
  // Only public claims belong in the browser-readable session.
  if (token.userId) {
    session.user.id = token.userId
  }
  if (typeof token.isActive === 'boolean') {
    session.isActive = token.isActive
  }
  if (typeof token.isAdmin === 'boolean') {
    session.user.isAdmin = token.isAdmin
  }
  if (token.timezone) {
    session.user.timezone = token.timezone
  }
  session.user.sex = token.sex ?? null
  session.user.heightCm = token.heightCm ?? null
  session.user.dateOfBirth = token.dateOfBirth ?? null
  session.user.activityLevel = token.activityLevel ?? null
  session.user.friendCode = token.friendCode ?? null
  session.user.equippedTitle = token.equippedTitle ?? null
  return session
}
