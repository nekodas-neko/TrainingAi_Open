import type { BaseSample, ObjectTypeIdentifier, QuantityTypeIdentifier, UnitForIdentifier } from '@kingstinct/react-native-healthkit';
import type { HealthInspection, HealthInspectionEntry } from '../../features/health/types';

type QuantityDefinition = {
  key: string;
  label: string;
  type: QuantityTypeIdentifier;
  unit: UnitForIdentifier<QuantityTypeIdentifier>;
  displayUnit: string;
  scale?: number;
};
const quantities: QuantityDefinition[] = [
  { key: 'hr', label: 'Heart rate', type: 'HKQuantityTypeIdentifierHeartRate', unit: 'count/min', displayUnit: 'bpm' },
  { key: 'rhr', label: 'Resting heart rate', type: 'HKQuantityTypeIdentifierRestingHeartRate', unit: 'count/min', displayUnit: 'bpm' },
  { key: 'hrv', label: 'HRV · SDNN', type: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', unit: 'ms', displayUnit: 'ms' },
  { key: 'hrv-rmssd', label: 'HRV · RMSSD', type: 'HKQuantityTypeIdentifierHeartRateVariabilityRMSSD', unit: 'ms', displayUnit: 'ms' },
  { key: 'oxygen', label: 'Blood oxygen', type: 'HKQuantityTypeIdentifierOxygenSaturation', unit: '%', displayUnit: '%', scale: 100 },
  { key: 'respiratory', label: 'Respiratory rate', type: 'HKQuantityTypeIdentifierRespiratoryRate', unit: 'count/min', displayUnit: 'breaths/min' },
  { key: 'vo2', label: 'Cardio fitness · VO₂ max', type: 'HKQuantityTypeIdentifierVO2Max', unit: 'ml/(kg*min)', displayUnit: 'mL/kg/min' },
  { key: 'steps', label: 'Steps', type: 'HKQuantityTypeIdentifierStepCount', unit: 'count', displayUnit: 'steps' },
  { key: 'energy', label: 'Active energy', type: 'HKQuantityTypeIdentifierActiveEnergyBurned', unit: 'kcal', displayUnit: 'kcal' },
  { key: 'walking-distance', label: 'Walking + running distance', type: 'HKQuantityTypeIdentifierDistanceWalkingRunning', unit: 'm', displayUnit: 'm' },
  { key: 'cycling-distance', label: 'Cycling distance', type: 'HKQuantityTypeIdentifierDistanceCycling', unit: 'm', displayUnit: 'm' },
  { key: 'snow-distance', label: 'Alpine snow sports distance', type: 'HKQuantityTypeIdentifierDistanceDownhillSnowSports', unit: 'm', displayUnit: 'm' },
  { key: 'running-power', label: 'Running power', type: 'HKQuantityTypeIdentifierRunningPower', unit: 'W', displayUnit: 'W' },
  { key: 'running-speed', label: 'Running speed', type: 'HKQuantityTypeIdentifierRunningSpeed', unit: 'm/s', displayUnit: 'm/s' },
  { key: 'stride', label: 'Running stride length', type: 'HKQuantityTypeIdentifierRunningStrideLength', unit: 'm', displayUnit: 'm' },
  { key: 'swimming-strokes', label: 'Swimming strokes', type: 'HKQuantityTypeIdentifierSwimmingStrokeCount', unit: 'count', displayUnit: 'strokes' },
  { key: 'depth', label: 'Underwater depth', type: 'HKQuantityTypeIdentifierUnderwaterDepth', unit: 'm', displayUnit: 'm' },
  { key: 'water-temperature', label: 'Water temperature', type: 'HKQuantityTypeIdentifierWaterTemperature', unit: 'degC', displayUnit: '°C' },
  { key: 'weight', label: 'Weight', type: 'HKQuantityTypeIdentifierBodyMass', unit: 'kg', displayUnit: 'kg' },
  { key: 'bmi', label: 'Body mass index', type: 'HKQuantityTypeIdentifierBodyMassIndex', unit: 'count', displayUnit: '' },
  { key: 'body-fat', label: 'Body fat', type: 'HKQuantityTypeIdentifierBodyFatPercentage', unit: '%', displayUnit: '%', scale: 100 },
  { key: 'lean-mass', label: 'Lean body mass', type: 'HKQuantityTypeIdentifierLeanBodyMass', unit: 'kg', displayUnit: 'kg' },
  { key: 'systolic', label: 'Blood pressure · systolic', type: 'HKQuantityTypeIdentifierBloodPressureSystolic', unit: 'mmHg', displayUnit: 'mmHg' },
  { key: 'diastolic', label: 'Blood pressure · diastolic', type: 'HKQuantityTypeIdentifierBloodPressureDiastolic', unit: 'mmHg', displayUnit: 'mmHg' },
];
export const inspectionReadTypes: ObjectTypeIdentifier[] = [
  'HKCategoryTypeIdentifierSleepAnalysis', 'HKWorkoutTypeIdentifier', ...quantities.map(x => x.type),
];
const sampleLimit = 2000;

function summarize(key: string, label: string, samples: readonly BaseSample[], latestValue?: string): HealthInspectionEntry {
  const sources = new Map<string, HealthInspectionEntry['sources'][number]>();
  for (const sample of samples) {
    const source = sample.sourceRevision.source;
    const latestAt = sample.startDate.toISOString();
    const existing = sources.get(source.bundleIdentifier);
    if (existing) {
      existing.count += 1;
      if (latestAt > existing.latestAt) { existing.latestAt = latestAt; }
    } else {
      sources.set(source.bundleIdentifier, { name: source.name, bundleIdentifier: source.bundleIdentifier, count: 1, latestAt });
    }
  }
  return {
    key, label, status: samples.length ? 'records' : 'empty', count: samples.length,
    limited: samples.length === sampleLimit, latestValue,
    latestStart: samples[0]?.startDate.toISOString(), latestEnd: samples[0]?.endDate.toISOString(),
    sources: [...sources.values()],
  };
}

function failed(key: string, label: string, error: unknown): HealthInspectionEntry {
  return { key, label, status: 'error', sources: [], detail: error instanceof Error ? error.message : 'The query failed. Try again with your phone unlocked.' };
}

export async function inspectHealth(health: typeof import('@kingstinct/react-native-healthkit'), end: Date): Promise<HealthInspection> {
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const options = { limit: sampleLimit, ascending: false, filter: { date: { startDate: start, endDate: end } } };
  const entries: HealthInspectionEntry[] = [];
  try {
    const samples = await health.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', options);
    const stages: Record<number, string> = { 0: 'In bed', 1: 'Asleep · unspecified', 2: 'Awake', 3: 'Core sleep', 4: 'Deep sleep', 5: 'REM sleep' };
    const entry = summarize('sleep', 'Sleep', samples, samples[0] ? stages[samples[0].value] ?? `Category ${samples[0].value}` : undefined);
    entry.detail = [...new Set(samples.map(x => stages[x.value] ?? `Category ${x.value}`))].join(', ');
    entries.push(entry);
  } catch (error) {
    entries.push(failed('sleep', 'Sleep', error));
  }
  for (const definition of quantities) {
    if (!health.isObjectTypeAvailable(definition.type)) {
      entries.push({ key: definition.key, label: definition.label, status: 'unsupported', sources: [] });
      continue;
    }
    try {
      const samples = await health.queryQuantitySamples(definition.type, { ...options, unit: definition.unit });
      const value = samples[0] ? `${Number((samples[0].quantity * (definition.scale ?? 1)).toFixed(2))} ${definition.displayUnit}`.trim() : undefined;
      entries.push(summarize(definition.key, definition.label, samples, value));
    } catch (error) {
      entries.push(failed(definition.key, definition.label, error));
    }
  }
  try {
    const workouts = await health.queryWorkoutSamples(options);
    try {
      const samples = workouts.map(x => x.toJSON());
      const latest = samples[0];
      const value = latest ? `${health.WorkoutActivityType[latest.workoutActivityType]} · ${Number(latest.duration.quantity.toFixed(1))} ${latest.duration.unit}` : undefined;
      entries.push(summarize('workouts', 'Workouts', samples, value));
    } finally {
      for (const workout of workouts) { workout.dispose(); }
    }
  } catch (error) {
    entries.push(failed('workouts', 'Workouts', error));
  }
  return { startAt: start.toISOString(), endAt: end.toISOString(), entries };
}
