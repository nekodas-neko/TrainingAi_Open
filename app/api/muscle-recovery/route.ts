import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { computeMuscleRecovery } from '@trainingai/shared/ai-periodization/muscle-recovery'
import { getExerciseMuscleMap } from '@/lib/data/exercise-muscle-map-cache'

export interface MuscleRecoveryEntry {
  muscle: string
  pct: number
  hoursAgo: number
}

export interface MuscleRecoveryResponse {
  muscles: MuscleRecoveryEntry[]
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [sessions, library] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from7d),
    getExerciseMuscleMap(),
  ])

  const muscles = computeMuscleRecovery(sessions, library)
  muscles.sort((a, b) => a.pct - b.pct || a.muscle.localeCompare(b.muscle))

  return NextResponse.json({ muscles } satisfies MuscleRecoveryResponse, { headers: { "Cache-Control": "private, no-store" } })
}
