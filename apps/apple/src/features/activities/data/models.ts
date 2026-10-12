import { z } from 'zod';
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log';
import type { IconName } from '../../../shared/ui/Icon';

export const activityTypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string(),
  isDistanceBased: z.boolean(),
});
export type ActivityType = z.infer<typeof activityTypeSchema>;
export const activityTypesSpec = {
  path: '/api/activity-types',
  ttl: 3_600_000,
  schema: z.object({ activityTypes: z.array(activityTypeSchema) }),
};
export const activityPayload = ActivityLogBody.safeExtend({ id: z.uuid() });
export type ActivityPayload = z.infer<typeof activityPayload>;
const number = z.number().finite();
const quota = z.object({
  hasHrSource: z.boolean().nullish(),
  zones: z.array(
    z.object({
      zoneId: number,
      targetMin: number,
      doneMin: number,
      remainingMin: number,
      pctComplete: number,
      status: z.enum(['open', 'complete', 'not-required']),
    }),
  ),
  trainingTargetMin: number,
  trainingDoneMin: number,
  trainingRemainingMin: number,
});
export const cardioWeekSpec = (today: string) => ({
  path: '/api/cardio-week',
  partition: today,
  ttl: 300_000,
  schema: z.object({
    heart: z.object({
      restingHr: number,
      avgHr: number.nullish(),
      maxHr: number.nullish(),
      restingHrDeltaBpm: number.nullish(),
      avgHrDeltaBpm: number.nullish(),
      maxHrDeltaBpm: number.nullish(),
      isReliable: z.boolean(),
      restingHrSource: z.string().optional(),
      maxHrSource: z.string().optional(),
    }),
    quota,
    dayQuota: quota,
    steps: z.object({ today: number, todayGoal: number, week: number, weekGoal: number }),
    hasRunningPlan: z.boolean(),
    trainedToday: z.boolean(),
  }),
});
export const cardioTrendsSpec = {
  path: '/api/cardio-trends',
  ttl: 900_000,
  schema: z.object({
    hasHrSource: z.boolean().nullish(),
    weeklyZoneStacks: z.array(
      z.object({ weekStart: z.string(), seconds: z.array(number).length(5) }),
    ),
    efficiencyCurve: z.array(
      z.object({ date: z.string(), avgHr: number, avgPaceSecPerKm: number }),
    ),
    cadenceTrend: z.array(z.object({ date: z.string(), cadenceSpm: number })),
  }),
};
export const baselinesSpec = {
  path: '/api/fitness-tests',
  ttl: 900_000,
  schema: z.object({
    fitnessTests: z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        testType: z.string(),
        durationSec: number.nullish(),
        distanceM: number.nullish(),
        restingHr: number.nullish(),
        maxHr: number.nullish(),
        method: z.string().nullish(),
        notes: z.string().nullish(),
        vo2maxEst: number.nullish(),
        hrr1Bpm: number.nullish(),
      }),
    ),
  }),
};
export const runningPlanSpec = (today: string) => ({
  path: '/api/running-plan',
  partition: today,
  ttl: 300_000,
  schema: z.object({
    plan: z
      .object({
        id: z.string(),
        frameworkKey: z.string(),
        fitnessSnapshot: z
          .object({
            maxHr: number,
            restingHr: number,
            vo2max: number.nullable(),
            thresholdHr: number.nullable(),
            weeklyBaseMinutes: number,
            source: z.enum(['baseline', 'age-estimate']),
          })
          .optional(),
      })
      .passthrough()
      .nullable(),
    prescription: z
      .object({
        type: z.enum(['recovery', 'easy', 'long', 'tempo', 'interval']),
        durationMin: number.nullish(),
        distanceKm: number.nullish(),
        rationale: z.string(),
        targets: z.object({ zoneIds: z.array(number), hrLowBpm: number, hrHighBpm: number }),
      })
      .passthrough()
      .nullish(),
    gateAction: z.enum(['proceed', 'soften', 'rest']).optional(),
    gateReasons: z.array(z.string()).optional(),
    run: z
      .object({
        durationMin: number.nullish(),
        status: z.enum(['pending', 'completed', 'skipped']),
        targetZoneIds: z.array(number).optional(),
      })
      .passthrough()
      .nullish(),
    zoneTargets: z
      .object({
        totalMinutes: number,
        guidelineNote: z.string(),
        perZone: z.array(z.object({ zoneId: number, minutes: number })),
      })
      .optional(),
    goal: z.object({ label: z.string(), blurb: z.string() }).nullish(),
    isPushSession: z.boolean().optional(),
    heartHealth: z
      .object({
        days: z.array(
          z
            .object({
              date: z.string(),
              runId: z.string(),
              status: z.enum(['pending', 'completed', 'skipped']),
              creditedId: z.string().nullable(),
              activities: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  activityType: z.string(),
                  durationMin: number.nullable(),
                  effortMin: number.nullable(),
                }),
              ),
              countedMin: number,
              met: z.boolean(),
              targetMin: number.nullish(),
            })
            .passthrough(),
        ),
      })
      .optional(),
  }),
});
export function activityIcon(icon: string): IconName {
  if (/Walk|Run|Sneaker|Stairs/.test(icon)) {
    return 'legs';
  }
  if (/Bike|Bicycle/.test(icon)) {
    return 'bike';
  }
  if (/Swim|Pool/.test(icon)) {
    return 'waves';
  }
  if (/Hike|Mountain|Ski|Snow/.test(icon)) {
    return 'mountain';
  }
  if (/Barbell/.test(icon)) {
    return 'workout';
  }
  if (/Heart/.test(icon)) {
    return 'cardio';
  }
  if (/Lightning/.test(icon)) {
    return 'power';
  }
  return 'activity';
}
