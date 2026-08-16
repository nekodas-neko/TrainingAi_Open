import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, startOfWeekInTz, toAestDay } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const { searchParams } = req.nextUrl
  let programId = searchParams.get('programId') ?? null

  if (programId) {
    const owned = await repo.listPrograms(userId)
    if (!owned.some(p => p.id === programId)) {
      return NextResponse.json({ error: 'Program not found' }, { status: 404 })
    }
  } else {
    const program = await repo.getActiveProgram(userId)
    if (!program) return NextResponse.json({ error: 'No active program' }, { status: 404 })
    programId = program.id
  }

  // Both sides keyed canonically — getWeeklySetsByMuscleGroup normalizes, and a target row edited
  // by hand can still carry a synonym even though computeDefaultVolumeTargets writes canonical.
  const volumeTargets = await repo.listVolumeTargets(userId, programId)
  const targets: Record<string, number> = {}
  for (const vt of volumeTargets) {
    const key = normalizeMuscle(vt.muscleGroup)
    targets[key] = (targets[key] ?? 0) + vt.targetSetsPerWeek
  }

  const weekStart = startOfWeekInTz(tz)
  const weekEndDate = new Date(weekStart + 'T00:00:00Z')
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
  const weekEnd = toAestDay(weekEndDate, tz)

  const logged = await repo.getWeeklySetsByMuscleGroup(userId, programId, weekStart, weekEnd, tz)

  return NextResponse.json({ targets, logged }, { headers: { 'Cache-Control': 'private, no-store' } })
}
