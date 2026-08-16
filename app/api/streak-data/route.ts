import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

const WINDOW_DAYS = 90

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trainedDays = await (await getRepository()).getRecentTrainedDays(userId, WINDOW_DAYS, session.user?.timezone)
  return NextResponse.json(
    { trainedDays },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
