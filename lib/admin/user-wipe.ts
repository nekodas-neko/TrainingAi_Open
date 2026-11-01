import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AdminWipeRefusal } from '@/lib/data/postgres/slices/account-deletion'
import { judgeProtectedTarget, sameUserId } from '@/lib/admin-owner'
import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * #3369 — what the admin's two destructive user actions share: the request body, the refusals, and
 * the audit identity. The rules themselves (never another admin, the typed email) are enforced in
 * the repository's transaction after the row lock; this only turns their answer into a response.
 */

/** A user id and the target's email. 4 KB is generous for both. */
export const WIPE_MAX_BODY_BYTES = 4 * 1024

/** An email address is at most 254 characters; anything longer is not one. */
const EMAIL_MAX = 320

/** `.strict()`: a body that names anything else is refused, not ignored. */
export const ResetBodySchema = z.object({
  userId: z.string().min(1),
  confirmEmail: z.string().min(1).max(EMAIL_MAX),
}).strict()

/** The delete body: `confirmEmail` is what turns "delete a signup with no data" into "delete this account". */
export const DeleteBodySchema = z.object({
  userId: z.string().min(1),
  confirmEmail: z.string().min(1).max(EMAIL_MAX).optional(),
}).strict()

/** One bucket for both actions per acting admin. Generous for a typo, tight enough never to be a loop. */
export const WIPE_RATE = { limit: 10, windowMs: 60 * 60 * 1000 } as const
export const wipeRateKey = (adminId: string) => `admin-user-wipe:${adminId}`

export const auditActor = (adminId: string) => `admin:${adminId}`

export function wipeRefusalResponse(refused: AdminWipeRefusal): NextResponse {
  switch (refused) {
    case 'admin-target':
      return NextResponse.json({ error: "Another admin's account cannot be reset or deleted." }, { status: 403 })
    case 'email-mismatch':
      return NextResponse.json({ error: 'That email does not match this account. Nothing was changed.' }, { status: 400 })
    case 'self':
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })
    case 'owner-protected':
      return NextResponse.json({ error: "Only the owner can reset or delete the owner's account." }, { status: 403 })
    case 'owner-unresolved':
      return NextResponse.json({ error: 'The owner account is not configured, so no admin account can be reset or deleted.' }, { status: 403 })
    case 'actor-not-admin':
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

/**
 * Judge the target before anything outside the database transaction is touched. The Oura grant is
 * revoked at Oura and cannot be put back, so it must not be revoked for a request the transaction is
 * about to refuse. This is the same rule the transaction applies after its row lock, read one step
 * early; the transaction stays the authority, and a race between the two only costs an
 * already-refused request its Oura grant, never a row.
 *
 * Returns the refusal to send, or `null` to go ahead. A missing user is `null` too: the transaction
 * answers 404.
 */
export async function precheckWipe(
  repo: Pick<WorkoutRepository, 'getUserById'>,
  target: { userId: string; actingAdminId: string; ownerId: string | null; confirmEmail?: string; mayWipeSelf: boolean },
): Promise<NextResponse | null> {
  const user = await repo.getUserById(target.userId)
  if (!user) return null
  const protectedTarget = judgeProtectedTarget(target.actingAdminId, target.userId, user.isAdmin === true, target.ownerId)
  if (protectedTarget) return wipeRefusalResponse(protectedTarget)
  if (user.isAdmin && !sameUserId(target.userId, target.actingAdminId)) return wipeRefusalResponse('admin-target')
  if (sameUserId(target.userId, target.actingAdminId) && !target.mayWipeSelf) return wipeRefusalResponse('self')
  if (target.confirmEmail !== undefined && target.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return wipeRefusalResponse('email-mismatch')
  }
  return null
}
