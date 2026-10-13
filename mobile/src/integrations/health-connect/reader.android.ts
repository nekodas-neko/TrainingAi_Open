import { TurboModuleRegistry } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import {
  healthConnectTypes,
  type HealthConnectType,
  type HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
import { normalizeHealthConnectRecord } from './records';
export function healthConnectAvailable() {
  return !isRunningInExpoGo() && !!TurboModuleRegistry.get('HealthConnect');
}
async function sdk() {
  if (!healthConnectAvailable())
    throw new Error('Install the Android development build with Health Connect support.');
  const health = await import('react-native-health-connect');
  const status = await health.getSdkStatus();
  if (status === health.SdkAvailabilityStatus.SDK_UNAVAILABLE) {
    throw new Error('Health Connect is not supported on this Android device.');
  }
  if (status !== health.SdkAvailabilityStatus.SDK_AVAILABLE || !(await health.initialize()))
    throw new Error(
      'Health Connect is unavailable. Install or update Health Connect and try again.',
    );
  return health;
}
export async function requestHealthConnectPermissions() {
  const health = await sdk();
  await health.requestPermission(
    healthConnectTypes.map((recordType) => ({ accessType: 'read', recordType })),
  );
  return grantedHealthConnectTypes();
}
export async function grantedHealthConnectTypes(): Promise<HealthConnectType[]> {
  const permissions = await (await sdk()).getGrantedPermissions();
  return healthConnectTypes.filter((type) =>
    permissions.some(
      (permission) => permission.accessType === 'read' && permission.recordType === type,
    ),
  );
}
export async function readHealthConnectPage(
  type: HealthConnectType,
  from: string,
  to: string,
  pageToken?: string,
) {
  const page = await (
    await sdk()
  ).readRecords(type, {
    timeRangeFilter: { operator: 'between', startTime: from, endTime: to },
    pageSize: 100,
    pageToken,
    ascendingOrder: true,
  });
  const records: HealthConnectRecord[] = [];
  let skipped = 0;
  for (const raw of page.records) {
    const record = normalizeHealthConnectRecord(raw, type);
    if (record) records.push(record);
    else skipped++;
  }
  return {
    records,
    pageToken: page.pageToken || null,
    skipped,
    seenIds: page.records.flatMap((row) => (row.metadata?.id ? [row.metadata.id] : [])),
  };
}
export async function readHealthConnectChanges(
  types: HealthConnectType[],
  changesToken?: string,
) {
  const page = await (
    await sdk()
  ).getChanges(changesToken ? { changesToken } : { recordTypes: types });
  const records: HealthConnectRecord[] = [];
  let skipped = 0;
  for (const change of page.upsertionChanges) {
    const record = normalizeHealthConnectRecord(change.record);
    if (record) records.push(record);
    else skipped++;
  }
  return {
    records,
    deleted: page.deletionChanges.map((change) => change.recordId),
    token: page.nextChangesToken,
    expired: page.changesTokenExpired,
    more: page.hasMore,
    skipped,
  };
}
export async function openHealthConnectSettings() {
  (await sdk()).openHealthConnectSettings();
}

export async function hasHealthConnectHistoryPermission() {
  const granted = await (await sdk()).getGrantedPermissions();
  return granted.some((row) => String(row.recordType) === 'ReadHealthDataHistory');
}

export async function requestHealthConnectHistoryPermission() {
  const health = await sdk();
  try {
    await health.requestPermission([
      { accessType: 'read', recordType: 'ReadHealthDataHistory' },
    ]);
    const granted = await health.getGrantedPermissions();
    if (granted.some((row) => String(row.recordType) === 'ReadHealthDataHistory')) return;
  } catch {}
  throw new Error(
    'Health Connect has not granted access to older history. Check Android version and permissions in Health Connect.',
  );
}
