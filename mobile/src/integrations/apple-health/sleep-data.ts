import {
  appleSleepNights as groupAppleSleep,
  type SleepSample,
} from '@trainingai/shared/health/apple-sleep';
import { sleepSchema, type SleepRow } from '../../features/health/data/models.ts';
export type { SleepSample };
export function appleSleepNights(
  samples: readonly SleepSample[],
  timezone: string,
  now = Date.now(),
) {
  return groupAppleSleep(samples, timezone, now).map((night) => sleepSchema.parse(night));
}
export function mergeAppleSleep(server: readonly SleepRow[], local: readonly SleepRow[]) {
  const days = new Map(server.map((row) => [row.date, row]));
  for (const row of local) {
    const saved = days.get(row.date);
    if (!saved || saved.durationHours === null || saved.manualEntry) {
      days.set(row.date, row);
    }
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
