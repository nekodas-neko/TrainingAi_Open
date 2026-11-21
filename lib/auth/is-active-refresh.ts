import type { User } from '@trainingai/shared/types/user'
import { signedInBeforeCutoff, signedInBeforeSignInCutoff } from './session-cutoff'

const PROFILE_FIELDS = ['timezone', 'sex', 'heightCm', 'dateOfBirth', 'activityLevel'] as const
export type ClaimUser = Pick<User, 'isActive'> & Partial<Pick<User, 'isAdmin' | 'sessionsValidFrom' | 'signInsValidFrom' | typeof PROFILE_FIELDS[number]>>

export type IsActiveClaim = {
  userId?: string
  isActive?: boolean
  isAdmin?: boolean
  isActiveCheckedAt?: number
  signedInAt?: number
}

export async function refreshIsActiveClaim<T extends IsActiveClaim>(
  token: T,
  lookup: (userId: string) => Promise<ClaimUser | null>,
  now: number = Date.now(),
): Promise<T> {
  if (!token.userId) {
    return token
  }

  let user: Awaited<ReturnType<typeof lookup>>
  try {
    user = await lookup(token.userId)
  } catch {
    // Fails closed for this request only. A lookup that throws (a database fault) cannot show the
    // sign-in is still good, and the cut-offs above are only enforced through this check, so the
    // token is refused as inactive. Nothing here outlives the request: no caller writes this claim
    // back into a cookie or token (`auth()` builds a fresh session from it, the bearer path a
    // decoded copy, the jwt callback never calls this), `isActiveCheckedAt` and the profile fields
    // are left as they were, and the next call recomputes `isActive` from the row alone, never from
    // the value set here. So once the database answers again the same cookie passes.
    token.isActive = false
    token.isAdmin = false
    return token
  }
  // #3369: a sign-in older than the account's cut-off is treated as the account being inactive, the
  // one refusal every caller of this already honours (`auth()` answers null, the bearer path too).
  // #3829: the sign-in cut-off (a Google link that cleared the password, a sign-out, a password
  // change) is its own column, which is not the data epoch, under the strict rule
  // (`signedInBeforeSignInCutoff`: issued before it is refused, no same-second survivor). The row is
  // already loaded here on every request, so it costs no query. An unreadable cut-off (an invalid
  // date) refuses.
  token.isActive = (user?.isActive ?? false)
    && !signedInBeforeCutoff(token.signedInAt, user?.sessionsValidFrom)
    && !signedInBeforeSignInCutoff(token.signedInAt, user?.signInsValidFrom)
  token.isAdmin = user?.isAdmin ?? false
  if (user) {
    Object.assign(token, Object.fromEntries(PROFILE_FIELDS.filter(key => key in user).map(key => [key, user[key] ?? null])))
    token.isActiveCheckedAt = now
  }
  return token
}
