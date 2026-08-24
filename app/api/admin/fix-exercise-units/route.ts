import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A list of exercise names and a date.
const MAX_BODY_BYTES = 32 * 1024

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
}).strict()

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(read.body)
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
