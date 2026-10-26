import {
  requestHealthConnectPermissions,
  grantedHealthConnectTypes,
} from '../health-connect/reader';
import { normalizeHealthConnectRecord } from '../health-connect/records';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import {
  healthConnectTypes,
  type HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
import { DEFAULT_TZ, midnightDaysAgoInTz, todayInTz } from '@trainingai/shared/date-utils';
import type { HealthSnapshot, HealthInspectionEntry } from '../../features/health/types';
import { formatHoursMinutes } from '@trainingai/shared/format/units'
const labels = {
  SleepSession: 'Sleep',
  HeartRate: 'Heart rate',
  RestingHeartRate: 'Resting heart rate',
  HeartRateVariabilityRmssd: 'HRV · RMSSD',
  Steps: 'Steps',
  ActiveCaloriesBurned: 'Active energy',
  Weight: 'Body weight',
  ExerciseSession: 'Workouts',
};
// The profile's zone, passed by HealthProvider; DEFAULT_TZ only when there is no profile yet,
// never the device's zone (#3117).
export async function readHealthSnapshot(timezone = DEFAULT_TZ): Promise<HealthSnapshot> {
  let granted = await grantedHealthConnectTypes();
  if (!granted.length) granted = await requestHealthConnectPermissions();
  if (!granted.length) throw new Error('No Health Connect read permissions were granted.');
  const health = await import('react-native-health-connect');
  const startAt = midnightDaysAgoInTz(timezone, 7).toISOString(),
    endAt = new Date().toISOString();
  const records: HealthConnectRecord[] = [],
    entries: HealthInspectionEntry[] = [];
  for (const type of healthConnectTypes) {
    if (!granted.includes(type)) {
      entries.push({
        key: type,
        label: labels[type],
        status: 'unsupported',
        detail: 'Read permission is not granted.',
        sources: [],
      });
      continue;
    }
    try {
      const page = await health.readRecords(type, {
        timeRangeFilter: { operator: 'between', startTime: startAt, endTime: endAt },
        pageSize: 100,
        ascendingOrder: false,
      });
      const parsed = page.records.flatMap((raw) => {
        const record = normalizeHealthConnectRecord(raw, type);
        return record ? [record] : [];
      });
      records.push(...parsed);
      const latest = [...parsed].sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
      const packages = [...new Set(parsed.map((row) => row.sourcePackage))];
      entries.push({
        key: type,
        label: labels[type],
        status: parsed.length ? 'records' : 'empty',
        count: parsed.length,
        limited: !!page.pageToken,
        latestStart: latest?.start,
        latestEnd: latest?.end,
        detail: page.pageToken
          ? 'Showing the latest 100 records; full history imports separately.'
          : undefined,
        sources: packages.map((name) => ({
          name,
          bundleIdentifier: name,
          count: parsed.filter((row) => row.sourcePackage === name).length,
          latestAt: parsed
            .filter((row) => row.sourcePackage === name)
            .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0].end,
        })),
      });
    } catch (error) {
      entries.push({
        key: type,
        label: labels[type],
        status: 'error',
        detail: error instanceof Error ? error.message : 'Could not read records.',
        sources: [],
      });
    }
  }
  const projection = projectHealthConnect(records, timezone),
    today = projection.daily.find((row) => row.date === todayInTz(timezone));
  const latest = (type: string) =>
    records
      .filter((row) => row.type === type)
      .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  const heart = records
    .filter((row) => row.type === 'HeartRate')
    .flatMap((row) =>
      (row.points ?? []).map((point) => ({ ...point, source: row.sourcePackage })),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const night = projection.sleep[0];
  const values: Record<string, { value: string | null; source?: string }> = {
    SleepSession: {
      value: night ? formatHoursMinutes(night.durationHours * 60) : null,
      source: night?.sources[0]?.name,
    },
    HeartRate: { value: heart ? `${Math.round(heart.bpm)} bpm` : null, source: heart?.source },
    RestingHeartRate: {
      value: latest('RestingHeartRate')
        ? `${Math.round(latest('RestingHeartRate')!.value!)} bpm`
        : null,
      source: latest('RestingHeartRate')?.sourcePackage,
    },
    HeartRateVariabilityRmssd: {
      value: projection.hrv ? `${projection.hrv.value.toFixed(1)} ms` : null,
      source: projection.hrv?.source,
    },
    Steps: {
      value: today?.steps === undefined ? null : today.steps.toLocaleString(),
      source: latest('Steps')?.sourcePackage,
    },
    ActiveCaloriesBurned: {
      value: today?.activeCalories === undefined ? null : `${today.activeCalories} kcal`,
      source: latest('ActiveCaloriesBurned')?.sourcePackage,
    },
    Weight: {
      value: latest('Weight') ? `${latest('Weight')!.value!.toFixed(1)} kg` : null,
      source: latest('Weight')?.sourcePackage,
    },
    ExerciseSession: {
      value: records.some((row) => row.type === 'ExerciseSession')
        ? `${records.filter((row) => row.type === 'ExerciseSession').length} this week`
        : null,
      source: latest('ExerciseSession')?.sourcePackage,
    },
  };
  return {
    mode: 'device',
    readAt: endAt,
    inspection: { startAt, endAt, entries },
    metrics: healthConnectTypes.map((type) => ({
      key: type,
      label: labels[type],
      ...values[type],
      detail: granted.includes(type)
        ? 'Health Connect · permitted records'
        : 'Read permission is not granted.',
    })),
  };
}
