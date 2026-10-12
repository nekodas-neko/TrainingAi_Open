import { z } from 'zod';

export const appleTypes = {
  HKCategoryTypeIdentifierSleepAnalysis: { unit: null, max: 5 },
  HKQuantityTypeIdentifierHeartRate: { unit: 'count/min', max: 300 },
  HKQuantityTypeIdentifierRestingHeartRate: { unit: 'count/min', max: 300 },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { unit: 'ms', max: 1000 },
  HKQuantityTypeIdentifierStepCount: { unit: 'count', max: 200000 },
  HKQuantityTypeIdentifierActiveEnergyBurned: { unit: 'kcal', max: 20000 },
  HKQuantityTypeIdentifierBodyMass: { unit: 'kg', max: 500 },
} as const;
export type AppleSampleType = keyof typeof appleTypes;
export const APPLE_SAMPLE_MAX_VALUE=200000;
export const appleSampleType = z.enum(
  Object.keys(appleTypes) as [AppleSampleType, ...AppleSampleType[]],
);
export const appleSample = z
  .object({
    id: z.uuid(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    value: z.number().finite().nonnegative().max(APPLE_SAMPLE_MAX_VALUE),
    sourceBundleId: z.string().trim().min(1).max(200),
    sourceName: z.string().max(200),
    deviceName: z.string().max(200).nullish(),
    deviceModel: z.string().max(200).nullish(),
  })
  .strict()
  .refine((row) => Date.parse(row.end) >= Date.parse(row.start), 'Invalid sample interval');
export const appleImportBatch = z
  .object({
    type: appleSampleType,
    samples: z.array(appleSample).max(500),
    deleted: z.array(z.uuid()).max(500),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const ids = new Set(batch.samples.map((row) => row.id));
    if (
      ids.size !== batch.samples.length ||
      new Set(batch.deleted).size !== batch.deleted.length ||
      batch.deleted.some((id) => ids.has(id))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate record identity' });
    }
    for (const row of batch.samples) {
      if (
        row.value > appleTypes[batch.type].max ||
        (batch.type === 'HKCategoryTypeIdentifierSleepAnalysis' && !Number.isInteger(row.value))
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid measurement value' });
      }
    }
  });
export type AppleImportBatch = z.infer<typeof appleImportBatch>;
export type AppleSample = z.infer<typeof appleSample> & { type: AppleSampleType };
