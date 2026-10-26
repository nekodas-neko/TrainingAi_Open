import { sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { judgeRevokeAdmin, type OwnerRefusal } from '@/lib/admin-owner'

type Db = ReturnType<typeof getDb>

export type SetAdminOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'inactive-target' | 'actor-not-admin' | OwnerRefusal }

/**
 * #3368 — Make admin / Remove admin. One transaction does everything that decides the outcome:
 *
 * - **Both rows are locked in id order**, the acting admin's and the target's. Ordered, so two
 *   admins acting on each other cannot deadlock; locked, so a wipe or a demotion running at the
 *   same moment waits for this outcome instead of interleaving with it.
 * - **The acting admin is re-checked on the locked row** (still active, still admin). A request
 *   that passed `requireAdmin` a moment ago is not trusted.
 * - **Only the owner removes admin** (`judgeRevokeAdmin`), judged here and not only in the route.
 *   `ownerId` is passed in by the caller so tests can pin it; null refuses every removal.
 * - **A grant needs an active target.** A deactivated or pending account is not made an admin.
 * - **The audit row is written in the same transaction** (`agent_action_log`, the shape the admin
 *   wipes use), so a change that cannot be recorded does not happen. No email is recorded.
 *
 * The update is `.set({ is_admin })` from a boolean the route derived from a fixed enum; nothing
 * from the request body reaches it. The affected-row count is checked.
 */
export async function setUserAdmin(
  db: Db,
  args: { actingAdminId: string; targetUserId: string; makeAdmin: boolean; ownerId: string | null },
): Promise<SetAdminOutcome> {
  const { actingAdminId, targetUserId, makeAdmin, ownerId } = args
  return db.transaction(async tx => {
    const { rows } = await tx.execute<{ id: string; is_admin: boolean; is_active: boolean }>(sql`
      SELECT id, is_admin, is_active FROM users
      WHERE id IN (${actingAdminId}::uuid, ${targetUserId}::uuid)
      ORDER BY id FOR UPDATE`)
    const actor = rows.find(r => r.id === actingAdminId)
    const target = rows.find(r => r.id === targetUserId)
    if (!actor || !actor.is_admin || !actor.is_active) return { ok: false, reason: 'actor-not-admin' } as const
    if (!target) return { ok: false, reason: 'not-found' } as const

    if (!makeAdmin) {
      const refused = judgeRevokeAdmin(actingAdminId, ownerId)
      if (refused) return { ok: false, reason: refused } as const
    } else if (!target.is_active) {
      return { ok: false, reason: 'inactive-target' } as const
    }

    const changed = await tx.execute(sql`
      UPDATE users SET is_admin = ${makeAdmin} WHERE id = ${targetUserId} RETURNING id`)
    if ((changed.rowCount ?? changed.rows.length) !== 1) throw new Error('set admin: expected to update 1 users row')

    await tx.execute(sql`
      INSERT INTO agent_action_log (job, parameters, actor, target_user_id, finished_at, outcome, affected_rows)
      VALUES (${makeAdmin ? 'admin-grant-admin' : 'admin-revoke-admin'},
              ${JSON.stringify({ targetUserId, wasAdmin: target.is_admin })}::jsonb,
              ${`admin:${actingAdminId}`}, ${targetUserId}, now(), 'succeeded', 1)`)
    return { ok: true } as const
  })
}
