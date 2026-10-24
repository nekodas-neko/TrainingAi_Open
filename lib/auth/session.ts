export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
export const NATIVE_SESSION_SALT = 'trainingai-native-session'
// #2076, owner 2026-10-06: the native app's own token lasts about a day and renews through a
// refresh token. The refresh token slides: each use issues a successor good for another 30 days.
export const NATIVE_ACCESS_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60
export const NATIVE_REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
// A refresh token presented again this soon after it was rotated, whose successor was never used,
// is taken as a lost response rather than theft (the app timed out, or was suspended mid-call).
export const NATIVE_REFRESH_REUSE_GRACE_SECONDS = 60

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
