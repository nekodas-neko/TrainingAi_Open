import { projectDeviceHealth, type HealthInterval } from './device-health-projection';
import type { AppleSample } from '../validation/apple-health-import';
const kinds: Record<AppleSample['type'], HealthInterval['kind']> = {
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
  HKQuantityTypeIdentifierHeartRate: 'heartRate',
  HKQuantityTypeIdentifierRestingHeartRate: 'restingHeartRate',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrvSdnn',
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'activeEnergy',
  HKQuantityTypeIdentifierBodyMass: 'weight',
};
export function projectAppleHealth(
  samples: readonly AppleSample[],
  timezone: string,
  now = Date.now(),
) {
  const result = projectDeviceHealth(
    samples.map((row) => ({ ...row, kind: kinds[row.type], sourceId: row.sourceBundleId })),
    timezone,
    now,
  );
  return {
    ...result,
    hrv: result.hrv?.method === 'SDNN' ? { ...result.hrv, method: 'SDNN' as const } : null,
  };
}
