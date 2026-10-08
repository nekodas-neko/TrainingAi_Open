import { eq } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { FIELD_LABEL, FIELD_UNIT, type PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'
import { driftAgainst } from './types'
import { OWN_TARGET_GOAL_TYPE, ownTargetFromGoals } from '@trainingai/shared/nutrition/calorie-budget'
import { ownCalorieTargetReason } from '@trainingai/shared/validation/plausibility'

const TARGET_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const
// `calorieGoalType` is not a coach field: it is written as the flag that makes `calorieGoal` the user's
// OWN target (issue 2622), and restored by undo from the state `apply` captured.
const GOAL_FIELDS = ['stepsGoal', 'calorieGoal', 'calorieGoalType', 'waterGoalMl'] as const

function describe(c: PatchChange): string {
  const unit = FIELD_UNIT[c.field] ?? ''
  // A null `to` on the calorie goal clears the own target.
  if (c.field === 'calorieGoal' && c.to == null) {
    return `${FIELD_LABEL[c.field]} ${c.from != null ? `${Math.round(Number(c.from)).toLocaleString()}${unit}` : 'none'} → the worked-out budget`
  }
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
      calorieGoalType: s.users.calorieGoalType,
      waterGoalMl: s.users.waterGoalMl,
    })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1)
  if (!row) return {}
  // Issue 2622. The only calorie goal a patch can name is the user's OWN target; the retired typed
  // number is invisible here, so a `from` taken from `getGoalsAndInjuries` matches and a legacy value
  // never reads as an override. `calorieGoalType` rides along only for `apply` to capture for undo.
  return { ...row, calorieGoal: ownTargetFromGoals(row) }
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
      const own = patch.changes.find(c => c.field === 'calorieGoal')
      if (own) {
        consequences.push({
          kind: 'info',
          text: own.to == null
            ? 'Goes back to the worked-out calorie budget on every screen.'
            : 'This becomes your own calorie target: the budget on Nutrition, Home, meal plans and the coach, instead of the worked-out one.',
        })
      }
      if (calorie && calorie.to != null) {
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

      for (const c of accepted) {
        if (c.field === 'calorieGoal' && c.to != null) {
          const reason = ownCalorieTargetReason(Number(c.to))
          if (reason) return { ok: false, reason: 'invalid', detail: reason }
        }
      }

      const beforeState: Record<string, unknown> = {}
      for (const c of accepted) beforeState[c.field] = current[c.field] ?? null
      // Undo must put the flag back too, or restoring a number would turn a retired typed goal into
      // an override. Captured from the row, which `current` only carries for exactly this.
      if (accepted.some(c => c.field === 'calorieGoal')) beforeState.calorieGoalType = current.calorieGoalType ?? null

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
  // Issue 2622. Writing a calorie goal through Coach sets (or, with null, clears) the own target, the
  // same flag the Goals screen writes. An undo carries the previous flag explicitly and wins.
  if ('calorieGoal' in set && !('calorieGoalType' in set)) {
    set.calorieGoalType = set.calorieGoal == null ? null : OWN_TARGET_GOAL_TYPE
  }
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
  waterGoalMl: 'ta_water_goal_ml',
}
