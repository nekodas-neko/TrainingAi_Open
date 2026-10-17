import { Platform } from 'react-native';
import type { HealthSnapshot } from '../../features/health/types';
import type { AccountSession, AccountState } from '../../features/account/session';
import type { NutritionStore } from '../../features/nutrition/data/NutritionStore';

type SyncDiagnostics = {
  nutrition: NutritionStore['diagnostics'] | null;
  healthImport: {
    enabled: boolean;
    busy: boolean;
    pending: number;
    error: string | null;
    completedAt: string | null;
    heartRate: number | null;
  };
};

const reportUrl = process.env.EXPO_PUBLIC_DEV_REPORT_URL;
const reportKey = process.env.EXPO_PUBLIC_DEV_REPORT_KEY;

function isLocalReportUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    const parts = url.hostname.split('.').map(Number);
    const privateAddress =
      parts.length === 4 &&
      parts.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) &&
      (parts[0] === 10 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
    return (
      url.protocol === 'http:' &&
      privateAddress &&
      url.pathname === '/report' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export const diagnosticsAvailable =
  __DEV__ &&
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  Boolean(reportKey) &&
  isLocalReportUrl(reportUrl);

export async function sendDiagnosticReport(
  snapshot: HealthSnapshot | null,
  screen: string,
  error: string | null,
  account?: AccountSession['diagnostics'] & {
    displayedStatus: AccountState['status'];
  },
  sync?: SyncDiagnostics,
): Promise<void> {
  if (!diagnosticsAvailable || !reportUrl) {
    throw new Error('Local development reporting is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reportKey}` },
      body: JSON.stringify({
        reportVersion: 1,
        capturedAt: new Date().toISOString(),
        platform: Platform.OS,
        screen,
        snapshot,
        error,
        ...(account ? { account } : {}),
        ...(sync ? { sync } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`The PC rejected the report (${response.status}).`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        'The PC did not respond. Check that it is on the same network and the report receiver is running.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
