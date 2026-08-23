import { eq } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { FIELD_LABEL, FIELD_UNIT, type PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'
import { driftAgainst } from './types'

const TARGET_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const
const GOAL_FIELDS = ['stepsGoal', 'calorieGoal', 'waterGoalMl'] as const

function describe(c: PatchChange): string {
  const unit = FIELD_UNIT[c.field] ?? ''
  return `${FIELD_LABEL[c.field]} ${Math.round(Number(c.from ?? 0)).toLocaleString()}${unit} → ${Math.round(Number(c.to)).toLocaleString()}${unit}`
}

/** Both goal domains are singletons the user already owns, so there is no id to verify — the row
 *  IS the caller. That makes ownership trivial and staleness the only real check. */
async function currentTargets(db: Db, userId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({
      calories: s.nutritionTargets.calories,
      proteinG: s.nutritionTargets.proteinG,
      carbsG: s.nutritionTargets.carbsG,
      fatG: s.nutritionTargets.fatG,
    })
    .from(s.nutritionTargets)
    .where(eq(s.nutritionTargets.userId, userId))
    .limit(1)
  return (row as Record<string, unknown>) ?? {}
}

async function currentGoals(db: Db, userId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({
      stepsGoal: s.users.stepsGoal,
      calorieGoal: s.users.calorieGoal,
      waterGoalMl: s.users.waterGoalMl,
    })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1)
  return (row as Record<string, unknown>) ?? {}
}

function makeHandler(
  kind: 'nutrition_targets' | 'user_goals',
  read: (db: Db, userId: string) => Promise<Record<string, unknown>>,
): DomainHandler {
  return {
    async currentState(db, userId) {
      return read(db, userId)
    },

    async preview(db, userId, patch): Promise<PreviewResult> {
      const current = await read(db, userId)
      const drift = driftAgainst(patch.changes, current)

      const consequences: Consequence[] = []
      const calorie = patch.changes.find(c => c.field === 'calories' || c.field === 'calorieGoal')
      if (calorie) {
        const delta = Number(calorie.to) - Number(calorie.from ?? 0)
        if (calorie.from != null && Math.abs(delta) >= 500) {
          // A jump this size is usually a misheard number rather than an intention. Say so rather
          // than applying it quietly — the user can still accept it.
          consequences.push({
            kind: 'warn',
            text: `That's a ${delta > 0 ? 'jump' : 'drop'} of ${Math.abs(Math.round(delta)).toLocaleString()} kcal — larger than a typical adjustment`,
          })
        }
      }
      consequences.push({ kind: 'good', text: 'Applies from today. Nothing you have already logged changes.' })

      return { consequences, drift, target: { id: null, label: kind === 'user_goals' ? 'your goals' : 'your macro targets' } }
    },

    async apply(db, userId, patch, accepted) {
      const current = await read(db, userId)
      const drift = driftAgainst(accepted, current)
      if (drift.length > 0) return { ok: false, reason: 'stale', drift }

      const beforeState: Record<string, unknown> = {}
      for (const c of accepted) beforeState[c.field] = current[c.field] ?? null

      await write(db, userId, accepted, kind)

      return {
        ok: true,
        summary: accepted.map(describe).join(', '),
        beforeState,
        // No row id: these are singletons. The undo path re-resolves by user, so a placeholder
        // would be a lie rather than a convenience.
        targetId: userId,
      }
    },

    async undo(db, userId, _targetId, before) {
      const restore = Object.entries(before)
        .filter(([, v]) => v !== undefined)
        .map(([field, value]) => ({ id: field, field, from: null, to: value } as unknown as PatchChange))
      if (restore.length === 0) return { ok: true }
      await write(db, userId, restore, kind)
      return { ok: true }
    },
  }
}

async function write(db: Db, userId: string, changes: PatchChange[], kind: 'nutrition_targets' | 'user_goals') {
  if (kind === 'nutrition_targets') {
    const values: Record<string, unknown> = { userId }
    for (const c of changes) if ((TARGET_FIELDS as readonly string[]).includes(c.field)) values[c.field] = c.to
    await db
      .insert(s.nutritionTargets)
      .values(values as typeof s.nutritionTargets.$inferInsert)
      .onConflictDoUpdate({
        target: s.nutritionTargets.userId,
        set: { ...values, updatedAt: new Date() },
        // The conflict arm is an UPDATE — scope it, same as any other write.
        setWhere: eq(s.nutritionTargets.userId, userId),
      })
    return
  }

  const set: Record<string, unknown> = {}
  for (const c of changes) if ((GOAL_FIELDS as readonly string[]).includes(c.field)) set[c.field] = c.to
  if (Object.keys(set).length > 0) {
    await db.update(s.users).set(set).where(eq(s.users.id, userId))
  }
}

export const nutritionTargetsHandler = makeHandler('nutrition_targets', currentTargets)
export const userGoalsHandler = makeHandler('user_goals', currentGoals)

/**
 * The goal fields Home and Profile read from **localStorage**, not the database.
 *
 * `goal-recommendation-sheet.tsx` writes these through on every apply because the home widgets and
 * the Profile Goals section read the local copy; without the same write-through, a goal Coach
 * changed would not appear until a reload. Exported so both surfaces share one list rather than
 * growing a second, drifting copy.
 */
export const GOAL_LOCAL_STORAGE_KEYS: Record<string, string> = {
  stepsGoal: 'ta_steps_goal',
  calorieGoal: 'ta_calorie_goal_kcal',
  waterGoalMl: 'ta_water_goal_ml',
}
