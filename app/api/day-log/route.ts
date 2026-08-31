import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { fmtAest, DEFAULT_TZ, normalizeDateParam, dateStrMidnightInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { isTemperatureBaselineCentred } from '@trainingai/shared/health/temperature-baseline-health'
import { toZonedTime } from "date-fns-tz";
import type { ActivityLog } from "@trainingai/shared/types";
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { correctBodyFatPct } from '@trainingai/shared/health/body-fat-calibration'

export interface DayExercise {
  name: string;
  sessionName: string;
  weightKg: number | null;
  setWeights: number[];
  sets: number | null;
  reps: number[];
  timeToCompleteSet: number | null;
  loggedAt: string | null;
  exerciseLogId: string;
  workoutSessionId: string;
}

export interface DayBodyMeta {
  weightKg: number | null;
  /** The RAW stored reading — see `BodyMetaRow.bodyFat` for why it must stay raw (BF-2). */
  bodyFat: number | null;
  /** What to DISPLAY: the DEXA-corrected reading, or the raw one where no calibration applies. */
  bodyFatCorrected?: number | null;
  /** Whether a calibration applied. Not derivable from the two values — an offset can round to 0. */
  bodyFatIsCorrected?: boolean;
  calories: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  steps: number | null;
  distanceKm: number | null;
  // Scale composition (migration 155). `listBodyMetrics` has always returned these; the route
  // simply never mapped them, so the day sheet showed three of eleven available numbers.
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
  restingHeartRate: number | null;
  hrvMs: number | null;
  spo2Pct: number | null;
}

export interface DaySleep {
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakeHours: number | null;
  efficiency: number | null;
  onsetLatencySec: number | null;
  averageHrvMs: number | null;
  avgHeartRate: number | null;
  lowestHeartRate: number | null;
  sleepScore: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  /** 5-min stage codes, for the hypnogram. */
  sleepPhase5Min: string | null;
}

export interface DayScores {
  readiness: number | null;
  sleep: number | null;
  activity: number | null;
}

/** One bucket of the day's HR trace. Deliberately coarse — see DAY_HR_BUCKET_MIN. */
export interface DayHrPoint {
  /** Minutes past local midnight at the START of the bucket. */
  minute: number;
  bpm: number;
}

export interface WorkoutDuration {
  start: string;
  end: string;
  minutes: number;
}

/**
 * LB-25 — body temperature for the day.
 *
 * `meanC` is a measurement and is always given when the ring recorded one. **`devC` is not**: it is
 * a deviation from a baseline the app has demonstrably not centred, so it is gated on the same
 * condition the readiness ladder uses (see below) and reads `null` while that gate is shut.
 */
export interface DayBodyTemp {
  /** Mean skin temperature for the night, °C. */
  meanC: number | null;
  /** Deviation from the rolling baseline, °C. Null while the baseline is uncentred — see TN-6a. */
  devC: number | null;
}

export interface DayLogResult {
  date: string;
  exercises: DayExercise[];
  bodyMeta: DayBodyMeta | null;
  /** Keyed by `workout_sessions.id` — the identity that cannot collide (Q-362a). */
  workoutDurationsById: Record<string, WorkoutDuration | null>;
  activityLogs: ActivityLog[];
  sleep: DaySleep | null;
  scores: DayScores | null;
  bodyTemp: DayBodyTemp | null;
  /** Whole-day HR, bucketed. Empty when the day has no HR samples. */
  hr: DayHrPoint[];
}

/**
 * Bucket width for the day's HR trace, in minutes.
 *
 * The raw series is per-minute (~1,440 points/day). At the width this renders — a ~380dp strip —
 * that is roughly four samples per pixel, so the extra resolution is invisible and the payload is
 * ~30x larger than it needs to be on a screen the user swipes between days. 15 minutes gives 96
 * points, which still shows the shape of a workout and the overnight trough.
 */
// Not exported: a Next.js route module may only export its handlers and a fixed set of config
// fields, and a stray value export fails the build (`"X" is not a valid Route export field`).
// Nothing outside this file needs the number — the client renders whatever buckets it is given.
const DAY_HR_BUCKET_MIN = 15;

const fmtMs = fmtAest;

export async function GET(req: NextRequest) {
  // Auth first, then the parameter (Q-454). Answering "Missing date" to an anonymous caller tells
  // them the route's contract before it tells them they may not use it. No data leaked today —
  // the pre-auth code only read a search param — but the rule is that security checks fail first,
  // and it is cheap now and expensive the day a param handler above this line touches the DB.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawDate = searchParams.get("date");
  if (!rawDate) return NextResponse.json({ error: "Missing date" }, { status: 400 });
  // Accept "YYYY-MM-DD" or "YYYY/MM/DD" and reject malformed dates with a 400 —
  // an unvalidated param reached getDayLog's date.split('/') and threw
  // "Invalid time value" (a 500) on any non-slash or impossible date.
  const date = normalizeDateParam(rawDate);
  if (!date) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const repo = await getRepository();
  const userTz = session.user?.timezone ?? DEFAULT_TZ;
  const workoutSessions = await repo.getDayLog(userId, date, userTz);

  const exercises: DayExercise[] = workoutSessions.flatMap(ws =>
    ws.exercises.map(el => ({
      name: el.exerciseName,
      sessionName: ws.sessionName,
      weightKg: el.sets[0]?.weightKg ?? null,
      setWeights: el.sets.map(s => s.weightKg),
      sets: el.sets.length || null,
      reps: el.sets.map(s => s.reps),
      timeToCompleteSet: el.timeToComplete ?? null,
      loggedAt: el.loggedAt.toISOString(),
      exerciseLogId: el.id,
      workoutSessionId: ws.id,
    }))
  );

  // Per-session workout durations, keyed by session id — a name is not an identity, and two `Push`
  // sessions on one day left a single key holding only the later window (Q-362a). The name-keyed
  // record that used to sit beside this one is gone: Q-362b moved all three consumers to it, and
  // LA-15 removed the legacy half once they had (verified by reading them, not by the entry's
  // absence).
  const workoutDurationsById: Record<string, WorkoutDuration | null> = {};
  for (const ws of workoutSessions) {
    const timedExercises = ws.exercises
      .filter(e => e.loggedAt)
      .map(e => ({ t: e.loggedAt.getTime(), dur: (e.timeToComplete ?? 0) * 1000 }));
    if (timedExercises.length === 0) {
      workoutDurationsById[ws.id] = null;
      continue;
    }
    // Check if startedAt is more than 1 minute into the local day (not UTC midnight).
    // Old workouts stored aestMidnight (14:00 UTC) must not be treated as a real start.
    const tz = session.user.timezone ?? DEFAULT_TZ;
    const startedAtLocal = toZonedTime(ws.startedAt, tz);
    const minutesFromMidnight = startedAtLocal.getHours() * 60 + startedAtLocal.getMinutes();
    const isRealStart = minutesFromMidnight > 1;
    const startMs = isRealStart
      ? ws.startedAt.getTime()
      : Math.min(...timedExercises.map(x => x.t));
    const endMs = Math.max(...timedExercises.map(x => x.t + x.dur));
    workoutDurationsById[ws.id] = {
      start: fmtMs(startMs),
      end:   fmtMs(endMs),
      minutes: Math.round((endMs - startMs) / 60000),
    };
  }

  const pgDate = date.replace(/\//g, "-");

  // Body metadata from Postgres
  let bodyMeta: DayBodyMeta | null = null;
  try {
    const [metricRows, bodyFatCalibration] = await Promise.all([
      repo.listBodyMetrics(userId, pgDate, pgDate),
      repo.getBodyFatCalibration(userId).catch(() => null),
    ]);
    if (metricRows.length > 0) {
      const m = metricRows[0];
      const correctedBodyFat = correctBodyFatPct(m.bodyFatPct ?? null, m.bodyFatSource ?? null, bodyFatCalibration);
      bodyMeta = {
        weightKg:   m.weightKg   ?? null,
        bodyFat:    m.bodyFatPct ?? null,
        bodyFatCorrected:   correctedBodyFat?.pct ?? null,
        bodyFatIsCorrected: correctedBodyFat?.corrected ?? false,
        calories:   m.calories   ?? null,
        protein:    m.proteinG   ?? null,
        carb:       m.carbsG     ?? null,
        fat:        m.fatG       ?? null,
        steps:      m.steps      ?? null,
        distanceKm: m.distanceKm ?? null,
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
        restingHeartRate:   m.restingHeartRate   ?? null,
        hrvMs:              m.hrvMs              ?? null,
        spo2Pct:            m.spo2Pct            ?? null,
      };
    }
  } catch { /* no body metrics for this date */ }

  const tz = session.user.timezone ?? DEFAULT_TZ;

  // Sleep, scores and the HR trace are each independently optional — one missing source must
  // never blank the rest of the day, so they settle rather than reject.
  const dayMid = dateStrMidnightInTz(pgDate, tz);
  const nextMid = new Date(dayMid.getTime() + 86_400_000);
  const [sleepRes, scoresRes, hrRes] = await Promise.allSettled([
    repo.listSleepSessions(userId, pgDate, pgDate),
    repo.getDerivedScoresForDay(userId, pgDate),
    repo.getHrForWindow(userId, dayMid, nextMid),
  ]);

  // Q-274: this was `sleepRes.value[0]`. `listSleepSessions` orders by DATE only, so within a date
  // the row order is whatever Postgres returns — and 15 dates in production carry two rows, a
  // daytime fragment plus the real night. The day log was picking between them by coin flip.
  // `nightSessions` is the one place that answers "which rows are the night": it drops
  // zero-duration rows, classifies naps out by circadian midpoint, and reassembles a fragmented
  // night. Longest wins among what survives, matching `nightForDate` — but chosen from the rows
  // this query already restricted to `pgDate`, rather than re-deriving the wake day, because
  // production carries rows whose stored date disagrees with their local wake day.
  const nights = sleepRes.status === "fulfilled" ? nightSessions(sleepRes.value, tz) : [];
  const sleepRow = nights.length
    ? nights.reduce((best, n) => ((n.durationHours ?? 0) > (best.durationHours ?? 0) ? n : best))
    : undefined;
  const sleep: DaySleep | null = sleepRow
    ? {
        durationHours:   sleepRow.durationHours   ?? null,
        deepSleepHours:  sleepRow.deepSleepHours  ?? null,
        remSleepHours:   sleepRow.remSleepHours   ?? null,
        lightSleepHours: sleepRow.lightSleepHours ?? null,
        awakeHours:      sleepRow.awakHours       ?? null,
        efficiency:      sleepRow.efficiency      ?? null,
        onsetLatencySec: sleepRow.onsetLatencySec ?? null,
        averageHrvMs:    sleepRow.averageHrvMs    ?? null,
        avgHeartRate:    sleepRow.avgHeartRate    ?? null,
        lowestHeartRate: sleepRow.lowestHeartRate ?? null,
        sleepScore:      sleepRow.sleepScore      ?? null,
        sleepStart:      sleepRow.sleepStart ? sleepRow.sleepStart.toISOString() : null,
        sleepEnd:        sleepRow.sleepEnd   ? sleepRow.sleepEnd.toISOString()   : null,
        sleepPhase5Min:  sleepRow.sleepPhase5Min  ?? null,
      }
    : null;

  const derived = scoresRes.status === "fulfilled" ? scoresRes.value : null;
  const scores: DayScores | null = derived
    ? { readiness: derived.readinessScore, sleep: derived.sleepScore, activity: derived.activityScore }
    : null;

  // Bucket the per-minute series by mean bpm. Bucketing by mean, not by sample-at-boundary, so a
  // single spike can't become the whole bucket and a gap can't read as a drop to zero.
  const hr: DayHrPoint[] = [];
  if (hrRes.status === "fulfilled" && hrRes.value.length > 0) {
    const sums = new Map<number, { total: number; n: number }>();
    for (const row of hrRes.value) {
      const mins = Math.floor((row.timestamp.getTime() - dayMid.getTime()) / 60_000);
      if (mins < 0 || mins >= 1440) continue;
      const bucket = Math.floor(mins / DAY_HR_BUCKET_MIN) * DAY_HR_BUCKET_MIN;
      const cur = sums.get(bucket) ?? { total: 0, n: 0 };
      cur.total += row.bpm; cur.n += 1;
      sums.set(bucket, cur);
    }
    for (const [minute, { total, n }] of [...sums.entries()].sort((a, b) => a[0] - b[0])) {
      hr.push({ minute, bpm: Math.round(total / n) });
    }
  }

  const activityLogs = await repo.listActivityLogs(userId, pgDate, pgDate);

  // LB-25 — body temperature, from `oura_daily_summary` (the live BLE-derived values), never from
  // `oura_daily.temperature_deviation`: that Cloud column froze at the 2026-07-07 re-key and would
  // print a months-old figure as today's.
  //
  // **`devC` is gated, and the gate is not this route's invention.** The stored deviations are
  // positive on every night measured (39 of 39, min +0.14 °C) because the baseline sits ~0.36 °C
  // low, which is why TN-6a suspends the readiness temperature ladder over the same values. A
  // screen showing "+0.5 °C vs baseline" from a number the scoring engine refuses to score would
  // be the app contradicting itself, so this reuses `isTemperatureBaselineCentred` rather than
  // inventing a second notion of when the figure can be trusted. It self-clears: when TN-6 centres
  // the baseline, this field starts carrying `devC` with no further change here.
  //
  // `meanC` is NOT gated — an absolute skin temperature is a measurement, not a derivation from
  // the bad baseline, so nothing about the centring problem makes it wrong.
  //
  // One query, anchored on the REQUESTED day rather than today: the window that decides whether
  // the deviation was trustworthy is the one around the day being shown, and the day's own row is
  // inside it, so the window read serves both purposes.
  // **`date` here is the SLASH form.** `normalizeDateParam` returns `YYYY/MM/DD`, while
  // `oura_daily_summary` rows are dash-keyed and `shiftDateStr` splits on `-`. Feeding the slash
  // form to either is how zone-minutes and training-stress went feature-dead (J-8/J-9), and `tsc`
  // cannot catch it — both forms are `string`, so the `find` just never matches and the field is
  // silently always null. The helper's own comment in `date-utils.ts` says to use the ISO form for
  // exactly these two consumers.
  const dateIso = date.replace(/\//g, '-');
  const tempWindow = await repo.getOuraDailySummary(userId, shiftDateStr(dateIso, -27), dateIso);
  const daySummary = tempWindow.find(r => r.date === dateIso) ?? null;
  const tempTrusted = isTemperatureBaselineCentred(tempWindow.map(r => r.tempDevC));
  const bodyTemp: DayBodyTemp | null =
    daySummary == null || (daySummary.tempMeanC == null && daySummary.tempDevC == null)
      ? null
      : { meanC: daySummary.tempMeanC ?? null, devC: tempTrusted ? daySummary.tempDevC ?? null : null };

  const result: DayLogResult = { date, exercises, bodyMeta, workoutDurationsById, activityLogs, sleep, scores, hr, bodyTemp };
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
