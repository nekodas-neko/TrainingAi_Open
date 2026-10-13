import { isRunningInExpoGo } from 'expo';
import { appleSleepNights } from './sleep-data';
import { healthKit } from './healthKit.ios';
export async function readAppleSleep(timezone: string) {
  if (isRunningInExpoGo()) {
    return [];
  }
  const health = healthKit();
  if (!health.isHealthDataAvailable()) {
    return [];
  }
  const end = new Date();
  const rows = await health.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 5000,
    ascending: false,
    filter: { date: { startDate: new Date(end.getTime() - 72 * 3_600_000), endDate: end } },
  });
  if (rows.length >= 5000) {
    throw new Error('Sleep reading reached its record limit. Saved sleep has been kept.');
  }
  return appleSleepNights(
    rows.map((row) => ({
      start: row.startDate.getTime(),
      end: row.endDate.getTime(),
      value: row.value,
      source: row.sourceRevision.source.name,
      bundle: row.sourceRevision.source.bundleIdentifier,
    })),
    timezone,
    end.getTime(),
  );
}
