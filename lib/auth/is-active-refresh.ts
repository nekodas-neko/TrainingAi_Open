import type { User } from '@trainingai/shared/types/user'
import { UserFacingError, isUserFacingError } from '@trainingai/shared/errors'
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

/**
 * The active check could not run (the user lookup threw: a database fault). The request is refused
 * as "try again", 503, never as "signed out", 401: Preview signs out on our own JSON 401 from the
 * profile check and from the refresh route (`mobile/src/features/account/session.ts`), so a short
 * outage answered 401 would end the owner's sign-in. A `UserFacingError` with status 503, so the
 * shared route mappers (`routeErrorResponse`, `refusalResponse`, `withRouteErrors`) answer it as a
 * JSON 503; a route that lets it escape answers Next's 500. It is thrown, not returned as a refused
 * claim, so no route's `if (!session) return 401` can turn it into a sign-out.
 */
export class AuthCheckUnavailableError extends UserFacingError {
  constructor() {
    super('Sign-in check is temporarily unavailable. Try again.', 503)
    this.name = 'AuthCheckUnavailableError'
  }
}

export function isAuthCheckUnavailable(err: unknown): boolean {
  return err instanceof AuthCheckUnavailableError || (isUserFacingError(err) && err.name === 'AuthCheckUnavailableError')
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
    // Fails closed for this request only, as "unavailable", never as "signed out"
    // (`AuthCheckUnavailableError`). The token is not touched, and nothing is written: the next
    // call reads the row again, so once the database answers the same cookie or token passes.
    throw new AuthCheckUnavailableError()
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
