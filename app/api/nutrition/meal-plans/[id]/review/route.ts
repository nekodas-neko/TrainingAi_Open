import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

/**
 * Record that the user has looked at the ~4-week check-in for this plan.
 *
 * There is no cron layer in this app, so the review is surfaced by an on-open card that compares
 * `last_reviewed_at` (falling back to `generated_at`) against now. This route is what stops the
 * card asking again — it does not itself decide whether a change is needed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const repo = await getRepository()
  const ok = await repo.markMealPlanReviewed(id, userId)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
