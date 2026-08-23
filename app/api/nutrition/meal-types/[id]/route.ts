import { NextResponse } from 'next/server'
import { withRouteErrors, invalidUuidResponse } from '@/lib/api/route-errors'
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

/**
 * Delete a meal type, optionally moving its logs somewhere first.
 *
 * `?reassignTo=<uuid>` performs the move and the delete in one transaction. Without it the old
 * behaviour stands, except that the refusal now **names the number of entries in the way** — the
 * message used to say "reassign them first" while naming an action the app had never implemented,
 * so the only escape a user could find was deleting every food log against that meal type (Q-412).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const reassignTo = new URL(req.url).searchParams.get('reassignTo')
  if (reassignTo !== null) {
    const badTarget = invalidUuidResponse(reassignTo)
    if (badTarget) return badTarget
  }

  const repo = await getRepository()
  return withRouteErrors(async () => {
    if (reassignTo) {
      const { moved } = await repo.reassignAndDeleteMealType(userId, id, reassignTo)
      return NextResponse.json({ success: true, moved })
    }
    try {
      await repo.deleteMealType(id, userId)
    } catch (e) {
      if (e instanceof Error && e.message === 'MEAL_TYPE_HAS_LOGS') {
        const logCount = (e as { logCount?: number }).logCount ?? 0
        return NextResponse.json({
          error: `This meal type has ${logCount} ${logCount === 1 ? 'entry' : 'entries'}. Move them to another meal type, or delete them.`,
          code: 'MEAL_TYPE_HAS_LOGS',
          logCount,
        }, { status: 409 })
      }
      throw e
    }
    return NextResponse.json({ success: true })
  })
}
