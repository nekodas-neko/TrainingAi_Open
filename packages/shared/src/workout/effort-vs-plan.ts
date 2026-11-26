import { z } from 'zod';

/**
 * #3745: the lifter's answer to "how did this exercise feel?", asked once per exercise after its
 * last set. Stored as the answer itself on `exercise_logs.effort_vs_plan` / `effort_source`
 * (migration 202611200539).
 *
 *   -1  easier than expected · 0 as expected · +1 harder than expected
 *   'tapped'  the lifter chose it · 'default'  left on the starting value, "as expected"
 *
 * NULL (no answer) means the question was never finished: the exercise was left before its last
 * set, or the workout was abandoned. Nothing reads the answer yet; the session read (#3889) will.
 */
export const EFFORT_VS_PLAN_VALUES = [-1, 0, 1] as const;
export type EffortVsPlan = (typeof EFFORT_VS_PLAN_VALUES)[number];
export const EFFORT_SOURCES = ['tapped', 'default'] as const;
export type EffortSource = (typeof EFFORT_SOURCES)[number];

/** Where the question starts (owner, 20 Nov): the plan's own expectation. */
export const DEFAULT_EFFORT_VS_PLAN: EffortVsPlan = 0;

export const EffortVsPlanSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export const EffortSourceSchema = z.enum(EFFORT_SOURCES);

/** The log payload's `effort`: both halves or neither, so a value never lands without its source. */
export const ExerciseEffortSchema = z.object({
  vsPlan: EffortVsPlanSchema,
  source: EffortSourceSchema,
});
export type ExerciseEffort = z.infer<typeof ExerciseEffortSchema>;

/**
 * #4159: one set's answer, in the log payload's per-set list (index-aligned with `weights`). The same
 * two halves as the exercise's own answer, both or neither (a `null` entry is a set the question was
 * not shown for), and nothing else: an unknown key is refused rather than dropped, so a future field
 * is a decision and not a silent loss.
 */
export const SetEffortSchema = ExerciseEffortSchema.strict();

export const EFFORT_VS_PLAN_LABELS: Record<EffortVsPlan, string> = {
  [-1]: 'Easier than expected',
  0: 'As expected',
  1: 'Harder than expected',
};
