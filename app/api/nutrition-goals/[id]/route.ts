import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One status string.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = (read.body ?? {}) as { status?: string }
  if (body.status !== 'applied' && body.status !== 'dismissed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const repo = await getRepository()
  const existing = await repo.getGoalRecommendation(userId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await repo.updateGoalRecommendationStatus(userId, id, body.status)
  await repo.touchLastGoalReviewAt(userId)

  return NextResponse.json({ success: true })
}
