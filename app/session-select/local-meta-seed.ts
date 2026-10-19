import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import type { LocalActivityLog, LocalBodyMetric } from "@/lib/local-store/types";
import { activityStepsForDayCount, dayStepCount } from "@trainingai/shared/health/activity-steps";

/**
 * What Home paints from the local store before `/api/body-metadata` answers: the recent rows,
 * today's row and the week so far. It mirrors the route's step fold through the same shared
 * builder, so the figure does not jump when the network answer lands.
 *
 * #3095: the week tile here already added treadmill steps while today's tile did not, so on a
 * treadmill day today's figure jumped on every revalidation. Both go through `dayStepCount` /
 * `activityStepsForDayCount` now, and today's row carries `deviceSteps` as the route's does.
 *
 * calories is body_metrics-only here: the server additionally prefers food_logs' per-day total
 * over body_metrics on days that have one, which needs a food-item join this seed does not do —
 * so a food-logged day is undercounted until the network response replaces it. Real summed data,
 * possibly incomplete for a moment, never fabricated.
 */
export interface LocalMetaSeed {
  recent: BodyMetaRow[];
  today: BodyMetaRow | null;
  weekToDate: { steps: number; calories: number; waterMl: number };
}

function toRow(m: LocalBodyMetric): BodyMetaRow {
  return {
    date: m.date, weightKg: m.weightKg, bodyFat: m.bodyFatPct,
    calories: m.calories, protein: m.proteinG, carb: m.carbsG, fat: m.fatG,
    steps: m.steps, distanceKm: m.distanceKm,
    restingHeartRate: m.restingHeartRate, hrvMs: m.hrvMs, spo2Pct: m.spo2Pct,
    waterMl: m.waterMl, waistCm: m.waistCm, chestCm: m.chestCm, armCm: m.armCm,
    thighCm: m.thighCm, hipCm: m.hipCm, neckCm: m.neckCm,
    skeletalMusclePct: m.skeletalMusclePct, fatFreeMassKg: m.fatFreeMassKg,
    subcutaneousFatPct: m.subcutaneousFatPct, visceralFatIndex: m.visceralFatIndex,
    bodyWaterPct: m.bodyWaterPct, muscleMassKg: m.muscleMassKg, boneMassKg: m.boneMassKg,
    proteinPct: m.proteinPct, bmrKcal: m.bmrKcal, metabolicAge: m.metabolicAge,
  };
}

/** `metrics` and `activities` are the live (non-deleted) local rows; `activities` cover the week. */
export function localMetaSeed(
  metrics: readonly LocalBodyMetric[],
  activities: readonly LocalActivityLog[],
  today: string,
  weekStart: string,
): LocalMetaSeed {
  const todayMetric = metrics.find(m => m.date === today);
  const todayActivities = activities.filter(a => a.date === today);
  let todayRow = todayMetric ? toRow(todayMetric) : null;
  // Folded only where indoor steps exist, as the route does: `deviceSteps` is set exactly when
  // `steps` stops being the device's own count.
  if (todayRow && activityStepsForDayCount(todayActivities) > 0) {
    todayRow = { ...todayRow, steps: dayStepCount(todayRow.steps, todayActivities), deviceSteps: todayRow.steps };
  }
  const week = metrics.filter(m => m.date >= weekStart);
  return {
    recent: metrics.map(toRow),
    today: todayRow,
    weekToDate: {
      steps: week.reduce((s, m) => s + (m.steps ?? 0), 0)
        + activityStepsForDayCount(activities.filter(a => a.date >= weekStart)),
      calories: week.reduce((s, m) => s + (m.calories ?? 0), 0),
      waterMl: week.reduce((s, m) => s + (m.waterMl ?? 0), 0),
    },
  };
}
