import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { DEFAULT_TZ, startOfWeekInTz, ageFromDob } from "@trainingai/shared/date-utils";
import { BodyMetadataPostSchema } from "@trainingai/shared/validation/body-metrics";
import { type Sex } from "@trainingai/shared/health/workout-energy";
import { computeActiveEnergy } from "@trainingai/shared/health/daily-energy";
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One day's body metadata.
const MAX_BODY_BYTES = 16 * 1024

// Reject an implausibly long session span (a midnight `startedAt` fallback + evening completion).
const MAX_PLAUSIBLE_SESSION_MIN = 240;

export interface BodyMetaRow {
  date: string;
  weightKg: number | null;
  bodyFat: number | null;
  calories: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  steps: number | null;
  distanceKm: number | null;
  restingHeartRate: number | null;
  hrvMs: number | null;
  spo2Pct: number | null;
  waterMl: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  hipCm: number | null;
  neckCm: number | null;
  // Direct-BLE scale composition (migration 155) — only ever set by a scale weigh-in.
  skeletalMusclePct: number | null;
  fatFreeMassKg: number | null;
  subcutaneousFatPct: number | null;
  visceralFatIndex: number | null;
  bodyWaterPct: number | null;
  muscleMassKg: number | null;
  boneMassKg: number | null;
  proteinPct: number | null;
  bmrKcal: number | null;
  metabolicAge: number | null;
}

// Calendar week-to-date sums (Monday in the user's timezone through today).
// Add a new field here + the corresponding `body_metrics` column to extend
// to other weekly-tracked metrics.
export interface WeekToDate {
  steps: number;
  calories: number;
  waterMl: number;
}

