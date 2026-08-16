import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, toAestDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ sessions: [] }, { headers: { 'Cache-Control': 'private, no-store' } })

  // Self-heal the per-session phase counts from the real workout history before reading
  // them, so directly-inserted/deleted test sessions can't leave a stale "N sessions".
  await repo.reconcileSessionsInPhase(userId, program.id)
  const states = await repo.listSessionPeriodizationForProgram(userId, program.id)

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const recentBySession = await Promise.all(
    program.sessions.map(ps => repo.getRecentSessionsOfType(userId, ps.id, 3)),
  )

  const sessions = program.sessions.map((ps, i) => {
    const state = states.find(s => s.programSessionId === ps.id) ?? null
    const lastCompleted = recentBySession[i].find(s => s.completedAt != null)
    const lastTrainedDaysAgo = lastCompleted?.completedAt != null
      ? daysBetweenDateStrs(toAestDateStr(lastCompleted.completedAt, tz), today)
      : null
    return {
      sessionId: ps.id,
      sessionName: ps.name,
      icon: ps.icon ?? null,
      state,
      lastTrainedDaysAgo,
    }
  })

  return NextResponse.json({ programId: program.id, programName: program.name, sessions }, { headers: { 'Cache-Control': 'private, no-store' } })
}
