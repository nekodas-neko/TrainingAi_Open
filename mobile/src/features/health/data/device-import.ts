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
      busy?: boolean;
    };
    subscribe?(listener: () => void): () => void;
    cancel(): void;
    setEnabled(enabled: boolean): Promise<void>;
    importHistory(from: string): Promise<void>;
    run(manual?: boolean, options?: { ask?: boolean }): Promise<void>;
    /** Health Connect only: asks for the read permission, from a button (#3906). */
    requestPermission?(): Promise<{ granted: string[]; missing: string[] }>;
    /** Work owed (batches, a rebuild, a scan in progress): lets a rerun skip the throttle (#3906). */
    owed(): boolean;
  } | null;
  /** `ask: false`: a sync reads what is allowed and never opens a system permission sheet. */
  refresh: (options?: { ask?: boolean }) => Promise<void>;
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
/**
 * #3906 review: what the Allow button says once the system dialog returns. Granted goes on to the
 * import; denied keeps the in-app answer; a partial grant imports what it has and names the rest.
 */
export function permissionAnswer(
  result: { granted: string[]; missing: string[] } | undefined,
  name: string,
): { needsPermission: boolean; proceed: boolean; text: string } {
  if (!result || !result.granted.length)
    return {
      needsPermission: true,
      proceed: false,
      text: `Not allowed. Nothing was imported. Tap Allow to ask again, or allow TrainingAi in ${name}'s own settings.`,
    };
  return {
    needsPermission: false,
    proceed: true,
    text: result.missing.length
      ? `Allowed ${result.granted.join(', ')}. Still missing: ${result.missing.join(', ')}. Only what is allowed is imported.`
      : `Allowed in ${name}. Importing history.`,
  };
}
