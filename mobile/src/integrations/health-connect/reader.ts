import type { HealthConnectReader } from './types';
import type { HealthConnectType } from '@trainingai/shared/validation/health-connect-import';
export function healthConnectAvailable() {
  return false;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Health Connect requires an Android build.');
};
export const requestHealthConnectPermissions: () => Promise<HealthConnectType[]> = unavailable;
export const grantedHealthConnectTypes: HealthConnectReader['permissions'] = unavailable;
export const requestHealthConnectTypes: NonNullable<HealthConnectReader['request']> = unavailable;
export const readHealthConnectPage: HealthConnectReader['history'] = unavailable;
export const readHealthConnectChanges: HealthConnectReader['changes'] = unavailable;
export const openHealthConnectSettings: () => Promise<void> = unavailable;
export const requestHealthConnectHistoryPermission: () => Promise<void> = unavailable;
export const hasHealthConnectHistoryPermission: () => Promise<boolean> = unavailable;
