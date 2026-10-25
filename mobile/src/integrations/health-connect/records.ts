import {
  healthConnectRecord,
  type HealthConnectType,
} from '@trainingai/shared/validation/health-connect-import';
const stageNames = [
  'unknown',
  'awake',
  'asleep',
  'out_of_bed',
  'light',
  'deep',
  'rem',
  'awake',
] as const;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function normalizeHealthConnectRecord(raw: unknown, type?: HealthConnectType) {
  const row = object(raw),
    metadata = object(row.metadata),
    device = object(metadata.device);
  const kind = type ?? row.recordType;
  const value =
    kind === 'Steps'
      ? row.count
      : kind === 'Weight'
        ? object(row.weight).inKilograms
        : kind === 'ActiveCaloriesBurned'
          ? object(row.energy).inKilocalories
          : kind === 'HeartRateVariabilityRmssd'
            ? row.heartRateVariabilityMillis
            : kind === 'ExerciseSession'
              ? undefined
              : row.beatsPerMinute;
  const parsed = healthConnectRecord.safeParse({
    id: metadata.id,
    type: kind,
    sourcePackage: metadata.dataOrigin,
    modifiedAt: metadata.lastModifiedTime,
    start: row.startTime ?? row.time,
    end: row.endTime ?? row.time,
    recordingMethod: metadata.recordingMethod ?? 0,
    ...(device.model ? { deviceModel: device.model } : {}),
    ...(device.manufacturer ? { deviceManufacturer: device.manufacturer } : {}),
    ...(kind === 'HeartRate'
      ? {
          points: (Array.isArray(row.samples) ? row.samples : []).map((raw) => {
            const point = object(raw);
            return { at: point.time, bpm: point.beatsPerMinute };
          }),
        }
      : kind === 'SleepSession'
        ? {
            stages: (Array.isArray(row.stages) ? row.stages : []).map((raw) => {
              const stage = object(raw);
              return {
                start: stage.startTime,
                end: stage.endTime,
                kind:
                  typeof stage.stage === 'number'
                    ? (stageNames[stage.stage] ?? 'unknown')
                    : 'unknown',
              };
            }),
          }
        : kind === 'ExerciseSession'
          ? {
              exerciseType: row.exerciseType,
              ...(typeof row.title === 'string' && row.title.trim()
                ? { title: row.title.slice(0, 500) }
                : {}),
            }
          : { value }),
  });
  return parsed.success ? parsed.data : null;
}
