export type DeviceImportState = {
  ready: boolean;
  busy: boolean;
  error: string | null;
  pending: number;
  enabled: boolean;
  skipped: number;
  /** Health Connect only: records left out as copies of data read first-hand, per type (#3115). */
  skippedFirstHand?: Record<string, number>;
  /** Health Connect only: switched on with no read permission granted (#3906). */
  needsPermission?: boolean;
  completed: {
    measurements: number;
    nights: number;
    days: number;
    heartRate: number;
    completedAt: string;
    hrv: { method: 'SDNN' | 'RMSSD'; value: number; at: string; source: string } | null;
  } | null;
  store: {
    getSnapshot(): {
      error: string | null;
      pending: number;
      enabled: boolean;
      needsPermission?: boolean;
    };
    cancel(): void;
    setEnabled(enabled: boolean): Promise<void>;
    importHistory(from: string): Promise<void>;
    run(manual?: boolean): Promise<void>;
    /** Batches waiting to upload; only these let a rerun skip the throttle (#3906). */
    queued(): boolean;
  } | null;
  refresh: () => Promise<void>;
};
/**
 * #3906: what a status icon shows for the device import. With the switch off nothing is wrong,
 * whatever the last run left behind.
 */
export function importStatusError(state: Pick<DeviceImportState, 'enabled' | 'error'>) {
  return state.enabled ? state.error : null;
}
/** #3906: the switch is on and nothing can be read yet. Shown as a note, never as a failure. */
export function importPermissionNote(
  state: Pick<DeviceImportState, 'enabled' | 'needsPermission'>,
  name: string,
): string | null {
  return state.enabled && state.needsPermission
    ? `Needs permission: allow TrainingAi to read your data in ${name} to sync it.`
    : null;
}
