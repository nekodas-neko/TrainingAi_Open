import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { isAuthCheckUnavailable } from '@/lib/auth/is-active-refresh'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { getRepository } from '@/lib/data'
import { isOwnerUserId, resolveOwnerUserId } from '@/lib/admin-owner'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { clientIp } from '@trainingai/shared/http/client-ip'

export type AdminAuthOutcome =
  | { ok: true; via: 'session' | 'token'; userId: string; ownerId?: string }
  | { ok: false; status: number; error: string }

/**
 * #3657: the session branch for a tool whose reads are the owner's data whoever asks (db-query runs
 * as `claude_ro`, scoped to the owner by default; db-snapshot streams the owner's rows). An admin
 * session is enough only when it is the owner's: `requireAdmin` has already re-read the caller's row,
 * and the owner is resolved from the settings and checked to be an existing, active admin
 * (`resolveOwnerUserId`), never from a claim in the token. Any other admin gets the same 403 as a
 * non-admin. An owner that cannot be resolved refuses everyone (fail closed). The agents use the
 * bearer token, which this does not change.
 */
export async function requireOwnerSession(userId: string): Promise<{ ok: true; ownerId: string } | { ok: false; status: 403 | 503; error: string }> {
  let ownerId: string | null
  try {
    ownerId = await resolveOwnerUserId(await getRepository())
  } catch {
    // The lookup threw (`OwnerLookupUnavailableError`) or the repository could not be reached: a
    // fault, so "try again", never "only the owner". Nothing owner-only runs either way.
    return { ok: false, status: 503, error: 'Service unavailable' }
  }
  // No owner resolved (unset, malformed, or naming no active admin) stays 403, as for any other
  // non-owner: it is a settings state, not a transient fault, and retrying will not change it.
  return ownerId !== null && isOwnerUserId(userId, ownerId) ? { ok: true, ownerId } : { ok: false, status: 403, error: 'Forbidden' }
}

/**
 * #3949 review N7: the owner a db-query or db-snapshot request reads as, set explicitly on every
 * scoped query (`runScoped`'s `ownerId`, i.e. `SET LOCAL app.claude_ro_owner`) instead of left to
 * the read-only role's default. It is the id the owner check resolved for this same request when
 * there was one (a session), else resolved now the same way (`resolveOwnerUserId`, the settings
 * `CLAUDE_RO_OWNER_USER_ID` → `ADMIN_EXPORT_USER_ID` → `WEBHOOK_USER_ID`, an existing active
 * admin). So the person the check let in and the rows the query reads can never come from two
 * different settings. Refused when the owner cannot be resolved, or when the lookup threw: the
 * caller answers the refusal and runs nothing. Both are 503 here (a token caller has already
 * proved itself, so an unconfigured owner is the server's setting at fault, as before), but a
 * thrown lookup says "Service unavailable", not "not configured".
 */
export async function scopeOwnerFor(
  authed: { ownerId?: string },
): Promise<{ ok: true; ownerId: string } | { ok: false; status: 503; error: string; reason: 'unavailable' | 'unresolved' }> {
  if (authed.ownerId) return { ok: true, ownerId: authed.ownerId }
  let ownerId: string | null
  try {
    ownerId = await resolveOwnerUserId(await getRepository())
  } catch {
    return { ok: false, status: 503, error: 'Service unavailable', reason: 'unavailable' }
  }
  return ownerId
    ? { ok: true, ownerId }
    : { ok: false, status: 503, error: 'The owner account is not configured', reason: 'unresolved' }
}

/**
 * The admin read endpoints' authorisation: `/api/admin/db-query` and `/api/admin/replay` (TN-56).
 * One copy, so the two cannot drift apart on the part that matters.
 *
 * Either an admin session, or `Authorization: Bearer <CLAUDE_DB_QUERY_SECRET>`, which resolves to
 * `ADMIN_EXPORT_USER_ID` (else `WEBHOOK_USER_ID`), and that user must be an admin: the token names
 * a caller, it does not confer a role. Every token attempt is rate-limited per IP BEFORE the compare,
 * and a trip returns the same 401 as a bad token. Fails closed when the secret or user is unset.
 *
 * `sessionOwnerOnly` (#3657, db-query): a session must also be the owner's (`requireOwnerSession`).
 * Replay leaves it off: its session path reads the signed-in admin's own data.
 *
 * `tokenRateKey` keeps each endpoint's brute-force budget separate (`db-query-token` for db-query,
 * as it always was).
 */
export async function authorizeAdminRequest(
  req: NextRequest,
  tokenRateKey: string,
  opts: { sessionOwnerOnly?: boolean } = {},
): Promise<AdminAuthOutcome> {
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

  let session: Awaited<ReturnType<typeof auth>>
  try {
    session = await auth()
  } catch (err) {
    if (isAuthCheckUnavailable(err)) return { ok: false, status: 503, error: 'Service unavailable' }
    throw err
  }
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  try {
    await requireAdmin(userId, session?.user?.isAdmin)
  } catch (err) {
    return adminFailureOutcome(err)
  }
  if (opts.sessionOwnerOnly) {
    const owner = await requireOwnerSession(userId)
    if (!owner.ok) return owner
    return { ok: true, via: 'session', userId, ownerId: owner.ownerId }
  }
  return { ok: true, via: 'session', userId }
}
