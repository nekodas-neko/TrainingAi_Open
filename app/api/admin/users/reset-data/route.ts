import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { rateLimit, settleRateLimitFlushes } from '@/lib/rate-limit'
import { readOuraGrantBestEffort, revokeOuraGrantAfterCommit } from '@/lib/account/revoke-oura-grant'
import { resolveOwnerUserId } from '@/lib/admin-owner'
import { clearSessionCookies } from '@/lib/auth/clear-session-cookies'
import {
  ResetBodySchema, WIPE_MAX_BODY_BYTES, WIPE_RATE, auditActor, precheckWipe, wipeRateKey, wipeRefusalResponse,
} from '@/lib/admin/user-wipe'

/**
 * #3369 — reset a user's data and keep the account.
 *
 * Everything the account holds goes, through the same cascade a deletion uses; the account itself
 * (id, email, sign-in identities, password hash, admin flag, active state) stays, so the person
 * signs in again and starts empty. Every device is signed out: the cascade deletes their native
 * refresh tokens, and `users.sessions_valid_from` refuses every web session issued before now. A
 * phone that still holds the old rows therefore cannot push them back, and wipes them when it signs
 * in again (`lib/local-store/data-epoch.ts`).
 *
 * Who: an admin, and only for themselves or a non-admin. Another admin's account is refused, so no
 * admin can wipe the owner. The target's email is typed and checked on the server, inside the
 * transaction. The audit row is written in the same transaction as the reset, so a reset that
 * cannot be recorded does not happen.
 *
 * The Oura grant is read before the reset and revoked at Oura only after it commits (a failed reset
 * must not leave the person disconnected).
 *
 * Fails closed at every step: nothing is changed unless the response is 200.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminId = session.user.id

  try {
    await requireAdmin(adminId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(wipeRateKey(adminId), WIPE_RATE.limit, WIPE_RATE.windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, WIPE_MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ResetBodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Send the user id and that user\'s email, and nothing else.' }, { status: 400 })
  const { userId, confirmEmail } = parsed.data
  const badId = invalidUuidResponse(userId)
  if (badId) return badId
  const ownerId = await resolveOwnerUserId(await getRepository())

  let result
  let ouraToken: string | null = null
  try {
    const repo = await getRepository()
    const early = await precheckWipe(repo, { userId, actingAdminId: adminId, ownerId, confirmEmail, mayWipeSelf: true })
    if (early) return early
    // The limiter writes its row in the background; let this request's land before the reset
    // purges keys naming the user (their own, when an admin resets themselves).
    await settleRateLimitFlushes()
    ouraToken = await readOuraGrantBestEffort(repo, userId, req.nextUrl.pathname)
    result = await repo.resetAccountData(userId, {
      guard: { actingAdminId: adminId, ownerId, confirmEmail },
      audit: { job: 'admin-reset-user-data', actor: auditActor(adminId) },
    })
  } catch (err) {
    console.error('[admin/users/reset-data] reset failed', err)
    reportServerError(err, { userId: adminId, url: req.nextUrl.pathname })
    return NextResponse.json({ error: 'The data could not be reset, and nothing was removed.' }, { status: 500 })
  }
  if (result.refused) return wipeRefusalResponse(result.refused)
  if (!result.deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  await revokeOuraGrantAfterCommit(ouraToken, userId, new URL(req.url).pathname)

  const res = NextResponse.json(
    {
      ok: true,
      reset: true,
      // The target's sessions are over; for a self-reset that is the caller's own, so the cookie is
      // expired here and the screen goes to the sign-in page.
      signedOut: userId === adminId,
      removedRows: Object.values(result.removed ?? {}).reduce((a, b) => a + b, 0),
      // False means the reset is done but the built-in styles could not be put back; reset again to seed them.
      defaultsSeeded: result.defaultsSeeded === true,
      anonymised: result.anonymised,
      purged: result.purged,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
  if (userId === adminId) clearSessionCookies(req, res)
  return res
}
