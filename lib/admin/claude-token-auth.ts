import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { clientIp } from '@trainingai/shared/http/client-ip'

export type AdminAuthOutcome =
  | { ok: true; via: 'session' | 'token'; userId: string }
  | { ok: false; status: number; error: string }

/**
 * The admin read endpoints' authorisation: `/api/admin/db-query` and `/api/admin/replay` (TN-56).
 * One copy, so the two cannot drift apart on the part that matters.
 *
 * Either an admin session, or `Authorization: Bearer <CLAUDE_DB_QUERY_SECRET>`, which resolves to
 * `ADMIN_EXPORT_USER_ID` (else `WEBHOOK_USER_ID`), and that user must be an admin: the token names
 * a caller, it does not confer a role. Every token attempt is rate-limited per IP BEFORE the compare,
 * and a trip returns the same 401 as a bad token. Fails closed when the secret or user is unset.
 *
 * `tokenRateKey` keeps each endpoint's brute-force budget separate (`db-query-token` for db-query,
 * as it always was).
 */
export async function authorizeAdminRequest(req: NextRequest, tokenRateKey: string): Promise<AdminAuthOutcome> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    const ip = clientIp(req)
    if (!rateLimit(`${tokenRateKey}:${ip}`, 10, 60_000)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    const expected = process.env.CLAUDE_DB_QUERY_SECRET
    const exportUserId = process.env.ADMIN_EXPORT_USER_ID ?? process.env.WEBHOOK_USER_ID
    if (!expected || !exportUserId || !safeCompare(bearer, expected)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    try {
      await requireAdmin(exportUserId)
    } catch (err) {
      return adminFailureOutcome(err)
    }
    return { ok: true, via: 'token', userId: exportUserId }
  }

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminFailureOutcome(err)
  }
  return { ok: true, via: 'session', userId }
}
