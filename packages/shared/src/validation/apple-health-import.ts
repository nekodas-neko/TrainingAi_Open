import { z } from 'zod';
import { HEALTH_IMPORT_MAX_INTERVAL_MS } from '../health/import-limits';

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
  .refine((row) => Date.parse(row.end) >= Date.parse(row.start) && Date.parse(row.end) - Date.parse(row.start) <= HEALTH_IMPORT_MAX_INTERVAL_MS, 'Invalid sample interval');
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

/** The outer shape of an Apple batch, with each sample left to be judged on its own. */
const appleImportEnvelope = z
  .object({
    type: appleSampleType,
    samples: z.array(z.unknown()).max(500),
    deleted: z.array(z.uuid()).max(500),
  })
  .strict();
export type AppleSampleRejection = { id: string | null; reason: string };

/**
 * #3045, the Apple twin of `splitHealthConnectBatch` (#2828 N3). Splits a `/api/apple-health/sync`
 * body into the samples that can be stored and the ones that cannot, with a reason each. Judged as a
 * whole, one sample the server refused (a newer server than the phone's bundle, say) failed all of it
 * with a 400, and the phone retried that same head-of-queue batch forever. Only a body that is not a
 * batch at all is `null`. The value checks are `appleImportBatch`'s per-type ones; a duplicate id keeps
 * its first copy and a sample also listed in `deleted` is refused, so what comes back always passes
 * `appleImportBatch`.
 */
export function splitAppleImportBatch(
  body: unknown,
): { batch: AppleImportBatch; rejected: AppleSampleRejection[] } | null {
  const envelope = appleImportEnvelope.safeParse(body);
  if (!envelope.success || new Set(envelope.data.deleted).size !== envelope.data.deleted.length)
    return null;
  const { type } = envelope.data;
  const deleted = new Set(envelope.data.deleted);
  const seen = new Set<string>();
  const samples: AppleImportBatch['samples'] = [];
  const rejected: AppleSampleRejection[] = [];
  for (const raw of envelope.data.samples) {
    const parsed = appleSample.safeParse(raw);
    if (!parsed.success) {
      const rawId = (raw as { id?: unknown } | null)?.id;
      rejected.push({
        id: z.uuid().safeParse(rawId).success ? (rawId as string) : null,
        reason: parsed.error.issues[0]?.message ?? 'Invalid sample',
      });
    } else if (
      parsed.data.value > appleTypes[type].max ||
      (type === 'HKCategoryTypeIdentifierSleepAnalysis' && !Number.isInteger(parsed.data.value))
    ) {
      rejected.push({ id: parsed.data.id, reason: 'Invalid measurement value' });
    } else if (seen.has(parsed.data.id)) {
      rejected.push({ id: parsed.data.id, reason: 'Duplicate record identity' });
    } else if (deleted.has(parsed.data.id)) {
      rejected.push({ id: parsed.data.id, reason: 'Record is also deleted in this batch' });
    } else {
      seen.add(parsed.data.id);
      samples.push(parsed.data);
    }
  }
  return { batch: { type, samples, deleted: envelope.data.deleted }, rejected };
}
