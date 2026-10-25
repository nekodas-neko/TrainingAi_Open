import type { HealthConnectRecord } from '../validation/health-connect-import';
import { projectDeviceHealth, type HealthInterval } from './device-health-projection';
const kinds = {
  Steps: 'steps',
  ActiveCaloriesBurned: 'activeEnergy',
  Weight: 'weight',
  RestingHeartRate: 'restingHeartRate',
  HeartRateVariabilityRmssd: 'hrvRmssd',
} as const;
const stages = { asleep: 1, awake: 2, out_of_bed: 2, deep: 4, light: 3, rem: 5 } as const;
export function healthConnectIntervals(
  records: readonly HealthConnectRecord[],
): HealthInterval[] {
  return records.flatMap((row): HealthInterval[] => {
    const base = {
      id: row.id,
      start: row.start,
      end: row.end,
      sourceId: row.sourcePackage,
      sourceName: row.sourcePackage,
      deviceName: row.deviceManufacturer,
      deviceModel: row.deviceModel,
    };
    // Stored as activity logs (`healthConnectSessionAsWorkout`), not as a day's measurements.
    if (row.type === 'ExerciseSession') return [];
    if (row.type === 'HeartRate')
      return (row.points ?? []).map((point, index) => ({
        ...base,
        id: `${row.id}:${index}`,
        kind: 'heartRate',
        start: point.at,
        end: point.at,
        value: point.bpm,
      }));
    if (row.type === 'SleepSession') {
      const values: HealthInterval[] = (row.stages ?? []).flatMap((stage, index) =>
        stage.kind === 'unknown'
          ? []
          : [
              {
                ...base,
                id: `${row.id}:${index}`,
                kind: 'sleep',
                start: stage.start,
                end: stage.end,
                value: stages[stage.kind],
              },
            ],
      );
      if (!row.stages?.length) {
        values.push({ ...base, kind: 'sleep', value: 1 });
      }
      return values;
    }
    return [{ ...base, kind: kinds[row.type], value: row.value! }];
  });
}
export function projectHealthConnect(
  records: readonly HealthConnectRecord[],
  timezone: string,
  now = Date.now(),
) {
  const result = projectDeviceHealth(
    healthConnectIntervals(records),
    timezone,
    now,
    'Health Connect',
  );
  return {
    ...result,
    hrv: result.hrv?.method === 'RMSSD' ? { ...result.hrv, method: 'RMSSD' as const } : null,
  };
}
