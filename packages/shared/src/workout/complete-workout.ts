import { z } from 'zod'

export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
})

export type CompleteWorkoutPayload = z.infer<typeof CompleteWorkoutPayloadSchema>

/** How far ahead of server time a phone's clock may be before its timestamp is unusable. */
export const COMPLETED_AT_FUTURE_TOLERANCE_MS = 60 * 60_000

/**
 * `completedAtMs` is the phone's own clock and was accepted unbounded and uncompared (Q-24 §7): a
 * value below `startedAt` gives every downstream duration a negative length, and one outside the
 * Date range reaches the driver as Invalid Date.
 *
 * Reconciled rather than rejected. A 400 here would quarantine the outbox mutation and the workout
 * would simply never be marked complete — losing a real session over a bad clock reading. When the
 * client timestamp is unusable the server falls back to its own time, exactly as it already does
 * when `completedAtMs` is absent.
 *
 * An offline replay days later still keeps its own timestamp: it is after `startedAt` and not in
 * the future, so nothing about it is unusable.
 */
export function resolveCompletedAt(
  completedAtMs: number | undefined,
  startedAt: Date,
  now: Date = new Date(),
): Date {
  if (completedAtMs == null || !Number.isFinite(completedAtMs)) return now
  if (completedAtMs < startedAt.getTime()) return now
  if (completedAtMs > now.getTime() + COMPLETED_AT_FUTURE_TOLERANCE_MS) return now
  return new Date(completedAtMs)
}

/**
 * Copy the AMRAP anchors this session already measured into `session_periodization.baseline1rm`.
 *
 * Keyed by session-exercise id, because the periodization signals look the baseline up that way —
 * the same keying `baseline/complete` uses for its prior-data path. `exercise_logs` carries the
 * exercise NAME, so the join is name → the program session's exercise id, which is also how the
 * prior-data path maps a personal record onto a session.
 *
 * `source: 'amrap'` distinguishes a measured anchor from a carried-over PR (`'existing'`) or a
 * number typed in the builder (`'estimate'`), so the prescription prompt can weigh them
 * differently. The tag already existed in `Baseline1rmEntry` and had no producer.
 *
 * The phase completes only when EVERY exercise in the session has an anchor. A lifter who logs
 * three of five keeps those three and stays in `baseline` — see `recordBaselineAnchors`.
 */
async function recordBaselineAnchorsFrom(
  // Structural, not the Repository type: `packages/shared` must not depend on `lib/data`, and
  // naming only what this needs keeps the coupling visible.
  repo: {
    getSessionExercise1rms(userId: string, workoutSessionId: string): Promise<{ exerciseName: string; estimated1rm: number }[]>
    getActiveProgram(userId: string): Promise<{ sessions: { id: string; exercises: { id: string; exerciseName: string }[] }[] } | null>
    getSessionPeriodization(userId: string, programSessionId: string): Promise<{ baseline1rm?: Record<string, unknown> } | null>
    recordBaselineAnchors(
      userId: string, programSessionId: string,
      anchors: Record<string, { kg: number; source: 'amrap' }>, complete: boolean,
    ): Promise<unknown>
  },
  userId: string,
  programSessionId: string,
  workoutSessionId: string,
): Promise<void> {
  const [logged, program] = await Promise.all([
    repo.getSessionExercise1rms(userId, workoutSessionId),
    repo.getActiveProgram(userId),
  ])
  const programSession = program?.sessions.find(ps => ps.id === programSessionId)
  if (!programSession || programSession.exercises.length === 0) return

  const byName = new Map(logged.map(l => [l.exerciseName, l.estimated1rm]))
  const anchors: Record<string, { kg: number; source: 'amrap' }> = {}
  for (const ex of programSession.exercises) {
    const kg = byName.get(ex.exerciseName)
    if (kg != null) anchors[ex.id] = { kg, source: 'amrap' }
  }
  if (Object.keys(anchors).length === 0) return

  // Complete against the SESSION's exercise list, not against what this workout logged: a lifter
  // who skipped one has an incomplete anchor even though everything they did log has an entry.
  // Counted over the merged map, so a second session can finish what the first started.
  const existing = await repo.getSessionPeriodization(userId, programSessionId).catch(() => null)
  const covered = new Set([...Object.keys(existing?.baseline1rm ?? {}), ...Object.keys(anchors)])
  const complete = programSession.exercises.every(ex => covered.has(ex.id))

  await repo.recordBaselineAnchors(userId, programSessionId, anchors, complete)
}

