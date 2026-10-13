import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { getDb } from '../client';
import * as s from '../schema';
import type { HealthConnectIntervalRow } from '../../repository';

type Kind = 'steps' | 'active_kcal';
const appleTypes = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  active_kcal: 'HKQuantityTypeIdentifierActiveEnergyBurned',
} as const;
const androidTypes = { steps: 'Steps', active_kcal: 'ActiveCaloriesBurned' } as const;

export async function getNativeMovementIntervals(
  db: ReturnType<typeof getDb>,
  userId: string,
  kind: Kind,
  from: Date,
  to: Date,
): Promise<HealthConnectIntervalRow[]> {
  const apple = s.appleHealthSamples,
    android = s.healthConnectRecords;
  const [appleRows, androidRows] = await Promise.all([
    db
      .select()
      .from(apple)
      .where(
        and(
          eq(apple.userId, userId),
          eq(apple.sampleType, appleTypes[kind]),
          isNull(apple.deletedAt),
          gte(apple.startAt, from),
          lt(apple.startAt, to),
        ),
      ),
    db
      .select()
      .from(android)
      .where(
        and(
          eq(android.userId, userId),
          isNull(android.deletedAt),
          sql`${android.recordPayload}->>'type' = ${androidTypes[kind]}`,
          sql`(${android.recordPayload}->>'start')::timestamptz >= ${from.toISOString()}::timestamptz`,
          sql`(${android.recordPayload}->>'start')::timestamptz < ${to.toISOString()}::timestamptz`,
        ),
      ),
  ]);
  const rows: HealthConnectIntervalRow[] = appleRows.flatMap((row) =>
    row.startAt && row.endAt && row.quantityValue != null
      ? [
          {
            kind,
            recordId: `apple_health:${row.sampleId}`,
            startAt: row.startAt,
            endAt: row.endAt,
            value: row.quantityValue,
            dataOrigin: row.sourceBundleId ?? 'apple_health',
            deviceType: row.deviceModel ?? row.deviceName,
          },
        ]
      : [],
  );
  for (const { recordPayload: row } of androidRows) {
    if (row?.value == null) continue;
    rows.push({
      kind,
      recordId: `health_connect:${row.id}`,
      startAt: new Date(row.start),
      endAt: new Date(row.end),
      value: row.value,
      dataOrigin: row.sourcePackage,
      deviceType: row.deviceModel ?? null,
    });
  }
  return rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
