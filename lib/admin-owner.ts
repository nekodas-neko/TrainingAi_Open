import { resolveClaudeRoOwner } from '@/lib/data/postgres/claude-ro-owner'

/**
 * #3368 / #3369 — who the owner is, for the one rule that protects them: only the owner removes
 * admin from anyone, and nobody but the owner deactivates, resets or deletes the owner's account.
 *
 * **One source, not a new variable.** `resolveClaudeRoOwner()` is already how the app names its
 * owner (`CLAUDE_RO_OWNER_USER_ID`, else `ADMIN_EXPORT_USER_ID`, else `WEBHOOK_USER_ID`; see
 * `docs/environment-variables.md`). The day-review export, the agent key and the audit views all
 * resolve through it, and the agent key's variable must already name an admin. Reading it here
 * means the owner is defined once and cannot drift from the account the audit views are scoped to.
 *
 * **Fails closed.** An unset or malformed value returns `null`, and every caller treats `null` as
 * "nobody is the owner, so nobody may do an owner-only thing": no one can revoke admin, and no
 * admin account can be deactivated, reset or deleted.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveOwnerUserId(env: NodeJS.ProcessEnv = process.env): string | null {
  const owner = resolveClaudeRoOwner(env)?.owner.trim().toLowerCase()
  return owner && UUID.test(owner) ? owner : null
}

/** True only when the owner resolves and `userId` is them. */
export function isOwnerUserId(userId: string, ownerId: string | null): boolean {
  return ownerId !== null && userId.trim().toLowerCase() === ownerId
}

/** Why an admin action on an admin account was refused. */
export type OwnerRefusal = 'owner-only' | 'owner-protected' | 'owner-unresolved'

/**
 * Removing admin: the owner only. `ownerId` null means the owner cannot be resolved, so it is refused.
 * The caller handles "yourself" first (nobody removes their own admin, the owner included).
 */
export function judgeRevokeAdmin(actingId: string, ownerId: string | null): OwnerRefusal | null {
  if (ownerId === null) return 'owner-unresolved'
  return isOwnerUserId(actingId, ownerId) ? null : 'owner-only'
}

/**
 * Deactivating, resetting or deleting an account that is an admin, or is the owner. The owner's
 * account is theirs alone; with no resolvable owner every admin account is off limits.
 */
export function judgeProtectedTarget(
  actingId: string, targetId: string, targetIsAdmin: boolean, ownerId: string | null,
): OwnerRefusal | null {
  if (ownerId === null) return targetIsAdmin ? 'owner-unresolved' : null
  if (isOwnerUserId(targetId, ownerId) && !isOwnerUserId(actingId, ownerId)) return 'owner-protected'
  return null
}
