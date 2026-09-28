import type { HealthTrendDay } from "@/app/api/health/trends/route";

/** The fields a `TrendSparkline` can be pointed at. */
export type TrendField =
  | "readinessScore" | "sleepScore" | "activityScore" | "hrvMs" | "rhrBpm" | "hrr1Bpm"
  | "wornHours" | "sessionDurationMin" | "workoutDensity" | "proteinPerKg" | "steps"
  | "waterMl" | "temperatureDeviation";

export interface TrendSparklineCompared {
  trends: HealthTrendDay[];
  field: TrendField;
  label: string;
  color: string;
  unit?: string;
}

/**
 * Should `TrendSparkline` skip a re-render? (DV-12.)
 *
 * **Extracted so the cases that must NOT be skipped are unit-tested**, which is the repo's pattern for
 * a rule whose failure mode is silence: a comparator that returns `true` too eagerly does not crash,
 * it leaves a stale chart on screen, and that is invisible until someone notices the numbers are old.
 *
 * It compares only what the component READS — `date` and `day[field]`. A change to any other field is
 * correctly ignored, which is the whole point: five of these sit on the Health tab, each pointed at a
 * different metric, and a refetch that moves one must redraw one rather than five.
 */
export function trendSparklinePropsEqual(a: TrendSparklineCompared, b: TrendSparklineCompared): boolean {
  if (a.field !== b.field || a.label !== b.label || a.color !== b.color || a.unit !== b.unit) return false;
  if (a.trends === b.trends) return true;
  if (a.trends.length !== b.trends.length) return false;
  return a.trends.every((day, i) => {
    const other = b.trends[i];
    return day.date === other.date && day[a.field] === other[a.field];
  });
}
