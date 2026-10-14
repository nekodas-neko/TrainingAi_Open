import { z } from 'zod';
import { HEALTH_IMPORT_MAX_INTERVAL_MS } from '../health/import-limits';
export const healthConnectTypes = [
  'SleepSession',
  'HeartRate',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'Steps',
  'ActiveCaloriesBurned',
  'Weight',
] as const;
export type HealthConnectType = (typeof healthConnectTypes)[number];
const at = z.string().datetime({ offset: true });
const id = z.string().min(1).max(200);
const maxima = {
  Steps: 200000,
  ActiveCaloriesBurned: 20000,
  Weight: 500,
  RestingHeartRate: 300,
  HeartRateVariabilityRmssd: 1000,
} as const;
const MAX_RECORD_VALUE = Math.max(...Object.values(maxima));
export const healthConnectRecord = z
  .object({
    id,
    type: z.enum(healthConnectTypes),
    sourcePackage: z.string().min(1).max(200),
    modifiedAt: at,
    start: at,
    end: at,
    recordingMethod: z.number().int().min(0).max(3),
    deviceModel: z.string().max(200).optional(),
    deviceManufacturer: z.string().max(200).optional(),
    value: z.number().finite().nonnegative().max(MAX_RECORD_VALUE).optional(),
    points: z
      .array(z.object({ at, bpm: z.number().finite().min(20).max(300) }).strict())
      .max(20000)
      .optional(),
    stages: z
      .array(
        z
          .object({
            start: at,
            end: at,
            kind: z.enum(['unknown', 'awake', 'asleep', 'out_of_bed', 'light', 'deep', 'rem']),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const start = Date.parse(row.start),
      end = Date.parse(row.end);
    const max = maxima[row.type as keyof typeof maxima];
    if (
      end < start || end - start > HEALTH_IMPORT_MAX_INTERVAL_MS ||
      (max !== undefined && (row.value === undefined || row.value > max)) ||
      (row.type === 'Weight' && (row.value ?? 0) <= 0) ||
      (row.type === 'RestingHeartRate' && (row.value ?? 0) < 20) ||
      (row.type === 'HeartRateVariabilityRmssd' && (row.value ?? 0) <= 0) ||
      (row.type === 'Steps' && !Number.isInteger(row.value)) ||
      (row.type === 'HeartRate' && (!row.points || row.value !== undefined || row.stages)) ||
      (row.type === 'SleepSession' && (!row.stages || row.value !== undefined || row.points)) ||
      (max !== undefined && (row.points || row.stages)) ||
      row.points?.some((point) => Date.parse(point.at) < start || Date.parse(point.at) > end) ||
      row.stages?.some(
        (stage) =>
          Date.parse(stage.start) < start ||
          Date.parse(stage.end) > end ||
          Date.parse(stage.end) <= Date.parse(stage.start),
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid Health Connect measurement' });
    }
  });
export const healthConnectBatch = z
  .object({
    records: z.array(healthConnectRecord).max(100),
    deleted: z.array(id).max(500),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const records = new Set(batch.records.map((row) => row.id));
    if (
      records.size !== batch.records.length ||
      new Set(batch.deleted).size !== batch.deleted.length ||
      batch.deleted.some((key) => records.has(key))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate health record identity' });
    }
  });
export type HealthConnectRecord = z.infer<typeof healthConnectRecord>;
export type HealthConnectBatch = z.infer<typeof healthConnectBatch>;
