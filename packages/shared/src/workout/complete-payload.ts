import { z } from "zod";

export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
});

export type CompleteWorkoutPayload = z.infer<
  typeof CompleteWorkoutPayloadSchema
>;
