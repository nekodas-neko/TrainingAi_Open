import type { User } from '@trainingai/shared/types/user'

const PROFILE_FIELDS = ['timezone', 'sex', 'heightCm', 'dateOfBirth', 'activityLevel'] as const
export type ClaimUser = Pick<User, 'isActive'> & Partial<Pick<User, 'isAdmin' | typeof PROFILE_FIELDS[number]>>

export type IsActiveClaim = {
  userId?: string
  isActive?: boolean
  isAdmin?: boolean
  isActiveCheckedAt?: number
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
  token.isActive = user?.isActive ?? false
  token.isAdmin = user?.isAdmin ?? false
  if (user) {
    Object.assign(token, Object.fromEntries(PROFILE_FIELDS.filter(key => key in user).map(key => [key, user[key] ?? null])))
    token.isActiveCheckedAt = now
  }
  return token
}
