import { UserFacingError, isUserFacingError } from '@trainingai/shared/errors'
import { resolveClaudeRoOwner } from '@/lib/data/postgres/claude-ro-owner'

/**
 * #3368 / #3369 — who the owner is, for the one rule that protects them: only the owner removes
 * admin from anyone, and nobody but the owner deactivates, resets or deletes the owner's account.
 *
 * **One source, not a new variable.** `resolveClaudeRoOwner()` is already how the audit views name
 * the owner (`CLAUDE_RO_OWNER_USER_ID`, else `ADMIN_EXPORT_USER_ID`, else `WEBHOOK_USER_ID`; see
 * `docs/environment-variables.md`). Reading it here means the owner is defined once and cannot
 * drift from the account the audit views are scoped to.
 *
 * **Fails closed.** An unset or malformed value returns `null`, and every caller treats `null` as
 * "nobody is the owner, so nobody may do an owner-only thing": no one can revoke admin, and no
 * admin account can be deactivated, reset or deleted.
 *
 * **The id must also name a real, active admin.** A well-formed uuid that names no user (a typo, or
 * a variable left over from another database) or a non-admin would otherwise be accepted, and the
 * rule would silently protect nobody. `resolveOwnerUserId` looks the user up; a missing or inactive
 * user or a non-admin counts as unresolved. A lookup that throws is not "unresolved": it throws
 * `OwnerLookupUnavailableError` (503), so a database fault never reads as "you are not the owner".
 * The audit views read the same variables for a different job, and the day-review export and the agent key read
 * `ADMIN_EXPORT_USER_ID ?? WEBHOOK_USER_ID` directly; neither uses this helper.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The configured id when it is a well-formed uuid; says nothing about whether the user exists. */
export function parseConfiguredOwnerId(env: NodeJS.ProcessEnv = process.env): string | null {
  const owner = resolveClaudeRoOwner(env)?.owner.trim().toLowerCase()
  return owner && UUID.test(owner) ? owner : null
}

/**
 * #3957 review: the owner lookup itself failed (a database fault). Distinct from "no owner
 * resolved" (`null`): during an outage the owner's admin tools must answer 503 "try again", not 403
 * "only the owner can see this". Still fail closed: a thrown error lets no owner-only action run.
 * A `UserFacingError` with status 503, like `AuthCheckUnavailableError`, so the shared route mappers
 * answer it as a JSON 503.
 */
export class OwnerLookupUnavailableError extends UserFacingError {
  constructor() {
    super('Service unavailable', 503)
    this.name = 'OwnerLookupUnavailableError'
  }
}

export function isOwnerLookupUnavailable(err: unknown): boolean {
  return err instanceof OwnerLookupUnavailableError || (isUserFacingError(err) && err.name === 'OwnerLookupUnavailableError')
}

/**
 * The owner's id, only when it names an existing, active admin. Otherwise `null` (fail closed).
 * Throws `OwnerLookupUnavailableError` when the lookup itself throws.
 */
export async function resolveOwnerUserId(
  repo: { getUserById(id: string): Promise<{ isAdmin?: boolean; isActive?: boolean } | null> },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const owner = parseConfiguredOwnerId(env)
  // Silent on purpose: this runs on every PATCH, owner-only or not, and the call that refuses
  // because of it logs the refusal itself, once. Only a failing lookup is worth a line here.
  if (!owner) return null
  try {
    const user = await repo.getUserById(owner)
    return user && user.isAdmin === true && user.isActive === true ? owner : null
  } catch (err) {
    console.error('[admin-owner] owner lookup failed; refusing as unavailable (503)', err)
    throw new OwnerLookupUnavailableError()
  }
}

/**
 * `resolveOwnerUserId` for a route that answers JSON: a thrown lookup becomes a 503 refusal the
 * route returns before anything is judged or written. `ownerId` null (no owner resolved) is
 * passed through for the caller's own owner-unresolved refusal (403, as designed in #3368).
 */
export async function resolveOwnerForRoute(
  repo: Parameters<typeof resolveOwnerUserId>[0],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; ownerId: string | null } | { ok: false; status: 503; error: string }> {
  try {
    return { ok: true, ownerId: await resolveOwnerUserId(repo, env) }
  } catch (err) {
    if (isOwnerLookupUnavailable(err)) return { ok: false, status: 503, error: 'Service unavailable' }
    throw err
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

/**
 * What the admin is told. A refusal because the owner setting is broken is not "you are not the
 * owner": the person reading it cannot fix it by being someone else, and needs to know to look at
 * the setting.
 */
export function ownerRefusalMessage(refused: OwnerRefusal, action: 'make admin' | 'remove admin' | 'deactivate this account'): string {
  if (refused === 'owner-unresolved') {
    return action === 'deactivate this account'
      ? 'The owner account is not configured, so no admin account can be deactivated.'
      : `The owner account is not configured, so no one can ${action}.`
  }
  return `Only the owner can ${action}`
}

/** Why an admin action on an admin account was refused. */
export type OwnerRefusal = 'owner-only' | 'owner-protected' | 'owner-unresolved'

/**
 * Granting or removing admin: the owner only (#3657 added granting). `ownerId` null means the owner
 * cannot be resolved, so it is refused. The caller handles "yourself" first for a removal (nobody
 * removes their own admin, the owner included).
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
  env: NodeJS.ProcessEnv = process.env,
): Exclude<OwnerRefusal, 'owner-only'> | null {
  // The account the settings name stays protected even when it no longer qualifies as the owner
  // (its admin flag was stripped, or it was deactivated): *authority* needs a verified owner, but
  // *protection* must not lapse the moment the owner is demoted, or demote-then-wipe works.
  const configured = parseConfiguredOwnerId(env)
  if (configured && isOwnerUserId(targetId, configured) && !isOwnerUserId(actingId, ownerId)) return 'owner-protected'
  if (ownerId === null) return targetIsAdmin ? 'owner-unresolved' : null
  if (isOwnerUserId(targetId, ownerId) && !isOwnerUserId(actingId, ownerId)) return 'owner-protected'
  return null
}
