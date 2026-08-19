import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { buildCardExerciseSignals } from '@trainingai/shared/ai-periodization/signals'
import { normalizeStoredPrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import type { Baseline1rmEntry } from '@trainingai/shared/types/ai-periodization'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sessionId } = await params
  const badId = invalidUuidResponse(sessionId)
  if (badId) return badId
  const repo = await getRepository()

  // Verify the session belongs to the user's active program before inserting
  const program = await repo.getActiveProgram(userId)
  const validSession = program?.sessions.find(s => s.id === sessionId)
  if (!validSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let state = await repo.ensureSessionPeriodization(userId, sessionId)
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Auto-heal stale baseline: if DB says baseline is incomplete but exercises already have
  // prior logs, the completion endpoint was never reached (app crash / navigation away).
  // Reconstruct baseline1rm from existing PRs and advance to accumulation.
  if (state.phase === 'baseline' && !state.baselineComplete) {
    const exerciseNames = validSession.exercises.map(e => e.exerciseName)
    // Program-scoped: a shared exercise name logged under a *different* program mustn't
    // let this fresh ai_dynamic cycle skip its own AMRAP baseline week.
    const [lastLogs, allPrs] = await Promise.all([
      repo.getLastExerciseLogsBatch(userId, exerciseNames, program!.id),
      repo.listPersonalRecords(userId),
    ])
    if (exerciseNames.some(name => lastLogs.has(name))) {
      const baseline1rm: Record<string, Baseline1rmEntry> = {}
      for (const ex of validSession.exercises) {
        const pr = allPrs.get(ex.exerciseName)
        if (pr != null) {
          baseline1rm[ex.id] = { kg: pr, source: 'personal_record' }
        }
      }
      state = await repo.setBaselineComplete(userId, sessionId, baseline1rm)
    }
  }

  // A stored prescription can carry a no-op transition (target phase === current phase)
  // from before the generation-time guard landed; those rows live up to 7 days. Normalise
  // on read so the card never offers an impossible transition.
  if (state.prescription) {
    state = {
      ...state,
      prescription: normalizeStoredPrescription(
        state.prescription, state.phase,
        new Map(validSession.exercises.map(e => [e.id, e.exerciseRole])),
      ),
    }
  }

  // The prescription card consumes ONLY `signals.exercises`, and only identity/role/1RM-trend
  // from it (workout-screen.tsx's PeriodizationResponse type is the contract). This used to call
  // the full aggregateSignals — ~25 queries including 28 days of sessions, a 90-day timing audit,
  // sleep, HRV, SpO2 and Oura rollups — to produce six fields per exercise, on every card load
  // AND every ~3s regeneration poll tick. Those signals exist for the LLM prompt; the card never
  // sees them. Three cheap reads instead, sharing the engine's own trend derivation so the two
  // can't disagree. The generator still uses the full aggregation.
  const [allPrs, prevPrs] = await Promise.all([
    repo.listPersonalRecords(userId),
    repo.listPrevious1rm(userId),
  ])
  const signals = { exercises: buildCardExerciseSignals(validSession.exercises, allPrs, prevPrs) }

  return NextResponse.json({ state, signals }, { headers: { 'Cache-Control': 'private, no-store' } })
}
