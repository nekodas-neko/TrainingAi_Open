import type {
  HealthConnectType,
  HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
export type HealthConnectReader = {
  permissions(): Promise<HealthConnectType[]>;
  /** Asks for these read permissions and returns every type granted afterwards. */
  request?(types: HealthConnectType[]): Promise<HealthConnectType[]>;
  historyPermission?(): Promise<void>;
  hasHistoryPermission?(): Promise<boolean>;
  history(
    type: HealthConnectType,
    from: string,
    to: string,
    token?: string,
  ): Promise<{
    records: HealthConnectRecord[];
    pageToken: string | null;
    skipped: number;
    seenIds?: string[];
  }>;
  changes(
    types: HealthConnectType[],
    token?: string,
  ): Promise<{
    records: HealthConnectRecord[];
    deleted: string[];
    token: string;
    expired: boolean;
    more: boolean;
    skipped: number;
  }>;
};
