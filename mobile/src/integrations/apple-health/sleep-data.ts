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
/**
 * The phone's own Health Connect nights are a gap-filler: they are used only for dates the server
 * has no row for yet. A date the server already has is never replaced, even when that row has no
 * duration or was entered by hand, because the server projects the same Health Connect sleep into
 * `sleep_sessions` under its own precedence rules and a second merge here made the two apps show
 * different nights (issue 2906).
 */
export function mergeAppleSleep(server: readonly SleepRow[], local: readonly SleepRow[]) {
  const days = new Map(server.map((row) => [row.date, row]));
  for (const row of local) {
    if (!days.has(row.date)) days.set(row.date, row);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
