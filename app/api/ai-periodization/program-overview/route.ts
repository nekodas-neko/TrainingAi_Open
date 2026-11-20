import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, toAestDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { servePrescriptionState } from '@trainingai/shared/ai-periodization/prescription-expiry'
import { programDeloadCheckOf, syncProgramPhase } from '@trainingai/shared/ai-periodization/program-phase'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ sessions: [] }, { headers: { 'Cache-Control': 'private, no-store' } })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  // Self-heal the per-session phase counts from the real workout history before reading
  // them, so directly-inserted/deleted test sessions can't leave a stale "N sessions". #3766: the
  // same step runs the switch-over to one program phase when it is due, so the list shows it.
  const programDeload = programDeloadCheckOf(await syncProgramPhase(repo, userId, program.id, tz))
  const states = await repo.listSessionPeriodizationForProgram(userId, program.id)

  const today = todayInTz(tz)
  const recentBySession = await Promise.all(
    program.sessions.map(ps => repo.getRecentSessionsOfType(userId, ps.id, 3)),
  )

  const sessions = program.sessions.map((ps, i) => {
    const stored = states.find(s => s.programSessionId === ps.id) ?? null
    // #3716: an aged-out prescription is not the session's plan, here as on every other read. Nor is
    // one whose deload has ended (#3876).
    const state = stored && servePrescriptionState(stored, new Date(), programDeload)
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
