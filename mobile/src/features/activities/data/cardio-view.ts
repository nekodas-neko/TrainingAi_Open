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
 * The newest result of each fitness protocol, in the order the current app lists them: by the date
 * each protocol first appears. `tests` is the server's list (newest day first, same-day tests in the
 * order they were written, as the current app's own store reads them) and `local` the tests saved on
 * this phone and not yet in it; the stable date sort keeps same-day ties as they arrive.
 */
export function latestBaselines(
  tests: readonly FitnessTest[],
  local: readonly FitnessTest[] = [],
): FitnessTest[] {
  const latest: Record<string, FitnessTest> = {};
  const oldestFirst = [...tests, ...local];
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
