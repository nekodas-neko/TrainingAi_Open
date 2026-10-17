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

/** The newest result of each fitness protocol, in the order the current app lists them. */
export function latestBaselines(tests: readonly FitnessTest[]): FitnessTest[] {
  const latest: Record<string, FitnessTest> = {};
  for (const row of [...tests].sort((a, b) => a.date.localeCompare(b.date))) {
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
