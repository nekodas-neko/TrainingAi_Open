import { z } from 'zod';
const shape = z.object({
  sets: z.number(),
  reps: z.number(),
  pct: z.number(),
  restSec: z.number(),
});
export const ReviewSchema = z.object({
  sessionId: z.string(),
  sessionName: z.string(),
  totalBudgetMin: z.number(),
  reasoning: z.string(),
  proposal: z.object({
    projectedDurationMin: z.number(),
    budgetMin: z.number(),
    fitsBudget: z.boolean(),
    weeklyImpact: z.record(z.string(), z.number()),
    exercises: z.array(
      z.object({
        sessionExerciseId: z.string(),
        name: z.string(),
        role: z.string(),
        action: z.enum(['keep', 'adjust', 'drop']),
        before: shape.nullable(),
        after: shape.nullable(),
        reason: z.string().nullable(),
        guardAdjusted: z.boolean(),
      }),
    ),
  }),
});
export type Review = z.infer<typeof ReviewSchema>;
export type Decision = 'cycle' | 'permanent' | 'reject';
export function reviewPayload(review: Review, decisions: Record<string, Decision>) {
  const selected = review.proposal.exercises.filter(
    (x) =>
      x.action !== 'keep' &&
      decisions[x.sessionExerciseId] &&
      decisions[x.sessionExerciseId] !== 'reject',
  );
  return {
    adjustments: selected.flatMap((x) =>
      x.action === 'adjust' && x.after
        ? [{ sessionExerciseId: x.sessionExerciseId, ...x.after }]
        : [],
    ),
    dropThisCycle: selected
      .filter((x) => x.action === 'drop' && decisions[x.sessionExerciseId] === 'cycle')
      .map((x) => x.sessionExerciseId),
    dropPermanent: selected
      .filter((x) => x.action === 'drop' && decisions[x.sessionExerciseId] === 'permanent')
      .map((x) => x.sessionExerciseId),
    estimatedSessionDurationMin: review.proposal.projectedDurationMin,
    reasoning: review.reasoning,
  };
}
export function formatShape(value: z.infer<typeof shape> | null) {
  return value ? `${value.sets} × ${value.reps} @ ${value.pct}% · ${value.restSec}s rest` : '—';
}