function toRow(m: { date: string; weightKg?: number; bodyFatPct?: number; calories?: number; proteinG?: number; carbsG?: number; fatG?: number; steps?: number; distanceKm?: number; restingHeartRate?: number; hrvMs?: number; spo2Pct?: number; waterMl?: number; waistCm?: number; chestCm?: number; armCm?: number; thighCm?: number; hipCm?: number; neckCm?: number; skeletalMusclePct?: number; fatFreeMassKg?: number; subcutaneousFatPct?: number; visceralFatIndex?: number; bodyWaterPct?: number; muscleMassKg?: number; boneMassKg?: number; proteinPct?: number; bmrKcal?: number; metabolicAge?: number }): BodyMetaRow {
  return {
    date:             m.date,
    weightKg:         m.weightKg         ?? null,
    bodyFat:          m.bodyFatPct        ?? null,
    calories:         m.calories          ?? null,
    protein:          m.proteinG          ?? null,
    carb:             m.carbsG            ?? null,
    fat:              m.fatG              ?? null,
    steps:            m.steps             ?? null,
    distanceKm:       m.distanceKm        ?? null,
    restingHeartRate: m.restingHeartRate  ?? null,
    hrvMs:            m.hrvMs             ?? null,
    spo2Pct:          m.spo2Pct           ?? null,
    waterMl:          m.waterMl          ?? null,
    waistCm:          m.waistCm          ?? null,
    chestCm:          m.chestCm          ?? null,
    armCm:            m.armCm            ?? null,
    thighCm:          m.thighCm          ?? null,
    hipCm:            m.hipCm            ?? null,
    neckCm:           m.neckCm           ?? null,
    skeletalMusclePct:  m.skeletalMusclePct  ?? null,
    fatFreeMassKg:      m.fatFreeMassKg      ?? null,
    subcutaneousFatPct: m.subcutaneousFatPct ?? null,
    visceralFatIndex:   m.visceralFatIndex   ?? null,
    bodyWaterPct:       m.bodyWaterPct       ?? null,
    muscleMassKg:       m.muscleMassKg       ?? null,
    boneMassKg:         m.boneMassKg         ?? null,
    proteinPct:         m.proteinPct         ?? null,
    bmrKcal:            m.bmrKcal            ?? null,
    metabolicAge:       m.metabolicAge       ?? null,
  };
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const from = formatInTimeZone(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");
  // Wider window purely to recover the LAST-KNOWN weight when nothing was logged in the last
  // 7 days — the card used to show "—" (7-day window) even though an older reading exists.
  const from180 = formatInTimeZone(new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");

  // Start of today in the user's timezone (UTC instant) — for today's completed workouts.
  const todayStartZoned = toZonedTime(now, tz);
  todayStartZoned.setHours(0, 0, 0, 0);
  const todayStartUtc = fromZonedTime(todayStartZoned, tz);

  const repo = await getRepository();
  const weekStartForFetch = startOfWeekInTz(tz);
  const [metrics, foodLogs, activityLogs, weekFoodSummary, weightHistory, todayWorkouts] = await Promise.all([
    repo.listBodyMetrics(userId, from, today),
    repo.listFoodLogs(userId, today).catch(() => []),
    repo.listActivityLogs(userId, weekStartForFetch, today).catch(() => []),
    repo.listFoodLogsSummary(userId, weekStartForFetch, today).catch(() => []),
    repo.listBodyMetrics(userId, from180, today).catch(() => []),
    repo.getWorkoutSessionsFrom(userId, todayStartUtc).catch(() => []),
  ]);

  // Newest row (by date) that actually carries a weight — the last-known value, however old.
  const latestWeightRow = [...weightHistory]
    .filter(m => m.weightKg != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const latestWeightKg = latestWeightRow?.weightKg ?? null;
  const latestWeightDate = latestWeightRow?.date ?? null;

  // Profile inputs for the active-energy estimator (below, after today's activity logs are in scope).
  const bodyWeightForEnergy = latestWeightKg ?? metrics.find(m => m.weightKg != null)?.weightKg ?? null;
  const ageYears = ageFromDob(session.user.dateOfBirth ?? null, now);
  const userSex = (session.user.sex === 'male' || session.user.sex === 'female') ? session.user.sex as Sex : null;

  // Steps logged against an activity (only treadmill sessions carry a step count —
  // walks/runs record distance, not steps) live in activity_logs, separate from the
  // pedometer/Health-Connect steps in body_metrics. Fold them into the day/week
  // totals so a treadmill walk counts toward the steps goal.
  const todayActivityLogs = activityLogs.filter(a => a.date === today);
  const todayActivitySteps = todayActivityLogs.reduce((sum, a) => sum + (a.steps ?? 0), 0);
  const weekActivitySteps = activityLogs.reduce((sum, a) => sum + (a.steps ?? 0), 0);

  const todayMetric = metrics.find(m => m.date === today);
  const recent = metrics.slice(0, 7).map(toRow);

  // Total active energy to add to the energy budget's "burned" — strength workouts + logged
  // activities (walk/run/cycle/…) + passive steps above a sedentary baseline, all net-of-rest via
  // the shared MET/Schofield estimator, de-duplicated so nothing is counted twice (see daily-energy).
  const activeEnergy = computeActiveEnergy({
    profile: { ageYears, weightKg: bodyWeightForEnergy, sex: userSex },
    strengthSessions: todayWorkouts
      .filter(ws => ws.completedAt != null)
      // Q-419: the session's own RPE decides the intensity tier, matching the done screen. Without it
      // this route reported a different burn for the same workout than the screen that logged it.
      .map(ws => ({ durationMin: (ws.completedAt!.getTime() - ws.startedAt.getTime()) / 60000, rpe: ws.sessionRpe ?? null })),
    activities: todayActivityLogs.map(a => ({ activityType: a.activityType, durationMin: a.durationMin ?? null, distanceKm: a.distanceKm ?? null })),
    pedometerSteps: todayMetric?.steps ?? null,
  });
  const activeEnergyKcalToday = activeEnergy.total;

  // Option 3: prefer food_logs totals for today if any entries exist,
  // otherwise fall back to body_metrics (Health Connect / MFP)
  let todayRow: BodyMetaRow | null = todayMetric ? toRow(todayMetric) : null;
  if (foodLogs.length > 0) {
    const totals = foodLogs.reduce(
      (acc, l) => ({
        calories: acc.calories + l.calories,
        protein:  acc.protein  + l.proteinG,
        carb:     acc.carb     + l.carbsG,
        fat:      acc.fat      + l.fatG,
      }),
      { calories: 0, protein: 0, carb: 0, fat: 0 },
    );
    todayRow = {
      ...(todayRow ?? { date: today, weightKg: null, bodyFat: null, steps: null, distanceKm: null, restingHeartRate: null, hrvMs: null, spo2Pct: null, waterMl: null, waistCm: null, chestCm: null, armCm: null, thighCm: null, hipCm: null, neckCm: null, skeletalMusclePct: null, fatFreeMassKg: null, subcutaneousFatPct: null, visceralFatIndex: null, bodyWaterPct: null, muscleMassKg: null, boneMassKg: null, proteinPct: null, bmrKcal: null, metabolicAge: null }),
      calories: Math.round(totals.calories),
      protein:  Math.round(totals.protein  * 10) / 10,
      carb:     Math.round(totals.carb     * 10) / 10,
      fat:      Math.round(totals.fat      * 10) / 10,
    };
  }

  const calsBurnedToday = todayActivityLogs.length > 0
    ? todayActivityLogs.reduce((sum, s) => sum + (s.caloriesBurned ?? 0), 0)
    : null;

  // Fold today's activity steps into the today row (surface them even when there's
  // no body_metrics row yet for the day).
  if (todayActivitySteps > 0) {
    todayRow = todayRow
      ? { ...todayRow, steps: (todayRow.steps ?? 0) + todayActivitySteps }
      : { date: today, weightKg: null, bodyFat: null, calories: null, protein: null,
          carb: null, fat: null, steps: todayActivitySteps, distanceKm: null,
          restingHeartRate: null, hrvMs: null, spo2Pct: null, waterMl: null,
          waistCm: null, chestCm: null, armCm: null, thighCm: null, hipCm: null, neckCm: null,
          skeletalMusclePct: null, fatFreeMassKg: null, subcutaneousFatPct: null, visceralFatIndex: null,
          bodyWaterPct: null, muscleMassKg: null, boneMassKg: null, proteinPct: null, bmrKcal: null, metabolicAge: null };
  }

  // Monday of this week is always within the `metrics` range (it's at most
  // 6 days before `today`, and `metrics` covers the last 7 days).
  const weekStart = weekStartForFetch;
  const weekRows = metrics.filter(m => m.date >= weekStart);

  // Use food_logs for weekly calorie total (accurate for in-app food logging).
  // For days without food_logs data, fall back to body_metrics (Health Connect).
  const daysWithFoodLogs = new Set(weekFoodSummary.map(r => r.date));
  const foodLogCalories = weekFoodSummary.reduce((sum, r) => sum + r.calories, 0);
  const metricsOnlyCalories = weekRows
    .filter(r => !daysWithFoodLogs.has(r.date))
    .reduce((sum, r) => sum + (r.calories ?? 0), 0);

  const weekToDate: WeekToDate = {
    steps: weekRows.reduce((sum, r) => sum + (r.steps ?? 0), 0) + weekActivitySteps,
    waterMl: weekRows.reduce((sum, r) => sum + (r.waterMl ?? 0), 0),
    calories: foodLogCalories + metricsOnlyCalories,
  };

  // Deliberate no-store, not the sibling SWR header: this payload folds live today
  // food/activity totals that must never be served stale — do not "fix" to SWR.
  return NextResponse.json(
    { today: todayRow, recent, weekToDate, calsBurnedToday, activeEnergyKcalToday, latestWeightKg, latestWeightDate },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodyMetadataPostSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const body = parsed.data;

  const postTz = session?.user?.timezone ?? DEFAULT_TZ;
  const date = body.localDate
    ? body.localDate.replace(/\//g, "-")
    : formatInTimeZone(new Date(), postTz, "yyyy-MM-dd");

  const repo = await getRepository();
  await repo.upsertBodyMetrics(userId, [{
    date,
    weightKg:   body.weightKg   ?? undefined,
    bodyFatPct: body.bodyFat    ?? undefined,
    calories:   body.calories   ?? undefined,
    proteinG:   body.protein    ?? undefined,
    carbsG:     body.carb       ?? undefined,
    fatG:       body.fat        ?? undefined,
    steps:      body.steps      ?? undefined,
    distanceKm: body.distanceKm ?? undefined,
    waistCm:    body.waistCm    ?? undefined,
    chestCm:    body.chestCm    ?? undefined,
    armCm:      body.armCm      ?? undefined,
    thighCm:    body.thighCm    ?? undefined,
    hipCm:      body.hipCm      ?? undefined,
    neckCm:     body.neckCm     ?? undefined,
  }], 'manual');

  return NextResponse.json({ success: true, date });
}
