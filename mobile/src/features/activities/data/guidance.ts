import { activityPayload } from './models.ts';
import { z } from 'zod';
import { getProtocol, phasesTotalSec } from '@trainingai/shared/fitness-tests/protocols';
import { buildTestActivity } from '@trainingai/shared/fitness-tests/test-activity';
import {
  cooperVo2max,
  sixMwtVo2max,
  distanceCanBeScored,
  latestTestWeightKg,
  maxHrFrom,
  restingHrFrom,
  baselineHrr1,
} from '@trainingai/shared/health/fitness-tests';
import { computeTotalDistanceKm } from '@trainingai/shared/activity/route-metrics';
import { routeUntil } from '@trainingai/shared/activity/route-summary';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';
import { hrSamples, type HrWindow } from './hr-window.ts';
import { ageFromDob } from '@trainingai/shared/date-utils';
import { FitnessTestCreateBody } from '@trainingai/shared/validation/fitness-test';
import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import { clipSegmentsAt } from '@trainingai/shared/walking/clip-segments';
export const walkConfigSchema = z
  .object({
    sets: z.number().int().min(1).max(12),
    fastSec: z.number().int().min(0).max(1800),
    slowSec: z.number().int().min(0).max(1800),
    warmupSec: z.number().int().min(0).max(600),
    cooldownSec: z.number().int().min(0).max(600),
    treadmill: z.boolean(),
    fastCadenceSpm: z.number().min(60).max(200).default(120),
    slowCadenceSpm: z.number().min(40).max(160).default(95),
  })
  .refine((value) => value.fastSec + value.slowSec > 0, 'Add a fast or slow block.');
export type WalkConfig = z.infer<typeof walkConfigSchema>;
export const defaultWalk: WalkConfig = {
  sets: 5,
  fastSec: 180,
  slowSec: 180,
  warmupSec: 0,
  cooldownSec: 0,
  treadmill: false,
  fastCadenceSpm: 120,
  slowCadenceSpm: 95,
};
export const guidanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('walk'),
    config: walkConfigSchema,
    saved: z.boolean().default(false),
    // How many heart-rate readings the saved walk was built from, so a later, fuller window saves
    // it again and an unchanged one does not (#3641).
    hrReadings: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('test'),
    protocol: z.enum(['6mwt', 'cooper12', 'resting_hrr']),
    activityId: z.uuid(),
    countdownUntil: z.number(),
    restingHr: z.string().default(''),
    peakHr: z.string().default(''),
    recoveryHr: z.string().default(''),
    saved: z.boolean().default(false),
  }),
]);
export type Guidance = z.infer<typeof guidanceSchema>;
export function walkPlan(config: WalkConfig) {
  const segments: {
    index: number;
    setNumber: number;
    kind: 'warmup' | 'fast' | 'slow' | 'cooldown';
    startSec: number;
    endSec: number;
  }[] = [];
  let time = 0;
  function add(kind: (typeof segments)[number]['kind'], seconds: number, setNumber: number) {
    if (seconds <= 0) {
      return;
    }
    segments.push({
      index: segments.length,
      setNumber,
      kind,
      startSec: time,
      endSec: time + seconds,
    });
    time += seconds;
  }
  add('warmup', config.warmupSec, 0);
  for (let set = 1; set <= config.sets; set++) {
    add('slow', config.slowSec, set);
    add('fast', config.fastSec, set);
  }
  add('cooldown', config.cooldownSec, 0);
  return { segments, totalSec: time };
}
export function walkSegments(config: WalkConfig, elapsed: number) {
  return clipSegmentsAt(walkPlan(config).segments, elapsed).map((segment) => ({
    ...segment,
    avgHr: null,
    maxHr: null,
    hrAtStart: null,
    avgPaceSecPerKm: null,
    distanceKm: null,
    avgCadenceSpm: null,
    steps: null,
  }));
}
export function testDuration(protocolId: string) {
  const protocol = getProtocol(protocolId)!;
  return protocol.durationSec ?? phasesTotalSec(protocol.phases ?? []);
}
export const fitnessPayloadSchema = FitnessTestCreateBody.safeExtend({ id: z.uuid() });
export type FitnessPayload = z.infer<typeof fitnessPayloadSchema>;
export type FitnessProfile = {
  age?: number | null;
  sex?: string | null;
  weightKg?: number | null;
  restingHr?: number | null;
};
/**
 * A test's profile terms as the current app's baselines page builds them (#3640): the newest
 * weigh-in in the 30 days to `today`, not only today's, and the HR profile's resting HR (the
 * `resolveHrProfile` value `/api/hr-profile` serves), not today's ring reading.
 */
