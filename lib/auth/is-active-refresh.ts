import type { User } from '@trainingai/shared/types/user'
import { signedInBeforeCutoff } from './session-cutoff'

const PROFILE_FIELDS = ['timezone', 'sex', 'heightCm', 'dateOfBirth', 'activityLevel'] as const
export type ClaimUser = Pick<User, 'isActive'> & Partial<Pick<User, 'isAdmin' | 'sessionsValidFrom' | typeof PROFILE_FIELDS[number]>>

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
    return token
  }
  // #3369: a sign-in older than the account's cut-off is treated as the account being inactive, the
  // one refusal every caller of this already honours (`auth()` answers null, the bearer path too).
  token.isActive = (user?.isActive ?? false) && !signedInBeforeCutoff(token.signedInAt, user?.sessionsValidFrom)
  token.isAdmin = user?.isAdmin ?? false
  if (user) {
    Object.assign(token, Object.fromEntries(PROFILE_FIELDS.filter(key => key in user).map(key => [key, user[key] ?? null])))
    token.isActiveCheckedAt = now
  }
  return token
}
