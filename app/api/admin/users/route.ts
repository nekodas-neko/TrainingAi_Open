import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A user id and a one-word action. 4 KB is generous.
const MAX_BODY_BYTES = 4 * 1024
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { rateLimit, settleRateLimitFlushes } from '@/lib/rate-limit'
import { readOuraGrantBestEffort, revokeOuraGrantAfterCommit } from '@/lib/account/revoke-oura-grant'
import {
  DeleteBodySchema, WIPE_MAX_BODY_BYTES, WIPE_RATE, auditActor, precheckWipe, wipeRateKey, wipeRefusalResponse,
} from '@/lib/admin/user-wipe'
import { resolveOwnerUserId, judgeProtectedTarget, judgeRevokeAdmin, sameUserId, ownerRefusalMessage } from '@/lib/admin-owner'

/**
 * #2383 item 3 — the one self-check both mutating handlers share. Deleting or deactivating your own
 * account ends your admin session (deactivation redirects every request to `/pending`), and only an
 * admin can undo it, so the signed-in admin is refused before anything is written. Because the
 * acting admin can never remove themselves, these two routes also cannot leave zero active admins.
 */
function refuseSelf(targetUserId: string, sessionUserId: string, verb: 'delete' | 'deactivate' | 'remove admin from') {
  return sameUserId(targetUserId, sessionUserId)
    ? NextResponse.json({ error: `Cannot ${verb} yourself` }, { status: 400 })
    : null
}

