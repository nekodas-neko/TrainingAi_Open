import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DEFAULT_TZ } from '@trainingai/shared/date-utils';
import type { HealthConnectBatch } from '@trainingai/shared/validation/health-connect-import';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import type { getDb } from '../client';
import * as s from '../schema';
import { projectionLock, queueHealthDays, rebuildNativeHealth, healthProjectionStart } from './native-health';
type Db = ReturnType<typeof getDb>;
const source = 'health_connect_native' as const;
export async function applyHealthConnectBatch(
  db: Db,
  userId: string,
  batch: HealthConnectBatch,
  timezone = DEFAULT_TZ,
) {
  const t = s.healthConnectRecords;
  await db.transaction(async (tx) => {
    await tx.execute(projectionLock(userId, source));
    const ids = [...batch.records.map((row) => row.id), ...batch.deleted];
    const previous = ids.length
      ? await tx
          .select()
          .from(t)
          .where(and(eq(t.userId, userId), inArray(t.recordId, ids)))
      : [];
    if (batch.records.length)
      await tx
        .insert(t)
        .values(
          batch.records.map((row) => ({
            userId,
            recordId: row.id,
            recordPayload: row,
            recordType: row.type,
            startAt: new Date(row.start),
            endAt: new Date(row.end),
            value: row.value,
            sourcePackage: row.sourcePackage,
            modifiedAt: new Date(row.modifiedAt),
          })),
        )
        .onConflictDoUpdate({
          target: [t.userId, t.recordId],
          set: {
            recordPayload: sql`excluded.record_payload`,
            recordType: sql`excluded.record_type`,
            startAt: sql`excluded.start_at`,
            endAt: sql`excluded.end_at`,
            value: sql`excluded.value`,
            sourcePackage: sql`excluded.source_package`,
            modifiedAt: sql`excluded.modified_at`,
            updatedAt: new Date(),
          },
          setWhere: sql`${t.deletedAt} IS NULL AND excluded.modified_at >= ${t.modifiedAt}`,
        });
    if (batch.deleted.length)
      await tx
        .insert(t)
        .values(batch.deleted.map((recordId) => ({ userId, recordId, deletedAt: new Date() })))
        .onConflictDoUpdate({
          target: [t.userId, t.recordId],
          set: {
            deletedAt: sql`COALESCE(${t.deletedAt},excluded.deleted_at)`,
            updatedAt: new Date(),
          },
        });
    await queueHealthDays(
      tx as unknown as Db,
      userId,
      source,
      [
        ...previous.flatMap((row) => (row.recordPayload ? [row.recordPayload] : [])),
        ...batch.records,
      ].map((row) => ({ start: row.start, end: row.end, sleep: row.type === 'SleepSession' })),
      timezone,
    );
  });
  return { accepted: batch.records.length, deleted: batch.deleted.length };
}
export async function rebuildHealthConnect(db: Db, userId: string, timezone: string) {
  const result = await rebuildNativeHealth(
    db,
    userId,
    source,
    timezone,
    async (tx, from, to) => {
      const t = s.healthConnectRecords;
      const records = await tx
        .select()
        .from(t)
        .where(
          and(eq(t.userId, userId), isNull(t.deletedAt), gte(t.endAt, from), gte(t.startAt, healthProjectionStart(from, timezone)), lt(t.startAt, to)),
        );
      return projectHealthConnect(
        records.flatMap((row) => (row.recordPayload ? [row.recordPayload] : [])),
        timezone,
      );
    },
  );
  return {
    ...result,
    hrv: result.hrv?.method === 'RMSSD' ? { ...result.hrv, method: 'RMSSD' as const } : null,
  };
}
