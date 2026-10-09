export type IsActiveClaim = {
  userId?: string
  isActive?: boolean
  isAdmin?: boolean
  isActiveCheckedAt?: number
}

export async function refreshIsActiveClaim<T extends IsActiveClaim>(
  token: T,
  lookup: (userId: string) => Promise<{ isActive: boolean; isAdmin?: boolean } | null>,
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
    token.isActiveCheckedAt = now
  }
  return token
}
