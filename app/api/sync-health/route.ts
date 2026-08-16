import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepositoryAsync } from "@/lib/data";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from "@trainingai/shared/date-utils";
import { z } from "zod";
import { activityImplausibleReason, sleepImplausibleReason } from "@trainingai/shared/validation/plausibility";

// Receives native Health Connect data from the Capacitor app.
// The JS layer pre-aggregates data into daily buckets and sends individual
// exercise and sleep sessions. Server upserts into the relevant tables.

const MAX_ITEMS = 400;
// Both separators — see Q-130; localDateString() emits slashes.
const DATE_RE = /^\d{4}[-/]\d{2}[-/]\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

// Field-level validation mirroring the health-connect/ingest bounds. The Capacitor JS
// aggregator sends real JSON numbers or omits a field, so numeric fields are validated
// (a string in a numeric field is rejected, not coerced) and optional — matching the
// SyncPayload TS shape (`number | undefined`), so downstream mappers are unchanged.
const num = (max: number, min = 0) => z.number().min(min).max(max).optional();
const int = (max: number, min: number) => z.number().int().min(min).max(max).optional();
const SyncHealthSchema = z.object({
  dailyMetrics: z.array(z.object({
    date:             z.string().regex(DATE_RE),
    steps:            int(200_000, 0),
    distanceKm:       num(500),
    caloriesBurned:   num(20_000),
    weightKg:         num(500),
    bodyFatPct:       num(100),
    calories:         num(20_000),
    proteinG:         num(2_000),
    carbsG:           num(2_000),
    fatG:             num(2_000),
    restingHeartRate: int(300, 20),
    hrvMs:            num(1_000),
    spo2Pct:          num(100),
  }).strict()).max(MAX_ITEMS).optional(),
  exerciseSessions: z.array(z.object({
    date:           z.string().regex(DATE_RE),
    title:          z.string().min(1).max(200),
    activityType:   z.string().min(1).max(100),
    startTime:      z.string().regex(HHMM_RE),
    endTime:        z.string().regex(HHMM_RE),
    durationMin:    z.number().min(0).max(1_440),
    distanceKm:     num(500),
    caloriesBurned: num(20_000),
    avgHr:          int(300, 20),
    maxHr:          int(300, 20),
  }).strict()).max(MAX_ITEMS).optional(),
  sleepRecords: z.array(z.object({
    date:            z.string().regex(DATE_RE),
    sleepStart:      z.string().min(1),
    sleepEnd:        z.string().min(1),
    durationHours:   z.number().min(0).max(24),
    deepSleepHours:  num(24),
    remSleepHours:   num(24),
    lightSleepHours: num(24),
    awakHours:       num(24),
    // 5-min stage codes, one char per bucket. 288 chars = 24 h, the plausibility ceiling for a
    // single session — anything longer is malformed, not a long night.
    sleepPhase5Min:  z.string().regex(/^[1-4]+$/).max(288).optional(),
  }).strict()).max(MAX_ITEMS).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`sync-health:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Fail closed: a null / non-JSON / malformed / oversized body is a 400, never a throw.
  const parsed = SyncHealthSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const repo = await getRepositoryAsync();

  // Cross-field rejections are per-record, never a 400 for the batch: the aggregator re-sends the
  // same window on every sync, so failing the whole payload on one impossible record wedges the
  // sync forever (the poison-pill class, G-2). The reasons ride back in the response instead.
  const rejected: string[] = [];

  // ── Body metrics (weight, body fat, steps, distance, calories, macros) ────
  if (body.dailyMetrics?.length) {
    await repo.upsertBodyMetrics(
      userId,
      body.dailyMetrics.map(d => ({
        date:       d.date,
        weightKg:   d.weightKg,
        bodyFatPct: d.bodyFatPct,
        calories:   d.calories  != null ? Math.round(d.calories)  : undefined,
        proteinG:   d.proteinG,
        carbsG:     d.carbsG,
        fatG:       d.fatG,
        steps:            d.steps     != null ? Math.round(d.steps) : undefined,
        distanceKm:       d.distanceKm,
        restingHeartRate: d.restingHeartRate,
        hrvMs:            d.hrvMs,
        spo2Pct:          d.spo2Pct,
      })),
      'health_connect',
    );
  }

  // ── Exercise sessions (deduplicate on date+startTime) ─────────────────────
  if (body.exerciseSessions?.length) {
    const dates = [...new Set(body.exerciseSessions.map(s => s.date))].sort();
    const existing = await repo.listActivityLogs(userId, dates[0], dates[dates.length - 1]);
    const existingKeys = new Set(existing.map(s => `${s.date}|${s.startTime}`));

    // Q-25: `activity_type` is a FK. The client maps Health Connect's exercise types to our slugs
    // and falls back to 'other', but that mapping is a *client-side* table — it drifts the moment
    // a type is renamed or deleted here, and an unknown slug threw out of the route, losing the
    // whole flush including the records that were fine. Resolved server-side against the real
    // table instead: an unrecognised type degrades to 'other' rather than dropping a real session,
    // and only degrades to a skip if 'other' itself is missing.
    const knownTypes = new Set((await repo.listActivityTypes()).map(t => t.id));
    const FALLBACK_ACTIVITY_TYPE = 'other';

    for (const s of body.exerciseSessions) {
      if (existingKeys.has(`${s.date}|${s.startTime}`)) continue;
      const reason = activityImplausibleReason(s);
      if (reason) { rejected.push(`exercise ${s.date} ${s.startTime}: ${reason}`); continue; }
      let activityType = s.activityType;
      if (!knownTypes.has(activityType)) {
        if (!knownTypes.has(FALLBACK_ACTIVITY_TYPE)) {
          rejected.push(`exercise ${s.date} ${s.startTime}: unknown activityType "${activityType}"`);
          continue;
        }
        rejected.push(`exercise ${s.date} ${s.startTime}: unknown activityType "${activityType}", stored as "${FALLBACK_ACTIVITY_TYPE}"`);
        activityType = FALLBACK_ACTIVITY_TYPE;
      }
      await repo.saveActivityLog(userId, {
        date: s.date, activityType, title: s.title,
        startTime: s.startTime, endTime: s.endTime,
        durationMin: s.durationMin, distanceKm: s.distanceKm,
        caloriesBurned: s.caloriesBurned, avgHr: s.avgHr, maxHr: s.maxHr,
      });
    }
  }

  // ── Sleep sessions (dedup handled by UNIQUE(user_id, sleep_start)) ────────
  if (body.sleepRecords?.length) {
    for (const s of body.sleepRecords) {
      const sleepStart = new Date(s.sleepStart);
      const sleepEnd = new Date(s.sleepEnd);
      // `sleepStart`/`sleepEnd` are free-form strings from the aggregator, so an unparseable one
      // reaches the driver as Invalid Date and 500s the whole flush.
      if (Number.isNaN(sleepStart.getTime()) || Number.isNaN(sleepEnd.getTime())) {
        rejected.push(`sleep ${s.date}: unparseable sleepStart/sleepEnd`);
        continue;
      }
      const reason = sleepImplausibleReason({
        spanHours: (sleepEnd.getTime() - sleepStart.getTime()) / 3_600_000,
        durationHours:   s.durationHours,
        deepSleepHours:  s.deepSleepHours,
        remSleepHours:   s.remSleepHours,
        lightSleepHours: s.lightSleepHours,
        awakHours:       s.awakHours,
      });
      if (reason) { rejected.push(`sleep ${s.date}: ${reason}`); continue; }
      await repo.saveSleepSession(userId, {
        date:            s.date,
        sleepStart,
        sleepEnd,
        durationHours:   s.durationHours,
        deepSleepHours:  s.deepSleepHours,
        remSleepHours:   s.remSleepHours,
        lightSleepHours: s.lightSleepHours,
        awakHours:       s.awakHours,
        sleepPhase5Min:  s.sleepPhase5Min,
      }, 'health_connect');
    }
  }

  // ── Enrichment candidates: recent activity logs missing HR/distance/calories ─
  const tz = session.user.timezone ?? DEFAULT_TZ;
  const from3d = toAestDay(new Date(todayMidnightUtc(tz).getTime() - 3 * 86_400_000), tz);
  const recent = await repo.listActivityLogs(userId, from3d, todayInTz(tz));
  const enrichmentCandidates = recent
    .filter(a => a.avgHr == null && a.distanceKm == null && a.caloriesBurned == null && a.startTime && a.endTime)
    .map(a => ({ id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime }));

  return NextResponse.json({ ok: true, enrichmentCandidates, rejected });
}
