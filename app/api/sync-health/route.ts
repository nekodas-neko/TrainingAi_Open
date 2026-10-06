import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepositoryAsync } from "@/lib/data";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from "@trainingai/shared/date-utils";
import { z } from "zod";
import { activityImplausibleReason, sleepImplausibleReason, MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM } from "@trainingai/shared/validation/plausibility";
import { isPlausibleStepWindow } from "@trainingai/shared/health/step-estimate";
import { isPlausibleCadence, MIN_PLAUSIBLE_SPM, MAX_PLAUSIBLE_SPM } from "@trainingai/shared/health/cadence";
import { ingestDayRejection, INGEST_FUTURE_TOLERANCE_MS } from "@trainingai/shared/validation/ingest-clock";
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { HR_UPLOAD_CHUNK, INTERVAL_UPLOAD_CHUNK, SYNC_DAYS_COLD, type ActivityInterval } from '@/lib/health-connect-sync'
import type { HealthConnectIntervalRow } from '@/lib/data/repository'

// Three arrays of at most MAX_ITEMS (400) rows of bounded numbers — about 300 KB at the schema's
// own limit — plus MAX_HR_SAMPLES heart-rate points of ~30 bytes each, another ~300 KB. 1 MB is
// still generous past both. The client never sends the heart-rate or interval arrays alongside the
// daily payload or each other: each goes in requests of its own, an interval chunk being ~700 KB.
const MAX_BODY_BYTES = 1024 * 1024

// One request's share of a heart-rate series. The client's own chunk size, imported rather than
// repeated, so the two cannot drift into every chunk being a 400.
const MAX_HR_SAMPLES = HR_UPLOAD_CHUNK
// The client reads `SYNC_DAYS_COLD` days on a cold sync. A sample further back than that (plus a
// day of slack), or ahead of ordinary clock skew, is a broken clock or a crafted call — dropped per
// sample, never a 400 for the batch (the poison-pill rule).
const HR_PAST_TOLERANCE_MS = (SYNC_DAYS_COLD + 1) * 24 * 60 * 60_000
// One request's share of the per-interval rows (#2462), the client's own chunk size for the same
// reason as MAX_HR_SAMPLES.
const MAX_INTERVALS = INTERVAL_UPLOAD_CHUNK
// A Health Connect id is a UUID; package names are short. Generous, finite.
const MAX_ID_LEN = 200

