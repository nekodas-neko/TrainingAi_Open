import { z } from 'zod';
import { dayExerciseSchema, daySpec } from '../../workouts/data/models.ts';

const n = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);
const text = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const numericFields = <T extends string>(keys: readonly T[]) =>
  Object.fromEntries(keys.map((key) => [key, n])) as Record<T, typeof n>;
export const bodySchema = z
  .object({
    date: z.string(),
    ...numericFields([
      'weightKg',
      'bodyFat',
      'bodyFatCorrected',
      'steps',
      'distanceKm',
      'calories',
      'protein',
      'carb',
      'fat',
      'waterMl',
      'restingHeartRate',
      'hrvMs',
      'spo2Pct',
      'waistCm',
      'chestCm',
      'armCm',
      'thighCm',
      'hipCm',
      'neckCm',
      'skeletalMusclePct',
      'fatFreeMassKg',
      'subcutaneousFatPct',
      'visceralFatIndex',
      'bodyWaterPct',
      'muscleMassKg',
      'boneMassKg',
      'proteinPct',
      'bmrKcal',
      'metabolicAge',
    ] as const),
    bodyFatIsCorrected: z.boolean().optional(),
  })
  .passthrough();
export type BodyRow = z.infer<typeof bodySchema>;
export const bodySpec = (date: string) => ({
  path: '/api/body-metadata',
  schema: z.object({
    today: bodySchema.nullable(),
    recent: z.array(bodySchema),
    latestWeightKg: n,
    latestWeightDate: text,
    activeEnergyKcalToday: n,
    weightTrend: z
      .array(z.object({ date: z.string(), weightKg: z.number().finite() }))
      .nullish(),
    bodyFatCalibration: z.object({ offsetPct: n, pairCount: n }).passthrough().nullish(),
    weekToDate: z.object({ steps: n, calories: n, waterMl: n }).nullish(),
  }),
  ttl: 300_000,
  partition: date,
});
export const bodyOverviewSpec = (date: string) => ({
  ...bodySpec(date),
  query: { overview: '1' },
  schema: bodySpec(date).schema.extend({ measuredOverview: z.array(bodySchema).nullish() }),
});
export type BodyData = z.infer<ReturnType<typeof bodySpec>['schema']>;
export const sleepSchema = z
  .object({
    id: z.string().optional(),
    date: z.string(),
    sleepStart: text,
    sleepEnd: text,
    manualSleepStart: text,
    phaseWindowStart: text,
    phaseWindowEnd: text,
    ...numericFields([
      'durationHours',
      'deepSleepHours',
      'remSleepHours',
      'lightSleepHours',
      'awakHours',
      'efficiency',
      'onsetLatencySec',
      'averageHrvMs',
      'avgHeartRate',
      'lowestHeartRate',
      'respiratoryRate',
      'sleepScore',
    ] as const),
    sleepPhase5Min: text,
    manualEntry: z.boolean().optional(),
    provisional: z.boolean().optional(),
    localOnly: z.boolean().optional(),
    sourceLabel: text,
    stageCoverage: n,
    sources: z.array(z.object({ name: z.string(), bundleIdentifier: z.string() })).nullish(),
  })
  .passthrough();