// Shared by the web route (app/api/complete-workout) and the offline outbox
// replay (pushMutations' complete_workout branch) so the two paths can't drift.
// Idempotent: a retried/replayed completion (network retry, or an outbox
// mutation re-pushed after its response was lost) must not re-consume the
// prescription or double-increment the sessions_in_phase stored counter.
//
// Q-473 — that idempotence is the guarded UPDATE's, not this function's. It used to be decided
// from the read above the write, which holds for a *sequential* replay and fails for a
// simultaneous one: four concurrent completions of one session all read `completedAt = null`,
// all believed they were first, and `sessions_in_phase` advanced up to three times off a single
// workout (measured in 4 of 5 trials). The counter drives phase progression, so over-counting
// moves the lifter into the next phase — and into a deload — early, off sessions never trained.
// `completeWorkoutSession` carries `isNull(completed_at)` in its WHERE, so the database already
// picks exactly one winner; all that was missing was reading which one that is.
export async function completeWorkoutFromPayload(
  userId: string,
  payload: CompleteWorkoutPayload,
): Promise<{ alreadyCompleted: boolean; programSessionId: string | null }> {
  const { workoutSessionId, completedAtMs } = payload
  // Lazy import: same static-import-of-async-Turbopack-module edge as
  // lib/workout/log-exercise.ts (see docs/superpowers/plans/
  // 2026-07-05-log-exercise-turbopack-dev-fix.md) — this module is also
  // dynamically imported by the outbox (pushMutations' complete_workout
  // branch), so a static top-level import here leaves the route's namespace
  // binding empty under `next dev --turbopack`.
  const { getRepository } = await import('@/lib/data')
  const repo = await getRepository()

  const existing = await repo.getWorkoutSessionById(userId, workoutSessionId)
  if (!existing) {
    throw new Error(`completeWorkoutFromPayload: session ${workoutSessionId} not owned by user ${userId}`)
  }

  const completedAt = resolveCompletedAt(completedAtMs, existing.startedAt)
  const stamped = await repo.completeWorkoutSession(workoutSessionId, userId, completedAt)
  const alreadyCompleted = !stamped

  const programSessionId = await repo.getWorkoutSessionProgramSessionId(userId, workoutSessionId)
  if (programSessionId && !alreadyCompleted) {
    // Read the prescription status before overwriting it to 'consumed' below, so the
    // rep-completion signal chain (lib/ai-periodization/signals.ts) knows whether this
    // session actually ran under a prescription — an advisory signal, must never fail
    // completion.
    const periodizationState = await repo.getSessionPeriodization(userId, programSessionId).catch(() => null)
    const ranPrescription =
      periodizationState?.prescriptionStatus === 'accepted' ||
      periodizationState?.prescriptionStatus === 'auto_applied' ||
      (periodizationState?.prescriptionStatus === 'pending' && periodizationState?.prescription != null)
    repo.setLastSessionRanPrescription(userId, programSessionId, ranPrescription).catch(() => {})

    await repo.updatePrescriptionStatus(userId, programSessionId, 'consumed')
    repo.incrementSessionsInPhase(userId, programSessionId).catch(e =>
      console.error('incrementSessionsInPhase failed (advisory, workout completion unaffected):', e)
    )

    // BF-131 — the baseline hop. Completion WAS wired and wrote the wrong field: the counter moved,
    // `baseline_complete` never did, and the only exit from `baseline` was the "Use prior data"
    // button — the one path that discards the baseline session. The owner ran both AMRAP sessions
    // exactly as the banner instructs and the screen still read "baseline needed".
    //
    // The 1RM is NOT recomputed here. The workout screen already ran the AMRAP estimator and
    // persisted the result to `exercise_logs.estimated_1rm`; this reads it back. Same posture as
    // the increment above — advisory, fire-and-forget, because a completion must never fail on a
    // periodization write, which means the flag may lag a completion and the screen has to tolerate
    // that.
    if (periodizationState?.phase === 'baseline' && !periodizationState.baselineComplete) {
      recordBaselineAnchorsFrom(repo, userId, programSessionId, workoutSessionId).catch(e =>
        console.error('baseline anchor write failed (advisory, workout completion unaffected):', e)
      )
    }

    // The next prescription for this session is generated on demand when it is next opened
    // (isAiPrescriptionPending, keyed on prescriptionStatus === 'consumed'), not eagerly here —
    // see app/api/complete-workout/route.ts for why.
  }

  return { alreadyCompleted, programSessionId }
}
