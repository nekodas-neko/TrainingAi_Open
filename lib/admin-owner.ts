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
 *
 * **The id must also name a real, active admin.** A well-formed uuid that names no user (a typo, or
 * a variable left over from another database) or a non-admin would otherwise be accepted, and the
 * rule would silently protect nobody. `resolveOwnerUserId` looks the user up; a missing or inactive
 * user, a non-admin, or a lookup that throws all count as unresolved. The audit views read the same
 * variables for a different job (`bootstrapClaudeRoOwner`), and the day-review export and the agent
 * key read `ADMIN_EXPORT_USER_ID ?? WEBHOOK_USER_ID` directly; neither uses this helper.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The configured id when it is a well-formed uuid; says nothing about whether the user exists. */
export function parseConfiguredOwnerId(env: NodeJS.ProcessEnv = process.env): string | null {
  const owner = resolveClaudeRoOwner(env)?.owner.trim().toLowerCase()
  return owner && UUID.test(owner) ? owner : null
}

/** The owner's id, only when it names an existing, active admin. Otherwise `null` (fail closed). */
export async function resolveOwnerUserId(
  repo: { getUserById(id: string): Promise<{ isAdmin?: boolean; isActive?: boolean } | null> },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const owner = parseConfiguredOwnerId(env)
  if (!owner) return null
  try {
    const user = await repo.getUserById(owner)
    return user && user.isAdmin === true && user.isActive === true ? owner : null
  } catch (err) {
    console.error('[admin-owner] owner lookup failed; treating the owner as unresolved', err)
    return null
  }
}

/** True only when the owner resolves and `userId` is them. */
export function isOwnerUserId(userId: string, ownerId: string | null): boolean {
  return ownerId !== null && sameUserId(userId, ownerId)
}

/** Ids are uuids, which Postgres treats case-insensitively, so compare them that way everywhere. */
export function sameUserId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
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
