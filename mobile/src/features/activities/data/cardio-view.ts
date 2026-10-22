import type { z } from 'zod';
import {
  heartHealthDayOutcome,
  type HeartHealthDayOutcome,
} from '@trainingai/shared/running/heart-health';
import type { baselinesSpec, runningPlanSpec } from './models';

export type FitnessTest = z.infer<typeof baselinesSpec.schema>['fitnessTests'][number];
export type HeartHealthDay = NonNullable<
  z.infer<ReturnType<typeof runningPlanSpec>['schema']>['heartHealth']
>['days'][number];

/**
 * The newest result of each fitness protocol, in the order the current app lists them. `tests` is
 * the server's list (newest first) followed by tests saved on this phone; the current app reads its
 * own store oldest first, so two tests on one day must tie the same way round or the tiles swap.
 */
export function latestBaselines(
  tests: readonly FitnessTest[],
  local: readonly FitnessTest[] = [],
): FitnessTest[] {
  const latest: Record<string, FitnessTest> = {};
  const oldestFirst = [...[...tests].reverse(), ...local];
  for (const row of oldestFirst.sort((a, b) => a.date.localeCompare(b.date))) {
    latest[row.testType] = row;
  }
  return Object.values(latest);
}

/**
 * How the week list reads a day. The server sends the outcome; a payload cached before it did
 * is read through the same shared rule, so the two can never disagree.
 */
export function weekDayOutcome(day: HeartHealthDay, today: string): HeartHealthDayOutcome {
  return (
    day.outcome ??
    heartHealthDayOutcome(
      {
        targetMin: day.targetMin ?? null,
        countedMin: day.countedMin,
        met: day.met,
        credited: null,
      },
      day.activities.length,
      day.date.replace(/\//g, '-') === today,
      day.status,
    )
  );
}
