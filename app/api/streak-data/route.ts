import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { STREAK_LOOKBACK_DAYS } from '@trainingai/shared/workout/streak-window'

// BF-176. Was a local 90 while the consuming loop walked back 365, so every day past the window
// read as a rest day and the streak was pinned to the window edge rather than to training. The
// number is shared now because the two files have to agree and nothing made them.
const WINDOW_DAYS = STREAK_LOOKBACK_DAYS

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