const patchSchema = z.object({
  userId: z.string(),
  action: z.enum(['activate', 'deactivate', 'grant-admin', 'revoke-admin']),
}).strict()

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-548 — the check answers 403 or 503; the listing is outside it, so a failed query surfaces as
  // the fault it is rather than as a revoked credential.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 200)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0
  const repo = await getRepository()
  const users = await repo.listUsers(limit, offset)
  // issue 2695: the admin screen splits the inactive users into Pending (no data, deletable) and
  // Deactivated (has data, not deletable). Only inactive rows are asked about; the server still
  // decides again at delete time, so this is display, not the guard.
  const withData = await repo.usersWithData(users.filter(u => !u.isActive).map(u => u.id))
  return NextResponse.json({ users: users.map(({ sessionsValidFrom: _cutoff, ...u }) => ({ ...u, hasData: !u.isActive && withData.has(u.id) })) })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { userId, action } = parsed.data
  // RV-47: `users.id` is a uuid, so a malformed one reached the driver as a 22P02 and answered 500
  // with an empty body, filing the failing UPDATE statement into `error_events` as a server fault.
  const badId = invalidUuidResponse(userId)
  if (badId) return badId
  // Every action here is an auth or access change; 30 a minute per admin is far above real use.
  if (!rateLimit(`admin-users-patch:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const ownerId = await resolveOwnerUserId(repo)

  // Activating yourself is a no-op (you are signed in, so already active); only deactivation locks out.
  if (action === 'deactivate') {
    const self = refuseSelf(userId, session.user.id, 'deactivate')
    if (self) return self
    // The owner's account is theirs alone to deactivate; with no resolvable owner no admin account is.
    const target = await repo.getUserById(userId)
    if (target) {
      const refused = judgeProtectedTarget(session.user.id, userId, target.isAdmin === true, ownerId)
      if (refused) {
        console.warn(`[admin/users] deactivate refused (${refused}): admin ${session.user.id} -> ${userId}`)
        return NextResponse.json({ error: ownerRefusalMessage(refused, 'deactivate this account') }, { status: 403 })
      }
    }
  }

  if (action === 'grant-admin' || action === 'revoke-admin') {
    // An admin can't remove their own admin, so there is always at least one. Granting yourself is a no-op.
    if (action === 'revoke-admin') {
      const self = refuseSelf(userId, session.user.id, 'remove admin from')
      if (self) return self
      // Only the owner removes admin. Checked again on the locked rows inside the transaction.
      const refused = judgeRevokeAdmin(session.user.id, ownerId)
      if (refused) {
        console.warn(`[admin/users] remove admin refused (${refused}): admin ${session.user.id} -> ${userId}`)
        return NextResponse.json({ error: ownerRefusalMessage(refused, 'remove admin') }, { status: 403 })
      }
    }
    const outcome = await repo.setUserAdmin({
      actingAdminId: session.user.id, targetUserId: userId, makeAdmin: action === 'grant-admin', ownerId,
    })
    if (outcome.ok) return NextResponse.json({ ok: true })
    switch (outcome.reason) {
      case 'not-found': return NextResponse.json({ error: 'User not found' }, { status: 404 })
      case 'inactive-target': return NextResponse.json({ error: 'Only an active user can be made admin' }, { status: 400 })
      case 'actor-not-admin': return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      default: return NextResponse.json({ error: ownerRefusalMessage(outcome.reason, 'remove admin') }, { status: 403 })
    }
  }

  // RV-48: an id that matched no user answered `200 {"ok":true}`, the same response a real
  // activation gives. The row count decides every action.
  const changed = action === 'activate' ? await repo.activateUser(userId) : await repo.deactivateUser(userId)
  if (!changed) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, WIPE_MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = DeleteBodySchema.safeParse(read.body)
  if (!parsed.success) {
    const named = (read.body ?? {}) as { userId?: unknown }
    return typeof named.userId !== 'string' || !named.userId
      ? NextResponse.json({ error: 'userId required' }, { status: 400 })
      : NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { userId, confirmEmail } = parsed.data
  const badId = invalidUuidResponse(userId)
  if (badId) return badId
  const self = refuseSelf(userId, session.user.id, 'delete')
  if (self) return self
  const ownerId = await resolveOwnerUserId(await getRepository())

  // #3369: with the target's email typed, an admin may delete an account that holds data. Without
  // it the long-standing rule stands (issue 2695): only a signup that never got in, which has
  // nothing to confirm. Either way another admin's account is refused, and the row is written to
  // the audit log in the deletion's own transaction.
  const confirmed = confirmEmail !== undefined
  if (confirmed && !rateLimit(wipeRateKey(session.user.id), WIPE_RATE.limit, WIPE_RATE.windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // #2120: the same deletion the user's own `DELETE /api/account` runs. This used to be a bare
  // `DELETE FROM users`, which threw for any account with a custom exercise or a saved meal.
  // issue 2695: `onlyIfNoData` makes the deletion itself refuse an account holding data, inside its
  // transaction after the row lock, so an account that gains data between the screen loading and
  // the tap is still refused.
  let result
  let ouraToken: string | null = null
  try {
    const repo = await getRepository()
    if (confirmed) {
      // Judge the target first: the Oura grant cannot be put back, so it is not revoked for a
      // request the transaction would refuse.
      const early = await precheckWipe(repo, { userId, actingAdminId: session.user.id, ownerId, confirmEmail, mayWipeSelf: false })
      if (early) return early
      // The limiter writes its row in the background; let this request's land before the
      // deletion purges keys naming the user.
      await settleRateLimitFlushes()
      ouraToken = await readOuraGrantBestEffort(repo, userId, req.nextUrl.pathname)
    }
    result = await repo.deleteAccount(userId, {
      onlyIfNoData: !confirmed,
      guard: { actingAdminId: session.user.id, ownerId, confirmEmail },
      audit: { job: 'admin-delete-account', actor: auditActor(session.user.id) },
    })
  } catch (err) {
    console.error('[admin/users] deletion failed', err)
    reportServerError(err, { userId: session.user.id, url: req.nextUrl.pathname })
    return NextResponse.json({ error: 'The account could not be deleted, and nothing was removed.' }, { status: 500 })
  }
  if (result.refused) return wipeRefusalResponse(result.refused)
  if (result.refusedHasData) {
    return NextResponse.json({ error: 'This account has data under it, so it cannot be deleted here. Deactivate it instead.' }, { status: 409 })
  }
  if (!result.deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  await revokeOuraGrantAfterCommit(ouraToken, userId, new URL(req.url).pathname)
  return NextResponse.json({ ok: true, removedRows: Object.values(result.removed ?? {}).reduce((a, b) => a + b, 0) })
}
