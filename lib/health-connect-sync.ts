// Runs only in the Capacitor native container. In the browser this module is
// imported but syncHealthConnect() exits immediately after the platform check.
//
// All data is read via @devmaxime/capacitor-health-connect, which is patched
// (patches/@devmaxime__capacitor-health-connect.patch) to add BodyFat and
// Nutrition record types and their JSON converters.

import type { HealthConnectPlugin } from '@devmaxime/capacitor-health-connect';
import { intervalsToPhase5Min, type SleepStage, type StageInterval } from '@trainingai/shared/health/hypnogram';
import { msToHHMMInTz } from '@trainingai/shared/date-utils';

// Verified against the pinned plugin source (RecordConverter.kt:390-400, v1.1.0) — those seven
// strings are the complete set it can emit. SLEEPING and UNKNOWN are deliberately absent: they
// mean "asleep, stage not determined", which the 4-code sleep_phase_5_min encoding cannot express
// without inventing a stage. Health Connect's AWAKE_IN_BED (7) has no branch in that `when`, so it
// arrives as SLEEP_STAGE_UNKNOWN and is likewise unstaged.
const HC_STAGE_TO_SLEEP_STAGE: Record<string, SleepStage> = {
  SLEEP_STAGE_DEEP:        'deep',
  SLEEP_STAGE_LIGHT:       'light',
  SLEEP_STAGE_REM:         'rem',
  SLEEP_STAGE_AWAKE:       'awake',
  SLEEP_STAGE_OUT_OF_BED:  'awake',
};

export const LAST_SYNC_KEY  = 'ta_hc_last_sync';
const SYNC_DAYS_COLD = 30;  // days on first install
const SYNC_DAYS_HOT  = 7;   // days on subsequent opens

// Canonical read-type lists. Both requestPermissions and canRead.has() checks
// must draw from these — any drift is caught by the parity test.
export const HC_SYNC_READ_TYPES = [
  'Steps', 'Weight', 'ActivitySession', 'SleepSession', 'BodyFat',
  'Nutrition', 'RestingHeartRate', 'OxygenSaturation', 'HeartRateSeries',
  'TotalCaloriesBurned', 'HeartRateVariabilityRmssd',
] as const;

export const HC_ENRICH_READ_TYPES = ['Steps', 'HeartRateSeries'] as const;

interface DailyMetric {
  date: string;
  steps?: number;
  distanceKm?: number;
  caloriesBurned?: number;  // total calories burned (activity)
  weightKg?: number;
  bodyFatPct?: number;
  calories?: number;        // dietary calories from nutrition log
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  restingHeartRate?: number; // overnight min BPM (midnight–8am)
  hrvMs?: number;            // mean overnight SDNN HRV in ms
  spo2Pct?: number;          // mean overnight SpO2 %
}

interface ExerciseSession {
  date: string;
  title: string;
  activityType: string;
  startTime: string;  // HH:MM
  endTime: string;
  durationMin: number;
  distanceKm?: number;
  caloriesBurned?: number;
  avgHr?: number;
  maxHr?: number;
}

// Map Health Connect's exerciseType string constants to our activity_types slugs.
// Manually-added/admin activity types are not part of this mapping — anything
// HC reports that we don't recognize falls back to 'other'.
const EXERCISE_TYPE_TO_ACTIVITY_TYPE: Record<string, string> = {
  EXERCISE_TYPE_WALKING: 'walk',
  EXERCISE_TYPE_RUNNING: 'run',
  EXERCISE_TYPE_RUNNING_TREADMILL: 'run',
  EXERCISE_TYPE_BIKING: 'cycle',
  EXERCISE_TYPE_BIKING_STATIONARY: 'cycle',
  EXERCISE_TYPE_HIKING: 'hike',
  EXERCISE_TYPE_SWIMMING_POOL: 'swim',
  EXERCISE_TYPE_SWIMMING_OPEN_WATER: 'swim',
  EXERCISE_TYPE_YOGA: 'yoga',
  EXERCISE_TYPE_STRETCHING: 'stretch',
  EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: 'hiit',
};

export function mapExerciseTypeToActivityType(exerciseType: string): string {
  return EXERCISE_TYPE_TO_ACTIVITY_TYPE[exerciseType] ?? 'other';
}

interface SleepRecord {
  date: string;           // wake-up date YYYY-MM-DD
  sleepStart: string;     // ISO timestamp
  sleepEnd: string;
  durationHours: number;
  deepSleepHours?: number;
  remSleepHours?: number;
  lightSleepHours?: number;
  awakHours?: number;
  /** 5-min stage codes ('1'=deep '2'=light '3'=REM '4'=awake), same encoding the ring writes.
   *  Omitted when the provider staged only part of the night — see intervalsToPhase5Min. */
  sleepPhase5Min?: string;
}

