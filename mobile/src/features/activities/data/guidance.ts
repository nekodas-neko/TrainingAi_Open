import { activityPayload } from './models.ts';
import { z } from 'zod';
import { getProtocol, phasesTotalSec } from '@trainingai/shared/fitness-tests/protocols';
import { buildTestActivity } from '@trainingai/shared/fitness-tests/test-activity';
import {
  cooperVo2max,
  sixMwtVo2max,
  distanceCanBeScored,
} from '@trainingai/shared/health/fitness-tests';
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
) {
  if (session.guidance?.kind !== 'test' || session.startMs === null || session.endMs === null) {
    throw new Error('Finish the test first.');
  }
  const guidance = session.guidance,
    protocol = getProtocol(guidance.protocol)!;
  const durationSec = Math.floor((session.endMs - session.startMs) / 1000);
  const distanceM = session.distance.trim()
    ? Number(session.distance.replace(',', '.')) * 1000
    : undefined;
  if (distanceM !== undefined && (!Number.isFinite(distanceM) || distanceM < 0)) {
    throw new Error('Enter a valid distance.');
  }
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
  const restingHr = bpm(guidance.restingHr),
    maxHr = bpm(guidance.peakHr),
    recovery = bpm(guidance.recoveryHr);
  const hrr1Bpm = maxHr !== undefined && recovery !== undefined ? maxHr - recovery : undefined;
  const payload = fitnessPayloadSchema.parse({
    id: session.id,
    testType: protocol.id,
    date: toAestDay(new Date(session.startMs), timezone),
    durationSec,
    ...(distanceM !== undefined ? { distanceM } : {}),
    ...(protocol.captureHrr ? { restingHr, maxHr, hrr1Bpm } : {}),
    ...(vo2maxEst != null && vo2maxEst > 0
      ? {
          vo2maxEst,
          method:
            protocol.vo2Equation === 'cooper'
              ? 'cooper_1968'
              : profile.age != null &&
                  profile.weightKg != null &&
                  profile.restingHr != null &&
                  ['male', 'female'].includes(profile.sex ?? '')
                ? 'burr_2011'
                : 'ross_2010',
        }
      : { method: 'manual_distance_unscored' }),
    ...(protocol.captureHrr ? { method: 'manual_hrr' } : {}),
    ...(session.notes.trim() ? { notes: session.notes.trim() } : {}),
  });
  const draft = buildTestActivity({
    protocol,
    startMs: session.startMs,
    endMs: session.endMs,
    distanceM: distanceM ?? 0,
    avgHr: null,
    maxHr: null,
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
  return { payload, activity, early, scoreable: !!scoreable };
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
