import { NextResponse } from 'next/server'
import { withRouteErrors, routeErrorResponse, invalidUuidResponse } from '@/lib/api/route-errors'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One meal type's editable fields.
const MAX_BODY_BYTES = 8 * 1024

// Mirrors MealType's client-editable fields (components/nutrition/meal-type-manager.tsx's
// edit form sends name/emoji/timeStartHour/timeEndHour/remindersEnabled/required).
const MealTypePutSchema = z.object({
  name:             z.string().min(1).max(100).optional(),
  emoji:            z.string().max(16).optional(),
  sortOrder:        z.number().int().min(0).max(10_000).optional(),
  timeStartHour:    z.number().int().min(0).max(24).optional(),
  timeEndHour:      z.number().int().min(0).max(24).optional(),
  remindersEnabled: z.boolean().optional(),
  required:         z.boolean().optional(),
}).strict()

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = MealTypePutSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  // Q-463: an id that is not yours (or does not exist) answered 500 with an empty body.
  return withRouteErrors(async () => {
    const mealType = await repo.updateMealType(id, userId, parsed.data)
    return NextResponse.json(mealType)
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  try {
    await repo.deleteMealType(id, userId)
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof Error && e.message === 'MEAL_TYPE_HAS_LOGS') {
      return NextResponse.json({ error: 'Meal type has food log entries — reassign them first' }, { status: 409 })
    }
    // Q-463: everything else used to rethrow into Next's default handler, which answers 500.
    return routeErrorResponse(e)
  }
}
