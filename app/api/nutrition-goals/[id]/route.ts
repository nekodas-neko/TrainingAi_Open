import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
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
