import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, toAestDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { servePrescriptionState, holdPrescriptionUnderWay } from '@trainingai/shared/ai-periodization/prescription-expiry'
import { sessionUnderWayCheck } from '@trainingai/shared/ai-periodization/session-under-way'
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

  // #3900 third review (1): a plan held because its workout is under way is listed as the plan.
  // One read, and only when some plan here would otherwise be hidden.
  const now = new Date()
  const wouldHide = program.phaseMode === 'ai_dynamic'
    && states.some(st => servePrescriptionState(st, now, programDeload).prescriptionAgedOut === true)
  const underWayFor = wouldHide ? await sessionUnderWayCheck(repo, userId, now) : () => false

  const sessions = program.sessions.map((ps, i) => {
    const stored = states.find(s => s.programSessionId === ps.id) ?? null
    // #3716: an aged-out prescription is not the session's plan, here as on every other read. Nor is
    // one whose deload has ended (#3876).
    const servedState = stored && servePrescriptionState(stored, now, programDeload)
    const state = stored && servedState && servedState.prescriptionAgedOut === true && underWayFor(ps.id)
      ? holdPrescriptionUnderWay(stored, now)
      : servedState
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
