export interface HealthMetric {
  key: string;
  label: string;
  value: string | null;
  detail: string;
  source?: string;
}
export interface HealthSnapshot {
  mode: 'sample' | 'device';
  readAt: string;
  metrics: HealthMetric[];
  inspection?: HealthInspection;
}
export interface HealthInspection {
  startAt: string;
  endAt: string;
  entries: HealthInspectionEntry[];
}
export interface HealthInspectionEntry {
  key: string;
  label: string;
  status: 'records' | 'empty' | 'error' | 'unsupported';
  count?: number;
  limited?: boolean;
  latestValue?: string;
  latestStart?: string;
  latestEnd?: string;
  detail?: string;
  sources: { name: string; bundleIdentifier: string; count: number; latestAt: string }[];
}
