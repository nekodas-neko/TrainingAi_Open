import { z } from "zod";

export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
  /** Whole seconds the workout was paused (#3266); absent from builds that cannot pause. */
  pausedSec: z.number().int().min(0).max(86_400).optional(),
  /**
   * #4097: `prescription_generated_at` of the plan the workout was trained on, as `/api/workout-data` served
   * it when the phone started the workout. A Preview workout uploads only at its finish, so the stored plan
   * may have been replaced meanwhile; this says which one was trained. Absent from older builds and from a
   * workout trained on no AI plan. Only read as "this workout ran a plan"; never stored. A malformed value is
   * dropped, never refused: a 4xx here would quarantine the mutation and the workout would never be completed.
   */
  planGeneratedAt: z.string().datetime().max(40).optional().catch(undefined),
});

export type CompleteWorkoutPayload = z.infer<
  typeof CompleteWorkoutPayloadSchema
>;
