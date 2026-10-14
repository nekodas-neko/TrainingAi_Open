import { isRunningInExpoGo } from 'expo';
import { healthKit } from './healthKit.ios';
import {
  appleTypes,
  appleSample,
  type AppleSampleType,
  type AppleImportBatch,
} from '@trainingai/shared/validation/apple-health-import';
export async function readAppleImportPage(
  type: AppleSampleType,
  from: string,
  anchor?: string,
) {
  if (isRunningInExpoGo()) {
    return null;
  }
  const health = healthKit();
  if (!health.isHealthDataAvailable() || !health.isObjectTypeAvailable(type)) {
    return null;
  }
  const options = { limit: 500, anchor, filter: { date: { startDate: new Date(from) } } };
  const page =
    type === 'HKCategoryTypeIdentifierSleepAnalysis'
      ? await health.queryCategorySamplesWithAnchor(type, options)
      : await health.queryQuantitySamplesWithAnchor(type, {
          ...options,
          unit: appleTypes[type].unit,
        });
  const deleted = page.deletedSamples.map((row) => row.uuid);
  const removed = new Set(deleted);
  let skipped = 0;
  const samples: AppleImportBatch['samples'] = [];
  for (const row of page.samples) {
    if (removed.has(row.uuid) || row.endDate.getTime() > Date.now()) {
      continue;
    }
    const parsed = appleSample.safeParse({
      id: row.uuid,
      start: row.startDate.toISOString(),
      end: row.endDate.toISOString(),
      value: 'quantity' in row ? row.quantity : row.value,
      sourceBundleId: row.sourceRevision.source.bundleIdentifier,
      sourceName: row.sourceRevision.source.name,
      deviceName: row.device?.name,
      deviceModel: row.device?.model,
    });
    if (parsed.success && parsed.data.value <= appleTypes[type].max) {
      samples.push(parsed.data);
    } else {
      skipped++;
    }
  }
  return {
    samples,
    deleted,
    anchor: page.newAnchor,
    more: page.samples.length >= 500,
    skipped,
  };
}
