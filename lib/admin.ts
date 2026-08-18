import { NextResponse } from 'next/server'
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

const ADMIN_ERROR_MARKER = 'AdminError'

/**
 * Q-548 — was this a refusal, or could we not decide?
 *
 * `requireAdmin` makes a DB round-trip, so a bare `catch {}` around it turns a database outage into
 * `403 Forbidden`. That is the one status a caller will neither retry nor escalate, and it points
 * an investigation at credentials: during the 2026-08-18 volume incident the first several minutes
 * went into checking env vars and the admin flag while the Railway dashboard already said the
 * service was offline.
 *
 * Falls back to the name because `instanceof` is not reliable across module realms (the same reason
 * `isNotFoundError` carries a marker).
 */
export function isAdminRefusal(err: unknown): boolean {
  return err instanceof AdminError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === ADMIN_ERROR_MARKER)
}

/** 403 when admin was genuinely refused; 503 when the check itself could not run. */
export function adminFailureStatus(err: unknown): 403 | 503 {
  return isAdminRefusal(err) ? 403 : 503
}

/** The same answer as `adminErrorResponse`, for routes that resolve auth to a value first. */
export function adminFailureOutcome(err: unknown): { ok: false; status: 403 | 503; error: string } {
  return isAdminRefusal(err)
    ? { ok: false, status: 403, error: 'Forbidden' }
    : { ok: false, status: 503, error: 'Service unavailable' }
}

/**
 * The standard answer to a failed `requireAdmin`. Use this instead of a bare
 * `catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }` — an outage must
 * look like an outage. `scripts/check-admin-guard-catch.js` enforces it in the Custom Rules job.
 */
export function adminErrorResponse(err: unknown): NextResponse {
  return isAdminRefusal(err)
    ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    : NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
}
