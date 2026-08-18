import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepository()
  const exerciseNames = await repo.listLoggedExerciseNames(session.user.id)
  return NextResponse.json({ exerciseNames })
}

const BodySchema = z.object({
  exerciseNames: z.array(z.string().min(1)).min(1),
  beforeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apply: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { exerciseNames, beforeDate, apply } = parsed.data
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const result = apply
    ? await repo.applyLbsToKgFix(session.user.id, exerciseNames, beforeDate, tz)
    : await repo.previewLbsToKgFix(session.user.id, exerciseNames, beforeDate, tz)

  return NextResponse.json(result)
}
