import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { goalBoundSchema } from '@trainingai/shared/validation/goal-bounds'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { goalToDailyKcal } from '@trainingai/shared/nutrition/calorie-balance'
import { OWN_TARGET_GOAL_TYPE } from '@trainingai/shared/nutrition/calorie-budget'
import { ownCalorieTargetReason } from '@trainingai/shared/validation/plausibility'
import type { UserGoals } from '@/lib/data/repository'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidBodyResponse } from '@/lib/api/route-errors'

// Nine numbers and enums. 8 KB is generous.
const MAX_BODY_BYTES = 8 * 1024

const GoalsSchema = z.object({
  stepsGoal:       goalBoundSchema('stepsGoal').optional().nullable(),
  stepsGoalType:   z.enum(['daily', 'weekly']).optional().nullable(),
  sleepGoalHours:  z.number().min(0).max(24).optional().nullable(),
  calorieGoal:     goalBoundSchema('calorieGoal').optional().nullable(),
  calorieGoalType: z.enum(['daily', 'weekly', 'own']).optional().nullable(),
  waterGoalMl:     goalBoundSchema('waterGoalMl').optional().nullable(),
  waterGoalType:   z.enum(['daily', 'weekly']).optional().nullable(),
  targetWeightKg:  z.number().min(20).max(500).optional().nullable(),
  targetBfPct:     z.number().min(0).max(70).optional().nullable(),
}).strict()

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const goals = await repo.getUserGoals(userId)
  return NextResponse.json(goals, { headers: { "Cache-Control": "private, no-store" } })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = GoalsSchema.safeParse(read.body)
  if (!parsed.success) {
    return invalidBodyResponse(parsed.error)
  }
  const body = parsed.data

  // `?? undefined` here used to collapse "clear this goal" into "leave it alone": a PATCH of
  // `{ targetWeightKg: null }` returned 200 and changed nothing, so a goal could be set forever but
  // never removed. `updateUserGoals` has always distinguished the two — it skips on `undefined` and
  // writes on `null` — so only this mapping was losing the difference. Zod omits absent optional
  // keys, which is what makes `in` the right test: present-and-null clears, absent is untouched.
  const patch: Partial<UserGoals> = {}
  for (const key of [
    'stepsGoal', 'stepsGoalType', 'sleepGoalHours', 'calorieGoal', 'calorieGoalType',
    'waterGoalMl', 'waterGoalType', 'targetWeightKg', 'targetBfPct',
  ] as const) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key]
  }

  const repo = await getRepository()

  // Issue 2622. `calorie_goal_type = 'own'` makes `calorie_goal` the user's own target, the budget on
  // every surface. The two travel together: a flag with no number, or a number outside what a person
  // could eat in a day, is refused rather than stored. Clearing is the pair of nulls.
  if (body.calorieGoalType === OWN_TARGET_GOAL_TYPE) {
    if (body.calorieGoal == null) {
      return NextResponse.json({ error: 'An own calorie target needs a number.' }, { status: 400 })
    }
    const reason = ownCalorieTargetReason(body.calorieGoal)
    if (reason) return NextResponse.json({ error: reason }, { status: 400 })
  } else if (body.calorieGoal != null && body.calorieGoalType === undefined) {
    // A bare number must not slip an out-of-range value under an existing own target.
    const current = await repo.getUserGoals(userId)
    if (current.calorieGoalType === OWN_TARGET_GOAL_TYPE) {
      const reason = ownCalorieTargetReason(body.calorieGoal)
      if (reason) return NextResponse.json({ error: reason }, { status: 400 })
    }
  }

  await repo.updateUserGoals(userId, patch)

  // `nutrition_targets.calories` is the single source of truth for the daily calorie target;
  // `users.calorie_goal` is a denormalised mirror that the Health tab and Home tiles read.
  // They drifted 200 kcal apart in production because the TDEE nudge card wrote only one of
  // them, so the Nutrition and Health tabs showed different targets. Mirror on every write —
  // converting, because this field may be a WEEKLY total while nutrition_targets is always daily.
  // An own target is NOT mirrored: `nutrition_targets.calories` feeds the saved macro split, and an own
  // target is the day's budget, which the macros are fitted to instead.
  if (body.calorieGoal != null && body.calorieGoalType !== OWN_TARGET_GOAL_TYPE) {
    const goalType = body.calorieGoalType ?? (await repo.getUserGoals(userId)).calorieGoalType
    await repo.upsertNutritionTargets(userId, { calories: goalToDailyKcal(body.calorieGoal, goalType) })
  }

  return NextResponse.json({ success: true })
}
