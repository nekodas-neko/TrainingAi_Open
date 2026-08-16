import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { aggregateSignals } from '@trainingai/shared/ai-periodization/signals'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { prescriptionDrivesLoad } from '@trainingai/shared/ai-periodization/apply-prescription'
import { rateLimit } from '@/lib/rate-limit'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { WorkoutReviewSchema } from '@trainingai/shared/workout/review/schema'
import { buildReviewSystemPrompt, buildReviewUserPrompt } from '@trainingai/shared/workout/review/prompt'
import { reconcileReview, type ReviewSignalExercise, type SetShape } from '@trainingai/shared/workout/review/reconcile'
import type { ProgressionStyle } from '@trainingai/shared/types/progression'
import type { ExerciseRole } from '@trainingai/shared/types/program'

export const maxDuration = 30

const ROLE_DEFAULT: Record<string, SetShape> = {
  primary: { sets: 3, reps: 5, pct: 80, restSec: 180 },
  secondary: { sets: 3, reps: 8, pct: 72, restSec: 120 },
  accessory: { sets: 3, reps: 12, pct: 65, restSec: 90 },
}

// A single representative {sets,reps,pct,restSec} for a progression style — the top
// (highest set-number) set's numbers with the total set count. Used as the "before"
// side of the diff when no active prescription is driving the exercise.
function summarizeStyle(style: ProgressionStyle | undefined, role: ExerciseRole): SetShape {
  if (!style || style.sets.length === 0) return ROLE_DEFAULT[role] ?? ROLE_DEFAULT.secondary
  const top = [...style.sets].sort((a, b) => a.setNumber - b.setNumber).at(-1)!
  return { sets: style.sets.length, reps: top.reps, pct: top.pct, restSec: top.restSec }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`workout-review:${userId}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { sessionId: programSessionId } = await params
  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const state = await repo.getSessionPeriodization(userId, programSessionId)
  if (!state) {
    return NextResponse.json(
      { error: 'This session is not set up for AI review. Workout Review needs an AI-dynamic program.' },
      { status: 400 },
    )
  }
  if (state.phase === 'baseline' && !state.baselineComplete) {
    return NextResponse.json({ error: 'Finish the baseline week before reviewing this session.' }, { status: 400 })
  }

  const signals = await aggregateSignals(userId, programSessionId, repo, tz)
  if (!signals) return NextResponse.json({ error: 'Could not gather training data for this session.' }, { status: 404 })

  const program = await repo.getActiveProgram(userId)
  const programSession = program?.sessions.find(s => s.id === programSessionId)
  if (!programSession) return NextResponse.json({ error: 'Session not found in your active program.' }, { status: 404 })

  // "Before" numbers: base style per exercise, overridden by the active prescription when
  // one is actually driving the bar (accepted / auto-applied / pending-stay).
  const styles = await repo.listProgressionStyles(userId)
  const styleById = new Map(styles.map(st => [st.id, st]))
  const positionById = new Map(programSession.exercises.map(ex => [ex.id, ex.position]))
  const currentParams = new Map<string, SetShape>()
  for (const ex of programSession.exercises) {
    currentParams.set(ex.id, summarizeStyle(ex.styleId ? styleById.get(ex.styleId) : undefined, ex.exerciseRole))
  }
  if (state.prescription && prescriptionDrivesLoad(state.prescription.phaseAction, state.prescriptionStatus)) {
    for (const pe of state.prescription.exercises) {
      currentParams.set(pe.sessionExerciseId, { sets: pe.sets, reps: pe.reps, pct: pe.pct, restSec: pe.restSec })
    }
  }

  const signalExercises: ReviewSignalExercise[] = signals.exercises.map(ex => ({
    sessionExerciseId: ex.sessionExerciseId,
    name: ex.name,
    role: ex.role,
    position: positionById.get(ex.sessionExerciseId) ?? 0,
    muscleContributions: (ex.muscleAssignments.length > 0
      ? ex.muscleAssignments.map(ma => ({ muscle: normalizeMuscle(ma.muscle), weight: ma.role === 'main' ? 1 : 0.5 }))
      : ex.muscleGroups.map(mg => ({ muscle: normalizeMuscle(mg), weight: 1 }))),
    transitionSec: ex.transitionSec,
    timeProfile: ex.timeProfile,
  }))

  const systemPrompt = buildReviewSystemPrompt(signals.trainingGoal, signals.phase)
  const userPrompt = buildReviewUserPrompt(signals, currentParams, today)

  let parsed: Awaited<ReturnType<typeof generateObject<typeof WorkoutReviewSchema>>>['object']
  try {
    const result = await loggedGenerateObject(
      { section: 'workout-review', userId, fingerprint: { programSessionId, today } },
      () => generateObject({
        model: aiModel(),
        schema: WorkoutReviewSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
    )
    parsed = result.object
  } catch (err) {
    console.error('Gemini workout-review generation failed:', err)
    return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 })
  }

  const proposal = reconcileReview({
    signalExercises,
    modelExercises: parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      action: ex.action,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
      dropReason: ex.drop_reason,
    })),
    currentParams,
    weeklyTargets: signals.weeklyTargets,
    weeklyLogged: signals.weeklyLogged,
    budgetMin: signals.effectiveTimeBudgetMin,
  })
  if (proposal.invalidIds.length > 0) {
    console.warn('[workout-review] ignored invented session_exercise_id(s):', proposal.invalidIds)
  }

  return NextResponse.json({
    sessionId: programSessionId,
    sessionName: programSession.name,
    totalBudgetMin: programSession.timeBudgetMinutes,
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
    proposal,
  })
}