export interface SyncPayload {
  dailyMetrics: DailyMetric[];
  exerciseSessions: ExerciseSession[];
  sleepRecords: SleepRecord[];
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  // Use Intl to get local date parts in the device timezone — avoids UTC-day
  // misalignment for UTC+ users where `getDate()` on a UTC midnight is the prior day
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}


// Per-session distance / calories / heart rate, used for both freshly-synced
// exercise sessions and for enriching activity logs created another way
// (e.g. manually logged) once Health Connect data for that window lands.
async function getSessionMetrics(
  hc: HealthConnectPlugin,
  canRead: Set<string>,
  start: string,
  end: string,
): Promise<{ distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number }> {
  const metrics: { distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number } = {};

  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await hc.aggregateRecords({ start, end, type: 'Distance' });
      const v = aggregates[0]?.value;
      if (v) metrics.distanceKm = Math.round((v / 1000) * 10) / 10;
    } catch { /* ignore */ }
  }

  if (canRead.has('TotalCaloriesBurned')) {
    try {
      const { aggregates } = await hc.aggregateRecords({ start, end, type: 'TotalCaloriesBurned' });
      const v = aggregates[0]?.value;
      if (v) metrics.caloriesBurned = Math.round(v);
    } catch { /* ignore */ }
  }

  if (canRead.has('HeartRateSeries')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { records } = await hc.readRecords({ start, end, type: 'HeartRateSeries' } as any);
      const bpms: number[] = [];
      for (const r of records as Array<{ samples?: Array<{ beatsPerMinute: number }> }>) {
        for (const sample of r.samples ?? []) bpms.push(sample.beatsPerMinute);
      }
      if (bpms.length) {
        metrics.avgHr = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
        metrics.maxHr = Math.max(...bpms);
      }
    } catch { /* ignore */ }
  }

  return metrics;
}

export interface EnrichmentCandidate {
  id: string;
  date: string;
  startTime?: string; // "HH:MM", local time
  endTime?: string;   // "HH:MM", local time
}

// Builds the UTC instant for a local date + "HH:MM" time. `dayOffset` shifts
// the date forward, used when a session's end time crosses midnight.
function localDateTimeToIso(date: string, time: string, dayOffset = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d + dayOffset, h, mi).toISOString();
}