export type SleepRow = z.infer<typeof sleepSchema>;
export const sleepSpec = (date: string) => ({
  path: '/api/sleep-sessions',
  query: { to: date },
  schema: z.array(sleepSchema),
  ttl: 300_000,
});
const contributors = z.record(z.string(), n).nullish();
export const batterySpec = (date: string) => ({
  path: '/api/body-battery',
  partition: date,
  ttl: 300_000,
  schema: z
    .object({
      current: z.number().finite(),
      label: z.string(),
      trend: z.enum(['charging', 'draining', 'steady']),
      anchor: z.number().finite(),
      anchorSource: z.enum(['readiness', 'sleep', 'default']),
      anchorProvisional: z.boolean(),
      charged: z.number().finite(),
      drained: z.number().finite(),
      hasData: z.boolean(),
      series: z.array(z.object({ t: z.number().finite(), v: z.number().finite() })),
      confidence: z
        .object({ sufficient: z.boolean(), sampleCount: n, samplesPerHour: n })
        .passthrough()
        .optional(),
      stress: z
        .object({ current: n, highMinutes: n, extraDrained: n })
        .passthrough()
        .nullish(),
    })
    .passthrough(),
});
export const stressSpec = (date: string) => ({
  path: '/api/body-battery/stress-day',
  query: { date },
  ttl: 300_000,
  schema: z.object({
    date: z.string(),
    throughMs: n,
    series: z.array(z.object({ t: z.number().finite(), level: z.number().min(-1).max(1) })),
  }),
});
export const readinessSpec = (date: string) => ({
  path: '/api/readiness-score',
  partition: date,
  ttl: 300_000,
  schema: z
    .object({
      ...numericFields([
        'readinessDisplayScore',
        'sleepScore',
        'activityScore',
        'baselineHrv',
        'recentHrv',
        'restingHr',
        'restingHrLastNight',
        'restingHrBaseline',
        'hrCurrent',
        'hrMin',
        'hrAvg',
        'hrMax',
        'vo2Max',
        'vascularAge',
        'temperatureDeviation',
        'stressHigh',
        'recoveryHigh',
        'ownResilienceLevel',
      ] as const),
      readinessContributors: contributors,
      sleepContributors: contributors,
      activityContributors: contributors,
      readinessCompositeContributors: z
        .record(z.string(), z.object({ score: z.number().finite(), provisional: z.boolean() }))
        .nullish(),
      sleepScoreCoverage: z
        .object({
          ratio: z.number(),
          missing: z.array(z.string()),
          level: z.enum(['full', 'partial', 'low']),
        })
        .nullish(),
      limited: z.boolean().optional(),
      isLowWearToday: z.boolean().optional(),
      inputsMissing: z.array(z.string()).optional(),
      illnessAdvisory: text,
      illnessFlag: text,
      illnessSuppression: n,
      earlyDeloadRecommended: z.boolean().optional(),
      earlyDeload: z
        .object({
          score: z.number(),
          acwr: z.number(),
          scoreThreshold: z.number(),
          acwrThreshold: z.number(),
        })
        .nullish(),
      ownResilienceBand: text,
      ownResilienceAsOf: text,
      ownResilienceConfidence: n,
      ownResilienceUnavailable: z
        .object({
          daysSeen: z.number(),
          daysMeetingCoverageGate: n,
          coverageGateMinutes: n,
          minValidDays: n,
          modelWindowDays: n,
        })
        .nullish(),
      cloudVitalsDate: text,
      availability: z
        .array(
          z
            .object({ metric: z.string(), state: z.string(), gap: z.unknown().nullish() })
            .passthrough(),
        )
        .optional(),
      activitySignals: z
        .object({
          ...numericFields([
            'steps',
            'activeCalories',
            'zoneMinutes',
            'moveHours',
            'sessions7d',
            'volume7dKg',
          ] as const),
        })
        .nullish(),
      activityGoals: z
        .object({
          ...numericFields([
            'stepGoal',
            'activeEnergyGoal',
            'zoneMinutesGoal',
            'moveHoursGoal',
            'strengthFreqGoal',
            'sessionVolumeGoalKg',
          ] as const),
        })
        .passthrough()
        .nullish(),
    })
    .passthrough(),
});
export const trendsSpec = (date: string) => ({
  path: '/api/health/trends',
  partition: date,
  ttl: 900_000,
  schema: z.object({
    trends: z.array(
      z.object({
        date: z.string(),
        ...numericFields([
          'readinessScore',
          'sleepScore',
          'activityScore',
          'hrvMs',
          'rhrBpm',
          'hrr1Bpm',
          'wornHours',
          'sessionDurationMin',
          'workoutDensity',
          'proteinPerKg',
          'steps',
          'waterMl',
          'temperatureDeviation',
        ] as const),
      }),
    ),
  }),
});
export const hrSpec = (date: string) => ({
  path: '/api/oura/hr-day',
  query: { date },
  ttl: 300_000,
  schema: z
    .object({
      readings: z
        .array(z.object({ timestamp: z.string(), bpm: z.number().finite(), source: text }))
        .default([]),
      sleep: z
        .object({ startMin: z.number().finite(), endMin: z.number().finite() })
        .nullish(),
    })
    .passthrough(),
});
export const loadSpec = {
  path: '/api/training-load',
  ttl: 300_000,
  schema: z.object({
    acwr: n,
    acuteLoad: n,
    chronicLoad: n,
    monotony: n,
    strain: n,
    interpretation: z.string(),
    baselineDaysRemaining: n,
  }),
};
export const muscleSetsSpec = {
  path: '/api/weekly-muscle-sets',
  ttl: 300_000,
  schema: z.object({
    muscles: z.array(z.object({ muscle: z.string(), sets: z.number().finite(), target: n })),
    weekStart: z.string(),
    phase: z.object({ scale: n, dominant: text }).passthrough().optional(),
  }),
};
export const recoverySpec = {
  path: '/api/muscle-recovery',
  ttl: 300_000,
  schema: z.object({
    muscles: z.array(z.object({ muscle: z.string(), pct: z.number().finite(), hoursAgo: n })),
  }),
};
export const energySpec = (date: string) => ({
  path: '/api/nutrition/energy-balance',
  query: { date },
  ttl: 300_000,
  schema: z
    .object({
      date: z.string(),
      missingProfileFields: z.array(z.string()).default([]),
      maintenance: z
        .object({
          kcal: z.number().finite(),
          source: z.enum(['calibrated', 'formula']),
          confidence: z.string().nullable(),
          daysLogged: z.number(),
          daysInWindow: z.number(),
          weightRateKgPerWeek: n,
          gapMessage: text,
          doseCaveat: text,
        })
        .passthrough()
        .nullish(),
      target: z
        .object({ recommendedKcal: n, currentKcal: n, driftsFromRecommendation: z.boolean() })
        .nullish(),
      macroTargets: z
        .object({
          base: z.object({ proteinG: z.number(), carbsG: z.number(), fatG: z.number() }),
          scaled: z.object({ proteinG: z.number(), carbsG: z.number(), fatG: z.number() }),
          earnedKcal: z.number(),
        })
        .nullish(),
      activeBreakdown: z
        .object({
          workoutKcal: z.number().finite(),
          activityKcal: z.number().finite(),
          stepsKcal: z.number().finite(),
          workoutKcalBySession: z
            .array(
              z.object({
                id: z.string(),
                kcal: z.number().finite(),
                source: z.enum(['hr', 'met']),
              }),
            )
            .default([]),
        })
        .nullish(),
      balance: z
        .object({
          ...numericFields([
            'intakeKcal',
            'expenditureKcal',
            'remainingKcal',
            'activeKcal',
            'restingBaseKcal',
            'restingRateKcal',
            'netKcal',
            'budgetKcal',
          ] as const),
          zoneLabel: text,
          restingRateSource: text,
          restingRateMeasuredOn: text,
        })
        .passthrough()
        .nullable(),
    })
    .passthrough(),
});
export const correlationSpec = (view: string) => ({
  path: '/api/health-trends',
  query: { view },
  ttl: 900_000,
  schema: z
    .object({
      insight: z.string(),
      hasSufficientData: z.boolean(),
      buckets: z.array(z.object({ label: z.string(), avg: n, count: z.number().finite() })),
      // Session effort is a bar per session (effort x minutes), not buckets.
      series: z
        .array(
          z
            .object({
              date: z.string(),
              sessionRpe: z.number().finite(),
              sessionLoad: z.number().finite(),
            })
            .passthrough(),
        )
        .optional(),
      // Rest discipline only: each logged set's prescribed and taken rest, for the plan-vs-actual
      // summary under the bars.
      restSets: z
        .array(
          z.object({
            plannedRestSec: z.number().finite().nullable(),
            restTimeSec: z.number().finite().nullable(),
          }),
        )
        .optional(),
    })
    .passthrough(),
});
export const goalsSpec = {
  path: '/api/user/goals',
  ttl: 300_000,
  schema: z
    .object({
      ...numericFields([
        'targetWeightKg',
        'targetBfPct',
        'waterGoalMl',
        'stepsGoal',
        'sleepGoalHours',
      ] as const),
    })
    .passthrough(),
};
export const progressSpec = {
  path: '/api/progress-summary',
  ttl: 300_000,
  schema: z.object({
    sleep: z.object({ lastNightHours: n, thisWeekHours: n }),
    workouts: z.object({
      todayComplete: z.boolean(),
      completedThisWeek: z.number(),
      scheduledThisWeek: z.number(),
    }),
    bodyBaseline: z.object({ weightKg: n, bodyFatPct: n }),
    weightRateKgPerWeek: n,
  }),
};
export const zoneSpec = (from: string, to: string) => ({
  path: '/api/zone-minutes',
  query: { from, to },
  ttl: 900_000,
  schema: z.object({
    profile: z
      .object({
        maxHr: z.number(),
        restingHr: z.number(),
        maxHrSource: text.optional(),
        restingHrSource: text.optional(),
      })
      .passthrough(),
    hasHrSource: z.boolean().nullish(),
    days: z.array(
      z.object({ day: z.string(), seconds: z.array(z.number().nonnegative()).length(5) }),
    ),
  }),
});
export const sleepCorrelationSpec = {
  path: '/api/sleep-performance-correlation',
  ttl: 900_000,
  schema: z.object({
    insight: z.string(),
    hasSufficientData: z.boolean(),
    buckets: z.array(
      z.object({ label: z.string(), avgPctChange: z.number(), count: z.number() }),
    ),
  }),
};
export const hrProfileSpec = {
  path: '/api/hr-profile',
  ttl: 86_400_000,
  schema: z
    .object({
      maxHr: n,
      restingHr: n,
      estimatedMax: n,
      workingMax: n,
      workingMaxSource: z.string(),
      observed: z
        .object({
          max: n,
          min: n,
          avg: n,
          isReliable: z.boolean(),
          highestPlausible: n,
          outOfBandRejected: n,
        })
        .passthrough(),
    })
    .passthrough(),
};
export const profileSpec = {
  path: '/api/user/profile',
  ttl: 3_600_000,
  schema: z
    .object({
      user: z
        .object({
          heightCm: n,
          sex: text,
          name: text,
          displayName: text,
          avatar: text,
          activityLevel: text,
          fitnessGoal: text,
          lastGoalReviewAt: text,
        })
        .passthrough(),
    })
    .passthrough(),
};
export const weightsSpec = {
  path: '/api/weights-summary',
  ttl: 300_000,
  schema: z.object({
    phaseName: text,
    cycleLabel: text,
    exercises: z.array(
      z.object({
        exercise: z.string(),
        sessionName: z.string(),
        exerciseType: z.enum(['weighted', 'bodyweight']),
        ...numericFields([
          'weight',
          'estimated1rm',
          'previousEstimated1rm',
          'target80',
          'personalRecord1rm',
          'lastReps',
          'maxReps',
        ] as const),
        date: text,
      }),
    ),
  }),
};
export const activityHistorySpec = {
  path: '/api/activity-logs',
  query: { days: '30' },
  ttl: 300_000,
  schema: z.object({
    activityLogs: z.array(
      z
        .object({
          id: z.string(),
          date: z.string(),
          activityType: z.string(),
          durationMin: n,
          distanceKm: n,
          title: text,
          startTime: text,
          notes: text,
          source: text,
          endTime: text,
          cadenceSource: text,
          cadenceSpm: n,
          elevationLossM: n,
          paceSeries: z
            .array(z.object({ tSec: z.number().finite(), paceSec: z.number().finite() }))
            .nullish(),
          cadenceSeries: z
            .array(z.object({ tSec: z.number().finite(), spm: z.number().finite() }))
            .nullish(),
          splits: z
            .array(z.object({ km: z.number().finite(), paceSec: z.number().finite() }))
            .nullish(),
          elevationProfile: z
            .array(z.object({ distKm: z.number().finite(), eleM: z.number().finite() }))
            .nullish(),
          ...numericFields([
            'caloriesBurned',
            'avgPaceSecPerKm',
            'avgHr',
            'maxHr',
            'steps',
            'elevationGainM',
          ] as const),
        })
        .passthrough(),
    ),
  }),
};
export const movementSpec = (from: string, to: string) => ({
  path: '/api/muscle-sets',
  query: { from, to },
  ttl: 900_000,
  schema: z.object({
    muscles: z.array(z.object({ muscle: z.string(), sets: z.number().finite() })),
  }),
});
export const overviewSpec = {
  path: '/api/ai-periodization/program-overview',
  ttl: 300_000,
  schema: z
    .object({
      sessions: z.array(
        z
          .object({
            sessionId: z.string(),
            sessionName: z.string(),
            lastTrainedDaysAgo: n,
            state: z
              .object({
                phase: z.string().optional(),
                currentPhase: z.string().optional(),
                sessionsInPhase: n,
                baselineComplete: z.boolean().nullish(),
                cycle: n,
              })
              .passthrough()
              .nullish(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};
export const healthDaySpec = daySpec;
export const healthDaySchema = z
  .object({
    date: z.string(),
    exercises: z.array(dayExerciseSchema),
    bodyMeta: bodySchema.omit({ date: true }).nullish(),
    sleep: sleepSchema
      .omit({ date: true })
      .transform((row) => ({
        ...row,
        awakHours: typeof row.awakeHours === 'number' ? row.awakeHours : row.awakHours,
      }))
      .nullish(),
    scores: z.object({ readiness: n, sleep: n, activity: n }).nullish(),
    hr: z
      .array(z.object({ minute: z.number().finite(), bpm: z.number().finite() }))
      .default([]),
    bodyTemp: z.object({ meanC: n, devC: n }).nullish(),
    activityLogs: activityHistorySpec.schema.shape.activityLogs.default([]),
  })
  .passthrough();
const weekMetric = z
  .object({ week: n, priorWeek: n, byDay: z.array(z.object({ date: z.string(), value: n })) })
  .passthrough();
export const digestSpec = (week: string) => ({
  path: '/api/weekly-digest',
  partition: week,
  ttl: 3_600_000,
  schema: z.object({
    digest: z.string(),
    weekStart: z.string(),
    metrics: z
      .object({
        weekStart: z.string(),
        weekEnd: z.string(),
        training: z.object({
          sessions: z.number(),
          volumeKg: z.number(),
          volumeChangePct: n,
          priorVolumeKg: n,
          priorSessions: n,
          byDay: z.array(
            z.object({ date: z.string(), volumeKg: z.number(), sessions: z.number() }),
          ),
        }),
        muscleSets: z.array(z.object({ muscle: z.string(), sets: z.number() })),
        prs: z.array(z.object({ exerciseName: z.string(), description: z.string() })),
        hrv: weekMetric,
        readiness: weekMetric,
        sleepScore: weekMetric,
        sleepHours: weekMetric,
        stressHighMinutes: weekMetric,
      })
      .passthrough()
      .optional(),
  }),
});
const monthPoint = z.object({
  ...numericFields(['restingHeartRate', 'steps', 'sessionVolumeKg', 'weightKg'] as const),
});
export const monthWindowSpec = (week: string) => ({
  path: '/api/weekly-review/month-window',
  query: { weekStart: week },
  ttl: 300_000,
  schema: z.object({
    weekStart: z.string(),
    weeks: z.array(monthPoint.extend({ weekStart: z.string() })),
    priorAverages: monthPoint,
  }),
});
export const foodTimelineSpec = (date: string) => ({
  path: '/api/nutrition/food-logs',
  query: { date },
  ttl: 300_000,
  schema: z.array(z.object({ loggedAt: z.string(), calories: z.number().finite() })),
});
export const doseVitalsSpec = {
  path: '/api/health/dose-vitals',
  query: { days: '60' },
  ttl: 300_000,
  schema: z.object({
    effectLookbackDays: z.number().int(),
    doses: z.array(
      z.object({
        supplementName: z.string(),
        date: z.string(),
        amount: z.number().finite(),
        unit: text,
      }),
    ),
    nights: z.array(
      z.object({
        date: z.string(),
        restingHr: n,
        hrvMs: n,
        restingHrBaseline: n,
        hrvBaseline: n,
      }),
    ),
  }),
};
// The screens' body-fat rule lives in packages/shared; this is the same function under the local name.
export { displayBodyFat as displayFat } from '@trainingai/shared/health/body-fat-display';
export function latestMetric(rows: BodyRow[], field: keyof BodyRow) {
  return (
    [...rows]
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((row) => typeof row[field] === 'number') ?? null
  );
}
export function metricValue(value: unknown, unit = '', decimals = 0) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}${unit ? ` ${unit}` : ''}`
    : '—';
}
