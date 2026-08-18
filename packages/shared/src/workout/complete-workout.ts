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

    // The next prescription for this session is generated on demand when it is next opened
    // (isAiPrescriptionPending, keyed on prescriptionStatus === 'consumed'), not eagerly here —
    // see app/api/complete-workout/route.ts for why.
  }

  return { alreadyCompleted, programSessionId }
}
