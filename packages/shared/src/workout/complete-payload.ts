import { z } from "zod";

export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
  /** Whole seconds the workout was paused (#3266); absent from builds that cannot pause. */
  pausedSec: z.number().int().min(0).max(86_400).optional(),
});

export type CompleteWorkoutPayload = z.infer<
  typeof CompleteWorkoutPayloadSchema
>;
