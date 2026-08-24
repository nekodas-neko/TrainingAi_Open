import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { dailyKcalToGoal } from '@trainingai/shared/nutrition/calorie-balance'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Four macro numbers and a calorie total.
const MAX_BODY_BYTES = 8 * 1024

const TargetsSchema = z.object({
  calories: z.number().min(0).max(20000).optional().nullable(),
  proteinG: z.number().min(0).max(2000).optional().nullable(),
  carbsG:   z.number().min(0).max(2000).optional().nullable(),
  fatG:     z.number().min(0).max(2000).optional().nullable(),
  fiberG:   z.number().min(0).max(500).optional().nullable(),
}).strict()

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  const targets = await repo.getNutritionTargets(userId)
  return NextResponse.json(targets ?? {}, { headers: { "Cache-Control": "private, no-store" } })
}

export async function PUT(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = TargetsSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const repo = await getRepository()
  const targets = await repo.upsertNutritionTargets(userId, {
    calories: parsed.data.calories ?? undefined,
    proteinG: parsed.data.proteinG ?? undefined,
    carbsG:   parsed.data.carbsG   ?? undefined,
    fatG:     parsed.data.fatG     ?? undefined,
    fiberG:   parsed.data.fiberG   ?? undefined,
  })
  // Mirror into the denormalised `users.calorie_goal` the Health tab and Home tiles read — see
  // the matching note in /api/user/goals. Without this the two surfaces drift apart silently.
  // Converted back to the user's chosen daily/weekly unit so mirroring never flips their
  // display preference, and never writes a daily number into a weekly-typed field.
  if (parsed.data.calories != null) {
    const { calorieGoalType } = await repo.getUserGoals(userId)
    await repo.updateUserGoals(userId, { calorieGoal: dailyKcalToGoal(parsed.data.calories, calorieGoalType) })
  }
  return NextResponse.json(targets)
}
