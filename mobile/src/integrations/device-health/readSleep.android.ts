import {
  healthConnectAvailable,
  grantedHealthConnectTypes,
  readHealthConnectPage,
} from '../health-connect/reader';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import type { HealthConnectRecord } from '@trainingai/shared/validation/health-connect-import';
import { sleepSchema } from '../../features/health/data/models';
export async function readDeviceSleep(timezone: string) {
  if (!healthConnectAvailable()) return [];
  const types = await grantedHealthConnectTypes();
  if (!types.includes('SleepSession')) return [];
  const from = new Date(Date.now() - 30 * 86400000).toISOString(),
    to = new Date().toISOString();
  const records: HealthConnectRecord[] = [];
  let token: string | undefined;
  for (let count = 0; count < 20; count++) {
    const page = await readHealthConnectPage('SleepSession', from, to, token);
    records.push(...page.records);
    token = page.pageToken ?? undefined;
    if (!token) break;
  }
  return projectHealthConnect(records, timezone).sleep.map((row) => sleepSchema.parse(row));
}
