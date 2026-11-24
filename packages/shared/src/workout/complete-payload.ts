import { z } from "zod";

// A plan's identity is a real instant: an ISO timestamp after the app existed and not further ahead than
// clock skew explains. Anything else cannot name a plan this server made.
const PLAN_IDENTITY_EARLIEST_MS = Date.UTC(2025, 0, 1)
const PLAN_IDENTITY_SKEW_MS = 10 * 60_000
const planInstant = z.string().datetime().max(40).refine(v => {
  const t = Date.parse(v)
  return t >= PLAN_IDENTITY_EARLIEST_MS && t <= Date.now() + PLAN_IDENTITY_SKEW_MS
})

export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
  /** Whole seconds the workout was paused (#3266); absent from builds that cannot pause. */
  pausedSec: z.number().int().min(0).max(86_400).optional(),
  /**
   * #4097: `prescription_generated_at` of the plan the workout was trained on, as `/api/workout-data` served
   * it when the phone started the workout. A Preview workout uploads only at its finish, so the stored plan
   * may have been replaced meanwhile; this says which one was trained. Absent: an older build (read as
   * before). Explicit `null`: a newer build that trained no plan (the program as written). A malformed,
   * ancient or future value is read as absent, never refused: a 4xx here would quarantine the mutation and
   * the workout would never be completed.
   */
  planGeneratedAt: planInstant.nullable().optional().catch(undefined),
  /** #4097: the phase the trained plan was made for (the session's phase when it was served). Absent from
   *  older builds and from a workout that trained no plan. An unknown value is read as absent. */
  planPhase: z.enum(['baseline', 'accumulation', 'intensification', 'realisation', 'deload']).optional().catch(undefined),
});

export type CompleteWorkoutPayload = z.infer<
  typeof CompleteWorkoutPayloadSchema
>;