// Receives aggregate health data. Legacy Android callers default to Health Connect.
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
  source: z.enum(['health_connect', 'apple_health']).default('health_connect'),
  dailyMetrics: z.array(z.object({
    date:             z.string().regex(DATE_RE),
    steps:            int(200_000, 0),
    distanceKm:       num(500),
    caloriesBurned:   num(20_000),
    activeCalories:   num(20_000),
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
  // Intraday HR, one entry per sample at the source's own resolution (never resampled). Structural
  // bounds only: `at` is capped so `new Date(at)` cannot go Invalid at the driver; range and clock
  // are filtered per sample below.
  heartRateSamples: z.array(z.object({
    at:  z.number().int().min(0).max(8_640_000_000_000_000), // epoch ms
    bpm: z.number(),
  }).strict()).max(MAX_HR_SAMPLES).optional(),
  // #2462. Health Connect steps / active kcal per record and cadence per sample. Structural bounds
  // only, as for heartRateSamples: plausibility and the clock are judged per row below, so one bad
  // row is dropped and reported rather than failing the chunk.
  activityIntervals: z.array(z.object({
    kind:     z.enum(['steps', 'active_kcal', 'cadence_spm']),
    startMs:  z.number().int().min(0).max(8_640_000_000_000_000),
    endMs:    z.number().int().min(0).max(8_640_000_000_000_000),
    value:    z.number(),
    recordId: z.string().trim().min(1).max(MAX_ID_LEN),
    origin:   z.string().max(MAX_ID_LEN).optional(),
    device:   z.string().max(MAX_ID_LEN).optional(),
  }).strict()).max(MAX_INTERVALS).optional(),
}).strict();

/**
 * Why one interval row cannot be stored, or null. Each kind goes through the bound the codebase
 * already owns for it, never a new one: a step window through `isPlausibleStepWindow` (the gate every
 * step source and `stepCandidates` use), active kcal through `activityImplausibleReason`'s kcal/min
 * ceiling, and cadence through `isPlausibleCadence`. A cadence below the gait floor is "not walking"
 * rather than a cadence, which is what that helper already says.
 */
function intervalRejection(r: Pick<ActivityInterval, 'kind' | 'startMs' | 'endMs' | 'value'>): string | null {
  if (!(r.value >= 0) || !Number.isFinite(r.value)) return `value ${r.value} is not a non-negative number`
  if (r.kind === 'cadence_spm') {
    if (r.endMs !== r.startMs) return 'a cadence sample is an instant (startMs = endMs)'
    return isPlausibleCadence(r.value) ? null : `cadence ${r.value} spm is outside ${MIN_PLAUSIBLE_SPM}-${MAX_PLAUSIBLE_SPM}`
  }
  if (!(r.endMs > r.startMs)) return 'endMs is not after startMs'
  if (r.kind === 'steps') {
    if (!Number.isInteger(r.value)) return `steps ${r.value} is not a whole count`
    return isPlausibleStepWindow(r.value, r.startMs, r.endMs) ? null : `${r.value} steps in ${Math.round((r.endMs - r.startMs) / 1000)} s`
  }
  return activityImplausibleReason({ durationMin: (r.endMs - r.startMs) / 60_000, caloriesBurned: r.value })
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`sync-health:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Fail closed: a null / non-JSON / malformed body is a 400, never a throw — and an **oversized**
  // one is now a 413 rather than something this route reads in full first. That last clause is what
  // the comment here used to claim and the code did not do: `req.json()` buffers before any schema
  // can refuse it, so "oversized → 400" described protection that was not present (Q-322).
  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const parsed = SyncHealthSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const repo = await getRepositoryAsync();

  // Cross-field rejections are per-record, never a 400 for the batch: the aggregator re-sends the
  // same window on every sync, so failing the whole payload on one impossible record wedges the
  // sync forever (the poison-pill class, G-2). The reasons ride back in the response instead.
  const rejected: string[] = [];

  // The `date` field was the one the per-record policy above did not cover, and it is the field
  // most able to take the batch down with it: a shape-valid non-day such as `2026-99-99` reaches
  // the `date` column and fails the INSERT for every record travelling with it (RV-177).
  const tz = session.user.timezone ?? DEFAULT_TZ;
  const today = todayInTz(tz);
  const unusableDay = (date: string) => ingestDayRejection(date, today);

  // ── Body metrics (weight, body fat, steps, distance, calories, macros) ────
  const usableMetrics = (body.dailyMetrics ?? []).filter(d => {
    const reason = unusableDay(d.date);
    if (reason) rejected.push(`metrics ${d.date}: ${reason}`);
    return !reason;
  });
  if (usableMetrics.length) {
    await repo.upsertBodyMetrics(
      userId,
      usableMetrics.map(d => ({
        date:       d.date,
        weightKg:   d.weightKg,
        bodyFatPct: d.bodyFatPct,
        calories:   d.calories  != null ? Math.round(d.calories)  : undefined,
        proteinG:   d.proteinG,
        carbsG:     d.carbsG,
        fatG:       d.fatG,
        steps:            d.steps     != null ? Math.round(d.steps) : undefined,
        activeCalories:   d.activeCalories != null ? Math.round(d.activeCalories) : undefined,
        distanceKm:       d.distanceKm,
        restingHeartRate: d.restingHeartRate,
        hrvMs:            d.hrvMs,
        spo2Pct:          d.spo2Pct,
      })),
      body.source,
    );
  }

  // ── Exercise sessions (deduplicate on date+startTime) ─────────────────────
  const usableSessions = (body.exerciseSessions ?? []).filter(s => {
    const reason = unusableDay(s.date);
    if (reason) rejected.push(`exercise ${s.date} ${s.startTime}: ${reason}`);
    return !reason;
  });
  if (usableSessions.length) {
    // Filtered BEFORE this, because the range query below is keyed on the first and last date —
    // an unusable one poisons the lookup as surely as it poisons the write.
    const dates = [...new Set(usableSessions.map(s => s.date))].sort();
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

    for (const s of usableSessions) {
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
      const dayReason = unusableDay(s.date);
      if (dayReason) { rejected.push(`sleep ${s.date}: ${dayReason}`); continue; }
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
      }, body.source);
    }
  }

  // ── Intraday heart rate → the shared HR table (#2168) ─────────────────────
  // Written whatever else covers the same minutes: a ring or strap row nearby wins at read time
  // (`mergeHrSources`), so this adds a series for a user without one and leaves a ring user's
  // scores where they were.
  let heartRateAccepted = 0
  if (body.heartRateSamples?.length) {
    const now = Date.now()
    const usable = body.heartRateSamples
      .filter(s => s.at >= now - HR_PAST_TOLERANCE_MS && s.at <= now + INGEST_FUTURE_TOLERANCE_MS)
      .map(s => ({ timestamp: new Date(s.at), bpm: Math.round(s.bpm) }))
      .filter(s => s.bpm >= MIN_PLAUSIBLE_BPM && s.bpm <= MAX_PLAUSIBLE_BPM)
    const dropped = body.heartRateSamples.length - usable.length
    if (dropped > 0) {
      rejected.push(`heart rate: ${dropped} sample(s) outside ${MIN_PLAUSIBLE_BPM}-${MAX_PLAUSIBLE_BPM} bpm or the sync window`)
    }
    if (usable.length) {
      await repo.upsertAggregatorHeartrate(userId, usable, body.source, tz)
      heartRateAccepted = usable.length
    }
  }

  // ── Per-interval steps, active kcal, cadence → health_connect_intervals (#2462) ─
  // Every app's rows are kept, overlapping or not: overlap is resolved when the steps are read
  // (`stepCandidates` → `dedupeOverlappingWindows`), as for every other step source. Only Health
  // Connect writes these; an Apple Health caller has its own sample table.
  let intervalsAccepted = 0
  if (body.activityIntervals?.length) {
    if (body.source !== 'health_connect') {
      rejected.push(`intervals: ${body.activityIntervals.length} row(s) ignored — only Health Connect sends these`)
    } else {
      const now = Date.now()
      const usable: HealthConnectIntervalRow[] = []
      const reasons = new Map<string, number>()
      for (const r of body.activityIntervals) {
        const reason = (r.startMs < now - HR_PAST_TOLERANCE_MS || r.endMs > now + INGEST_FUTURE_TOLERANCE_MS)
          ? 'outside the sync window'
          : intervalRejection(r)
        if (reason) {
          const key = `${r.kind}: ${reason.replace(/[\d.]+/g, 'N')}`
          reasons.set(key, (reasons.get(key) ?? 0) + 1)
          continue
        }
        usable.push({
          kind: r.kind, recordId: r.recordId, startAt: new Date(r.startMs), endAt: new Date(r.endMs), value: r.value,
          dataOrigin: r.origin?.trim() || null, deviceType: r.device?.trim() || null,
        })
      }
      // Grouped, so a chunk of 4,000 implausible rows reports one line, not 4,000.
      for (const [reason, n] of reasons) rejected.push(`intervals ${reason} (${n} row(s))`)
      if (usable.length) intervalsAccepted = await repo.upsertHealthConnectIntervals(userId, usable)
    }
  }

  // ── Enrichment candidates: recent activity logs missing HR/distance/calories ─
  const from3d = toAestDay(new Date(todayMidnightUtc(tz).getTime() - 3 * 86_400_000), tz);
  const recent = await repo.listActivityLogs(userId, from3d, todayInTz(tz));
  const enrichmentCandidates = recent
    .filter(a => a.avgHr == null && a.distanceKm == null && a.caloriesBurned == null && a.startTime && a.endTime)
    .map(a => ({ id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime }));

  return NextResponse.json({ ok: true, enrichmentCandidates, rejected, heartRateAccepted, intervalsAccepted });
}
