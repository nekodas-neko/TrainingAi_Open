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

  // BF-143. "Has this session been trained since its baseline phase began?" — the only honest test
  // of the interruption the auto-heal below exists to repair, and the one the old condition lacked.
  // It asked whether these exercise NAMES had ever been logged, which is true of every recreated
  // session, so rebuilding a session inside an existing program silently skipped its calibration.
  //
  // ⚠ Name-keyed, and that is a WEAKNESS rather than a design choice — see BF-144.
  // The justification originally written here was false: it claimed `program_session_id` is NULL on
  // every row. That measured the DEAD column of the pair `schema.ts` warns about. The live link is
  // the column named `session_id` (Drizzle property `programSessionId`), and it IS populated —
  // 62 of 108 rows, and on 2026-09-11 each of the owner's four trained sessions had one while the
  // recreated Lower had none. An id test would have answered this question directly.
  // The date comparison is what carries the guard today, and it is correct for the recreated-session
  // case; BF-144 replaces the name lookup with the id link, which does not depend on names staying
  // unique or unchanged.
  let interrupted: boolean | null = null
  const sessionWasInterrupted = async (): Promise<boolean> => {
    if (interrupted !== null) return interrupted
    const lastLogs = await repo.getLastExerciseLogsBatch(
      userId,
      validSession.exercises.map(e => e.exerciseName),
      // Program-scoped: a shared exercise name logged under a *different* program mustn't
      // let this fresh ai_dynamic cycle skip its own AMRAP baseline week.
      program!.id,
    )
    const since = state!.phaseStartedAt.getTime()
    interrupted = [...lastLogs.values()].some(log => log.loggedAt.getTime() >= since)
    return interrupted
  }

  // BF-143: a baseline already completed from borrowed PRs is reverted, because the owner's rule is
  // that a session's first outing is its calibration. Narrow by construction — `personal_record` is
  // written only by the block below, so an AMRAP (`amrap`) or a prior-data choice (`existing`) is
  // never touched. Guarded by the same interruption test used below, so a session that WAS trained
  // after adopting keeps what it has rather than losing a real cycle.
  if (state.baselineComplete && !(await sessionWasInterrupted())) {
    state = (await repo.revertAutoAdoptedBaseline(userId, sessionId)) ?? state
  }

  // Auto-heal stale baseline: if DB says baseline is incomplete but THIS SESSION was logged since
  // its baseline phase began, the completion endpoint was never reached (app crash / navigation
  // away). Reconstruct baseline1rm from existing PRs and advance to accumulation.
  if (state.phase === 'baseline' && !state.baselineComplete && await sessionWasInterrupted()) {
    const allPrs = await repo.listPersonalRecords(userId)
    const baseline1rm: Record<string, Baseline1rmEntry> = {}
    for (const ex of validSession.exercises) {
      const pr = allPrs.get(ex.exerciseName)
      if (pr != null) {
        baseline1rm[ex.id] = { kg: pr, source: 'personal_record' }
      }
    }
    // BF-143: complete only on FULL coverage. `recordBaselineAnchors` already holds this invariant
    // for the measured path — "a partial baseline stays in `baseline` and keeps what it measured" —
    // and completing on a subset leaves the prescription reading anchors that were never written.
    if (validSession.exercises.every(ex => baseline1rm[ex.id] != null)) {
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
