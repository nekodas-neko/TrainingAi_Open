import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import type { LocalActivityLog, LocalBodyMetric } from "@/lib/local-store/types";
import { activityStepsForDayCount, withIndoorSteps } from "@trainingai/shared/health/activity-steps";

/**
 * What Home paints from the local store before `/api/body-metadata` answers: the recent rows,
 * today's row and the week so far. It mirrors the route's step fold through the same shared
 * builder, so the figure does not jump when the network answer lands.
 *
 * #3095: the week tile here already added treadmill steps while today's tile did not, so on a
 * treadmill day today's figure jumped on every revalidation. Every row now folds its day's indoor
 * steps through `withIndoorSteps`, and the week through `activityStepsForDayCount`.
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

/** `metrics` and `activities` are the live (non-deleted) local rows, `activities` covering the same days. */
export function localMetaSeed(
  metrics: readonly LocalBodyMetric[],
  activities: readonly LocalActivityLog[],
  today: string,
  weekStart: string,
): LocalMetaSeed {
  // Every row folds its own day's indoor steps, as the route's do: `deviceSteps` is set exactly when
  // `steps` stops being the device's own count.
  const rows = metrics.map(m => withIndoorSteps(toRow(m), activities.filter(a => a.date === m.date)));
  const week = metrics.filter(m => m.date >= weekStart);
  return {
    recent: rows,
    today: rows.find(r => r.date === today) ?? null,
    weekToDate: {
      steps: week.reduce((s, m) => s + (m.steps ?? 0), 0)
        + activityStepsForDayCount(activities.filter(a => a.date >= weekStart)),
      calories: week.reduce((s, m) => s + (m.calories ?? 0), 0),
      waterMl: week.reduce((s, m) => s + (m.waterMl ?? 0), 0),
    },
  };
}
