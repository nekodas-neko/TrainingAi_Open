import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'

const ApplySchema = z.object({
  adjustments: z.array(z.object({
    sessionExerciseId: z.string(),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(30),
    pct: z.number().min(30).max(100),
    restSec: z.number().int().min(30).max(600),
  })).default([]),
  dropThisCycle: z.array(z.string()).default([]),
  dropPermanent: z.array(z.string()).default([]),
  estimatedSessionDurationMin: z.number().int().min(0).max(600),
  reasoning: z.string().max(2000).default(''),
})

const ROLE_FLOOR: Record<string, number> = { primary: 2, secondary: 2, accessory: 1 }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sessionId: programSessionId } = await params

  let body: z.infer<typeof ApplySchema>
  try {
    body = ApplySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  const programSession = program?.sessions.find(s => s.id === programSessionId)
  if (!programSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const state = await repo.getSessionPeriodization(userId, programSessionId)
  if (!state) return NextResponse.json({ error: 'Session is not AI-dynamic' }, { status: 400 })
  if (state.phase === 'baseline' && !state.baselineComplete) {
    return NextResponse.json({ error: 'Baseline not complete' }, { status: 400 })
  }

  const byId = new Map(programSession.exercises.map(ex => [ex.id, ex]))
  const validId = (id: string) => byId.has(id)

  // Permanent drops first — remove the session_exercises rows (ownership enforced in repo).
  const permanentlyDropped: string[] = []
  for (const id of new Set(body.dropPermanent)) {
    if (!validId(id)) continue
    if (await repo.removeSessionExercise(userId, id)) permanentlyDropped.push(id)
  }
  const permanentSet = new Set(permanentlyDropped)

  const adjustments = body.adjustments.filter(a => validId(a.sessionExerciseId) && !permanentSet.has(a.sessionExerciseId))
  const dropThisCycle = [...new Set(body.dropThisCycle)].filter(id => validId(id) && !permanentSet.has(id))

  const hasOverlay = adjustments.length > 0 || dropThisCycle.length > 0

  // Rebuild the prescription overlay only if there's something to overlay, or an existing
  // prescription references a now-deleted exercise (prune it). Kept exercises stay out of
  // the blob and fall back to their base style — matching the periodization render path.
  const existing = state.prescription
  const needsPrune = !!existing && (
    existing.exercises.some(e => permanentSet.has(e.sessionExerciseId)) ||
    (existing.droppedExerciseIds ?? []).some(id => permanentSet.has(id))
  )

  if (hasOverlay || needsPrune) {
    const exerciseById = new Map<string, AiPrescriptionExercise>(
      (existing?.exercises ?? []).map(e => [e.sessionExerciseId, e]),
    )
    for (const adj of adjustments) {
      const ex = byId.get(adj.sessionExerciseId)!
      const floor = ROLE_FLOOR[ex.exerciseRole] ?? 2
      exerciseById.set(adj.sessionExerciseId, {
        sessionExerciseId: adj.sessionExerciseId,
        name: ex.exerciseName,
        sets: Math.max(floor, adj.sets),
        reps: adj.reps,
        pct: adj.pct,
        restSec: adj.restSec,
      })
    }
    for (const id of permanentSet) exerciseById.delete(id)

    const droppedExerciseIds = [
      ...new Set([...(existing?.droppedExerciseIds ?? []), ...dropThisCycle]),
    ].filter(id => validId(id) && !permanentSet.has(id))

    const prescription: AiPrescription = {
      phase: existing?.phase ?? (state.phase === 'baseline' ? 'accumulation' : state.phase),
      phaseAction: 'stay',
      exercises: [...exerciseById.values()],
      estimatedSessionDurationMin: body.estimatedSessionDurationMin,
      weeklyVolumeContribution: existing?.weeklyVolumeContribution ?? {},
      deload: false,
      reasoning: body.reasoning || existing?.reasoning || 'Adjusted via Workout Review.',
      // Deterministic, not the model's self-report: a Workout Review apply is a user-authored,
      // explicitly-confirmed change (accepted below), so it must never trip the card's
      // low-confidence confirm gate (CLAUDE.md — no LLM self-reported number may gate an action).
      // 1.0 = "don't gate", matching the deload convention; confidenceReasons stays empty.
      confidence: 1.0,
      confidenceReasons: [],
      droppedExerciseIds,
    }
    await repo.storePrescription(userId, programSessionId, prescription, new Date(Date.now() + 7 * 86_400_000))
    // storePrescription writes status 'pending'; accept it so it drives the bar this cycle.
    await repo.updatePrescriptionStatus(userId, programSessionId, 'accepted')
  }

  return NextResponse.json({
    applied: {
      adjustments: adjustments.length,
      dropThisCycle: dropThisCycle.length,
      dropPermanent: permanentlyDropped.length,
    },
  })
}
