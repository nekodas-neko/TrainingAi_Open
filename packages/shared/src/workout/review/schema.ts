import { z } from 'zod'

// The Workout Review AI response. Unlike the periodization PrescriptionSchema (which forces
// every session exercise to survive — reconcile-prescription.ts backfills any the model
// omits), the review is allowed to DROP an exercise so an over-budget session can actually
// fit its time budget. Each exercise carries an explicit action:
//   - 'keep'   → leave it on its current programming (no overlay entry written)
//   - 'adjust' → change sets/reps/pct/rest for this exercise
//   - 'drop'   → remove it (drop_reason required)
// sets/reps/pct/rest_sec are only meaningful for 'keep'/'adjust'; they're ignored for 'drop'.
// pct is 0-100 (not 30-100) for the same reason as PrescriptionSchema: the model sometimes
// returns a 0-1 fraction, normalized back to 30-100 after parsing in reconcile.ts.
export const WorkoutReviewSchema = z.object({
  exercises: z.array(z.object({
    session_exercise_id: z.string(),
    name: z.string(),
    action: z.enum(['keep', 'adjust', 'drop']),
    // Bounds are permissive (0 allowed): the model emits 0/0/0/0 for a 'drop' where the
    // numbers are irrelevant, and reconcile.ts re-clamps keep/adjust into legal ranges
    // (role floor, reps ≥ 1, pct 30-100, rest ≥ 30). A strict lower bound here would 502
    // the whole review on a legitimate drop.
    sets: z.number().int().min(0).max(10),
    reps: z.number().int().min(0).max(30),
    pct: z.number().min(0).max(100),
    rest_sec: z.number().int().min(0).max(600),
    drop_reason: z.string().optional(),
  })).min(1),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})

export type WorkoutReviewResponse = z.infer<typeof WorkoutReviewSchema>
