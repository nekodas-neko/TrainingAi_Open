import { z } from 'zod'

export const SessionRpeSchema = z.object({
  workoutSessionId: z.string().uuid(),
  sessionRpe: z.number().int().min(1).max(10),
})