// Backfills HR/distance/calories on activity logs that were saved without
// them (e.g. manually logged before Health Connect's session data synced).
export async function enrichActivityLogs(candidates: EnrichmentCandidate[]): Promise<void> {
  if (!candidates.length) return;

  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;

  const { HealthConnect } = await import('@devmaxime/capacitor-health-connect');

  const { availability } = await HealthConnect.checkAvailability();
  if (availability !== 'Available') return;

  const perms = await HealthConnect.requestPermissions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: [...HC_ENRICH_READ_TYPES] as any,
    write: [],
  });
  const canRead: Set<string> = new Set(perms.read);

  for (const c of candidates) {
    if (!c.startTime || !c.endTime) continue;
    const start = localDateTimeToIso(c.date, c.startTime);
    const end = localDateTimeToIso(c.date, c.endTime, c.endTime <= c.startTime ? 1 : 0);
    const metrics = await getSessionMetrics(HealthConnect, canRead, start, end);
    if (!Object.keys(metrics).length) continue;

    try {
      await fetch(`/api/activity-logs/${c.id}/metrics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metrics),
      });
    } catch { /* ignore */ }
  }
}

export async function syncHealthConnect(): Promise<{ metrics: number; sessions: number; sleep: number; note?: string } | null> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return null;

  const { HealthConnect } = await import('@devmaxime/capacitor-health-connect');

  const { availability } = await HealthConnect.checkAvailability();
  if (availability !== 'Available') return { metrics: 0, sessions: 0, sleep: 0, note: `HC ${availability}` };

  const perms = await HealthConnect.requestPermissions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: [...HC_SYNC_READ_TYPES] as any,
    write: [],
  });
  const canRead: Set<string> = new Set(perms.read);

  const lastSync  = localStorage.getItem(LAST_SYNC_KEY);
  const daysBack  = lastSync ? SYNC_DAYS_HOT : SYNC_DAYS_COLD;

  // Align query window to local calendar day boundaries. The plugin loops over
  // 24h windows from `startInstant`, so if start isn't a local midnight the
  // windows straddle two calendar days and aggregate steps from both into one
  // bucket. Using new Date(y, m-1, d, 0, 0, 0) creates midnight in the device's
  // own timezone, so every bucket maps to exactly one local calendar day.
  const todayStr      = toLocalDate(new Date().toISOString());
  const [ty, tm, td]  = todayStr.split('-').map(Number);
  const start         = new Date(ty, tm - 1, td - (daysBack - 1), 0, 0, 0);
  const end           = new Date(ty, tm - 1, td + 1, 0, 0, 0);
  const startIso      = start.toISOString();
  const endIso        = end.toISOString();

  const dayBuckets: Record<string, DailyMetric> = {};
  function bucket(date: string): DailyMetric {
    if (!dayBuckets[date]) dayBuckets[date] = { date };
    return dayBuckets[date];
  }

  // ── Steps (aggregate by day) ──────────────────────────────────────────────
  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'Steps', groupBy: 'day',
      });
      for (const a of aggregates) {
        const v = Math.round(a.value);
        if (v > 0) bucket(toLocalDate(a.startTime)).steps = v;
      }
    } catch { /* permission denied */ }
  }

  // ── Distance (aggregate by day, m → km) ───────────────────────────────────
  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'Distance', groupBy: 'day',
      });
      for (const a of aggregates)
        bucket(toLocalDate(a.startTime)).distanceKm = Math.round((a.value / 1000) * 10) / 10;
    } catch { /* ignore */ }
  }

  // ── Calories burned (aggregate by day) ────────────────────────────────────
  if (canRead.has('TotalCaloriesBurned')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'TotalCaloriesBurned', groupBy: 'day',
      });
      for (const a of aggregates) bucket(toLocalDate(a.startTime)).caloriesBurned = Math.round(a.value);
    } catch { /* ignore */ }
  }

  // ── Weight (latest per day) ───────────────────────────────────────────────
  if (canRead.has('Weight')) {
    try {
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'Weight' });
      for (const r of records as Array<{ time: string; value: number }>)
        bucket(toLocalDate(r.time)).weightKg = Math.round(r.value * 100) / 100;
    } catch { /* ignore */ }
  }

  // ── Body fat % (latest per day) ───────────────────────────────────────────
  if (canRead.has('BodyFat')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'BodyFat' } as any);
      for (const r of records as Array<{ time: string; percentage: number }>)
        bucket(toLocalDate(r.time)).bodyFatPct = Math.round(r.percentage * 10) / 10;
    } catch { /* ignore */ }
  }

  // ── Nutrition macros (sum per day) ────────────────────────────────────────
  if (canRead.has('Nutrition')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'Nutrition' } as any);
      for (const r of records as Array<{
        startTime: string; calories?: number;
        proteinG?: number; carbsG?: number; fatG?: number;
      }>) {
        const b = bucket(toLocalDate(r.startTime));
        if (r.calories  != null) b.calories  = (b.calories  ?? 0) + Math.round(r.calories);
        if (r.proteinG  != null) b.proteinG  = (b.proteinG  ?? 0) + Math.round(r.proteinG  * 10) / 10;
        if (r.carbsG    != null) b.carbsG    = (b.carbsG    ?? 0) + Math.round(r.carbsG    * 10) / 10;
        if (r.fatG      != null) b.fatG      = (b.fatG      ?? 0) + Math.round(r.fatG      * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── Resting heart rate (daily measurement from wearable) ─────────────────
  if (canRead.has('RestingHeartRate')) {
    try {
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'RestingHeartRate' });
      for (const r of records as Array<{ time: string; beatsPerMinute: number }>) {
        bucket(toLocalDate(r.time)).restingHeartRate = Math.round(r.beatsPerMinute);
      }
    } catch { /* ignore */ }
  }

  // ── HRV (mean overnight RMSSD, midnight–8am) ─────────────────────────────
  if (canRead.has('HeartRateVariabilityRmssd')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'HeartRateVariabilityRmssd' } as any);
      const overnightHrv: Record<string, number[]> = {};
      for (const r of records as Array<{ time: string; heartRateVariabilityMillis: number }>) {
        const d = new Date(r.time);
        const h = d.getHours();
        if (h >= 0 && h < 8) {
          const date = toLocalDate(r.time);
          if (!overnightHrv[date]) overnightHrv[date] = [];
          overnightHrv[date].push(r.heartRateVariabilityMillis);
        }
      }
      for (const [date, vals] of Object.entries(overnightHrv)) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        bucket(date).hrvMs = Math.round(mean * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── SpO2 (daily mean of overnight readings, midnight–8am) ────────────────
  if (canRead.has('OxygenSaturation')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'OxygenSaturation' } as any);
      const overnightSpo2: Record<string, number[]> = {};
      for (const r of records as Array<{ time: string; percentage: number }>) {
        const d = new Date(r.time);
        const h = d.getHours();
        if (h >= 0 && h < 8) {
          const date = toLocalDate(r.time);
          if (!overnightSpo2[date]) overnightSpo2[date] = [];
          overnightSpo2[date].push(r.percentage);
        }
      }
      for (const [date, vals] of Object.entries(overnightSpo2)) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        bucket(date).spo2Pct = Math.round(mean * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── Exercise sessions ─────────────────────────────────────────────────────
  const exerciseSessions: ExerciseSession[] = [];
  if (canRead.has('ActivitySession')) {
    try {
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'ActivitySession' });
      for (const r of records as Array<{ startTime: string; endTime: string; exerciseType: string; title?: string }>) {
        const durationMin = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000;
        const metrics = await getSessionMetrics(HealthConnect, canRead, r.startTime, r.endTime);
        exerciseSessions.push({
          date:         toLocalDate(r.startTime),
          title:        r.title || r.exerciseType || 'Workout',
          activityType: mapExerciseTypeToActivityType(r.exerciseType),
          startTime:    msToHHMMInTz(r.startTime),
          endTime:      msToHHMMInTz(r.endTime),
          durationMin:  Math.round(durationMin * 10) / 10,
          ...metrics,
        });
      }
    } catch { /* ignore */ }
  }

  // ── Sleep sessions ────────────────────────────────────────────────────────
  const sleepRecords: SleepRecord[] = [];
  if (canRead.has('SleepSession')) {
    try {
      const { records } = await HealthConnect.readRecords({ start: startIso, end: endIso, type: 'SleepSession' });
      for (const r of records as Array<{
        startTime: string; endTime: string;
        stages?: Array<{ startTime: string; endTime: string; stage: string }>;
      }>) {
        const startMs = new Date(r.startTime).getTime();
        const endMs   = new Date(r.endTime).getTime();
        const durationHours = (endMs - startMs) / 3600000;
        // One pass builds both the four totals and the timed intervals the hypnogram needs, so
        // the two can't disagree about what a stage string means.
        const intervals: StageInterval[] = (r.stages ?? []).map(stage => ({
          startMs: new Date(stage.startTime).getTime(),
          endMs:   new Date(stage.endTime).getTime(),
          stage:   HC_STAGE_TO_SLEEP_STAGE[stage.stage] ?? null,
        }));
        let deep = 0, rem = 0, light = 0, awake = 0;
        for (const iv of intervals) {
          const h = (iv.endMs - iv.startMs) / 3600000;
          if      (iv.stage === 'deep')  deep  += h;
          else if (iv.stage === 'rem')   rem   += h;
          else if (iv.stage === 'light') light += h;
          else if (iv.stage === 'awake') awake += h;
        }
        const round = (n: number) => Math.round(n * 100) / 100;
        sleepRecords.push({
          date:            toLocalDate(r.endTime),
          sleepStart:      r.startTime,
          sleepEnd:        r.endTime,
          durationHours:   round(durationHours),
          deepSleepHours:  deep  > 0 ? round(deep)  : undefined,
          remSleepHours:   rem   > 0 ? round(rem)   : undefined,
          lightSleepHours: light > 0 ? round(light) : undefined,
          awakHours:       awake > 0 ? round(awake) : undefined,
          sleepPhase5Min:  intervalsToPhase5Min(intervals, startMs, endMs) ?? undefined,
        });
      }
    } catch { /* ignore */ }
  }

  const dailyMetrics = Object.values(dayBuckets);
  if (!dailyMetrics.length && !exerciseSessions.length && !sleepRecords.length) {
    localStorage.setItem(LAST_SYNC_KEY, end.toISOString());
    return { metrics: 0, sessions: 0, sleep: 0, note: 'no data from HC' };
  }

  const res = await fetch('/api/sync-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyMetrics, exerciseSessions, sleepRecords } satisfies SyncPayload),
  });

  if (!res.ok) throw new Error(`sync-health ${res.status}: ${await res.text()}`);

  localStorage.setItem(LAST_SYNC_KEY, end.toISOString());

  const { enrichmentCandidates } = await res.json() as { enrichmentCandidates?: EnrichmentCandidate[] };
  if (enrichmentCandidates?.length) {
    try { await enrichActivityLogs(enrichmentCandidates); } catch { /* ignore */ }
  }

  return { metrics: dailyMetrics.length, sessions: exerciseSessions.length, sleep: sleepRecords.length };
}
