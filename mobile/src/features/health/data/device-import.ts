export type DeviceImportState = {
  ready: boolean;
  busy: boolean;
  error: string | null;
  pending: number;
  enabled: boolean;
  skipped: number;
  /** Health Connect only: records left out as copies of data read first-hand, per type (#3115). */
  skippedFirstHand?: Record<string, number>;
  completed: {
    measurements: number;
    nights: number;
    days: number;
    heartRate: number;
    completedAt: string;
    hrv: { method: 'SDNN' | 'RMSSD'; value: number; at: string; source: string } | null;
  } | null;
  store: {
    getSnapshot(): { error: string | null; pending: number };
    cancel(): void;
    setEnabled(enabled: boolean): Promise<void>;
    importHistory(from: string): Promise<void>;
    run(manual?: boolean): Promise<void>;
  } | null;
  refresh: () => Promise<void>;
};
