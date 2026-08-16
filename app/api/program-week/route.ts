import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { PostgresWorkoutRepository } from '@/lib/data/postgres/adapter'
import { getCurrentPhase } from '@trainingai/shared/phase-engine'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const cacheHeaders = { headers: { "Cache-Control": "private, no-store" } }

  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ mode: null, programName: null }, cacheHeaders)

  if (program.phaseMode === 'automatic' && program.sessionsPerCycle && program.sessionsPerCycle >= 1) {
    const phases = await repo.listProgramPhases(userId, program.id)
    if (phases.length > 0) {
      const sessionsCount = await repo.countSessionsSinceStart(userId, program.id)
      const result = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
      const cycleCurrent = Math.min(result.completedCycles + 1, result.totalProgramCycles)
      return NextResponse.json({
        mode: 'cycle',
        cycleCurrent,
        cycleTotal: result.totalProgramCycles,
        phaseName: result.phase.name,
        blockComplete: result.blockComplete,
        programName: program.name,
      }, cacheHeaders)
    }
  }

  const sessionIds = program.sessions.map(s => s.id)
  const firstDate = await (repo as PostgresWorkoutRepository)
    .getFirstWorkoutDateForProgram(userId, sessionIds)

  if (!firstDate) return NextResponse.json({ mode: null, programName: program.name }, cacheHeaders)

  const weeksRunning = Math.floor((Date.now() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return NextResponse.json({ mode: 'tenure', weeksRunning, programName: program.name }, cacheHeaders)
}