export function testProfile(input: {
  today: string;
  now: Date;
  dateOfBirth?: string | null;
  sex?: string | null;
  body?: {
    today?: { weightKg?: number | null } | null;
    latestWeightKg?: number | null;
    latestWeightDate?: string | null;
  } | null;
  hrProfile?: { restingHr?: number | null } | null;
}): FitnessProfile {
  const body = input.body;
  return {
    age: ageFromDob(input.dateOfBirth ?? null, input.now),
    sex: input.sex ?? null,
    weightKg: latestTestWeightKg(
      [
        { date: input.today, weightKg: body?.today?.weightKg },
        ...(body?.latestWeightDate
          ? [{ date: body.latestWeightDate, weightKg: body.latestWeightKg }]
          : []),
      ],
      input.today,
    ),
    restingHr: input.hrProfile?.restingHr ?? null,
  };
}
/**
 * A test's result as the current app's `test-result.tsx` computes it, once, from what was recorded
 * (#3641): avg and max HR from the strap's or ring's readings over the test (`maxHrFrom`, so a spike
 * cannot set the peak), resting HR and 1-minute recovery from the same readings for the HRR test
 * (`restingHrFrom`, `baselineHrr1`), and a distance test's distance from its GPS route. A value typed
 * on the result screen overrides the recorded one; with nothing recorded and nothing typed it is left out.
 */
