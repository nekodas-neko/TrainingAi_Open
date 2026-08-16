import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  await repo.touchLastGoalReviewAt(userId)

  return NextResponse.json({ success: true })
}
