import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { computeAchievements } from '@/lib/achievements'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await computeAchievements(session.user.id, session.user?.timezone ?? DEFAULT_TZ)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
