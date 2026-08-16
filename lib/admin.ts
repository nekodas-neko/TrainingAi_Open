import { getRepository } from '@/lib/data'

export class AdminError extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'AdminError'
  }
}

// The JWT isAdmin flag is deliberately IGNORED here: it is stamped at login
// and can be stale for up to 30 days (e.g. a revoked admin keeps the old
// token). Admin calls are rare, so the DB round-trip is the point — it is
// the authoritative check. The parameter stays only for call-site
// compatibility. Routes wrap this in try/catch and return a 403.
export async function requireAdmin(userId: string, _isAdmin?: boolean): Promise<void> {
  if (!userId) throw new AdminError()
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user?.isAdmin) throw new AdminError()
}

export async function isAdminUser(userId: string, isAdmin?: boolean): Promise<boolean> {
  if (typeof isAdmin === 'boolean') return isAdmin
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  return user?.isAdmin ?? false
}
