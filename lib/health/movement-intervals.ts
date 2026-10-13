import type { HealthConnectIntervalRow } from '@/lib/data/repository';

export function mergeMovementIntervals(
  legacy: HealthConnectIntervalRow[],
  native: HealthConnectIntervalRow[],
) {
  const rows = new Map<string, HealthConnectIntervalRow>();
  const fingerprints = new Set<string>();
  for (const row of [...native, ...legacy]) {
    const id = `${row.kind}:${row.recordId.replace(/^health_connect:/, '')}`;
    const fingerprint = `${row.kind}:${row.dataOrigin}:${row.startAt.getTime()}:${row.endAt.getTime()}:${row.value}`;
    if (rows.has(id) || fingerprints.has(fingerprint)) continue;
    rows.set(id, row);
    fingerprints.add(fingerprint);
  }
  return [...rows.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