export function fitnessResult(
  session: {
    id: string;
    startMs: number | null;
    endMs: number | null;
    distance: string;
    notes: string;
    guidance?: Guidance;
  },
  timezone: string,
  profile: FitnessProfile,
  recorded: { hr?: HrWindow | null; route?: RoutePoint[] } = {},
) {
  if (session.guidance?.kind !== 'test' || session.startMs === null || session.endMs === null) {
    throw new Error('Finish the test first.');
  }
  const guidance = session.guidance,
    protocol = getProtocol(guidance.protocol)!;
  const durationSec = Math.floor((session.endMs - session.startMs) / 1000);
  const typedDistanceM = session.distance.trim()
    ? Number(session.distance.replace(',', '.')) * 1000
    : undefined;
  if (typedDistanceM !== undefined && (!Number.isFinite(typedDistanceM) || typedDistanceM < 0)) {
    throw new Error('Enter a valid distance.');
  }
  // Only the fixes up to the test's end (#3684): the finish runs from the screen's timer, and with
  // the phone locked the location task keeps adding the distance covered after the end.
  const route = routeUntil(recorded.route ?? [], session.endMs);
  // Whole metres, as the current app saves its GPS distance.
  const gpsDistanceM =
    protocol.captureDistance && route.length >= 2
      ? Math.round(computeTotalDistanceKm(route) * 1000)
      : undefined;
  const distanceM = typedDistanceM ?? gpsDistanceM;
  const early = durationSec < testDuration(protocol.id) * 0.9;
  const scoreable =
    !early &&
    distanceM !== undefined &&
    protocol.vo2Equation &&
    distanceCanBeScored(protocol.vo2Equation, distanceM);
  const vo2maxEst = scoreable
    ? protocol.vo2Equation === 'cooper'
      ? cooperVo2max(distanceM!)
      : sixMwtVo2max({
          distanceM: distanceM!,
          age: profile.age ?? null,
          sex: profile.sex ?? null,
          weightKg: profile.weightKg ?? null,
          restingHr: profile.restingHr ?? null,
        })
    : null;
  const bpm = (value: string) =>
    value.trim() ? z.number().int().min(30).max(220).parse(Number(value)) : undefined;
  const readings = hrSamples(recorded.hr)
    .filter((sample) => sample.at >= session.startMs! && sample.at <= session.endMs!)
    .map((sample) => ({ timestamp: new Date(sample.at), bpm: sample.bpm }));
  const sensorAvg = readings.length
    ? Math.round(readings.reduce((sum, reading) => sum + reading.bpm, 0) / readings.length)
    : undefined;
  const sensorMax = maxHrFrom(readings) ?? undefined;
  const typedResting = bpm(guidance.restingHr),
    typedPeak = bpm(guidance.peakHr),
    typedRecovery = bpm(guidance.recoveryHr);
  const typed = typedResting !== undefined || typedPeak !== undefined || typedRecovery !== undefined;
  const maxHr = typedPeak ?? sensorMax;
  const restingHr = protocol.captureHrr
    ? (typedResting ?? restingHrFrom(readings) ?? undefined)
    : undefined;
  const hrr1Bpm = protocol.captureHrr
    ? typedPeak !== undefined && typedRecovery !== undefined
      ? typedPeak - typedRecovery
      : typedPeak === undefined && typedRecovery === undefined
        ? (baselineHrr1(readings) ?? undefined)
        : undefined
    : undefined;
  const method = protocol.captureHrr
    ? typed
      ? 'manual_hrr'
      : undefined
    : vo2maxEst != null && vo2maxEst > 0
      ? protocol.vo2Equation === 'cooper'
        ? 'cooper_1968'
        : profile.age != null &&
            profile.weightKg != null &&
            profile.restingHr != null &&
            ['male', 'female'].includes(profile.sex ?? '')
          ? 'burr_2011'
          : 'ross_2010'
      : 'manual_distance_unscored';
  const payload = fitnessPayloadSchema.parse({
    id: session.id,
    testType: protocol.id,
    date: toAestDay(new Date(session.startMs), timezone),
    durationSec,
    ...(distanceM !== undefined ? { distanceM } : {}),
    ...(sensorAvg !== undefined ? { avgHr: sensorAvg } : {}),
    ...(maxHr !== undefined ? { maxHr } : {}),
    ...(restingHr !== undefined ? { restingHr } : {}),
    ...(hrr1Bpm !== undefined ? { hrr1Bpm } : {}),
    ...(vo2maxEst != null && vo2maxEst > 0 ? { vo2maxEst } : {}),
    ...(method ? { method } : {}),
    ...(session.notes.trim() ? { notes: session.notes.trim() } : {}),
  });
  const draft = buildTestActivity({
    protocol,
    startMs: session.startMs,
    endMs: session.endMs,
    distanceM: distanceM ?? 0,
    avgHr: payload.avgHr ?? null,
    maxHr: payload.maxHr ?? null,
  });
  const activity = draft
    ? activityPayload.parse({
        ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value != null)),
        id: guidance.activityId,
        date: payload.date,
        startTime: msToHHMMInTz(session.startMs, timezone),
        endTime: msToHHMMInTz(session.endMs, timezone),
        ...(draft.distanceKm === 0 ? { distanceKm: undefined } : {}),
      })
    : null;
  return { payload, activity, early, scoreable: !!scoreable, gpsDistanceM };
}

export function treadmillSteps(
  distanceKm: number | undefined,
  heightCm: number | null | undefined,
) {
  if (distanceKm == null || distanceKm <= 0 || heightCm == null || heightCm <= 0) {
    return null;
  }
  return Math.round((distanceKm * 1000) / ((heightCm / 100) * 0.415));
}
