import { z } from 'zod';
import { REP_RANGE_DEFAULT, type CoachPatch } from '@trainingai/shared/coach/patch';
import type { ResourceSpec } from '../workouts/data/WorkoutResources';

/**
 * The program editor's "Rep range" row (#3896 step 7, owner's pick 8c A). The four ranges and the
 * program's default are the only values it can choose, and it writes them through the Coach's apply
 * path (`/api/coach/apply`, domain `lift_preference`), so the editor and the Coach are one writer with
 * one set of rules.
 */
export const REP_RANGE_OPTIONS = [
  { value: '5-8', label: '5 to 8' },
  { value: '8-10', label: '8 to 10' },
  { value: '10-12', label: '10 to 12' },
  { value: '12-15', label: '12 to 15' },
  { value: REP_RANGE_DEFAULT, label: 'Use the program’s default' },
] as const;

/** What the row reads: "10 to 12", or "Program’s default" with no range of the lift's own. */
export function repRangeDisplay(range: string | null) {
  return range ? range.replace('-', ' to ') : 'Program’s default';
}

/** The patch for choosing `to` when the lift's range is `from`. Null when nothing would change. */
export function repRangePatch(
  sessionExerciseId: string,
  from: string | null,
  to: string,
  changeId: string,
): CoachPatch | null {
  if (to === REP_RANGE_DEFAULT ? from === null : to === from) return null;
  return {
    domain: 'lift_preference',
    targetId: sessionExerciseId,
    changes: [{ id: changeId, field: 'repRange', from, to }],
  };
}

export const liftPreferencesSchema = z.object({
  preferences: z.record(z.string(), z.object({ repRange: z.string().nullable() })),
});
export function liftPreferencesSpec(
  names: readonly string[],
): ResourceSpec<z.infer<typeof liftPreferencesSchema>> {
  return {
    path: '/api/coach/lift-preferences',
    query: { names: JSON.stringify([...new Set(names)].sort()) },
    schema: liftPreferencesSchema,
    ttl: 300000,
  };
}
