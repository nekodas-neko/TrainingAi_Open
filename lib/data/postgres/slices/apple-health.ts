import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DEFAULT_TZ } from '@trainingai/shared/date-utils';
import {
  appleTypes,
  type AppleImportBatch,
  type AppleSample,
} from '@trainingai/shared/validation/apple-health-import';
import { projectAppleHealth } from '@trainingai/shared/health/apple-health-projection';
import type { getDb } from '../client';
import * as s from '../schema';
import { projectionLock, queueHealthDays, rebuildNativeHealth, healthProjectionStart } from './native-health';
type Db = ReturnType<typeof getDb>;
const source = 'apple_health' as const;
export async function applyAppleHealthBatch(
  db: Db,
  userId: string,
  batch: AppleImportBatch,
  timezone = DEFAULT_TZ,
) {
  const t = s.appleHealthSamples;
  await db.transaction(async (tx) => {
    await tx.execute(projectionLock(userId, source));
    const ids = [...batch.samples.map((row) => row.id), ...batch.deleted];
    const previous = ids.length
      ? await tx
          .select()
          .from(t)
          .where(and(eq(t.userId, userId), inArray(t.sampleId, ids)))
      : [];
    if (batch.samples.length)
      await tx
        .insert(t)
        .values(
          batch.samples.map((row) => ({
            userId,
            sampleId: row.id,
            sampleType: batch.type,
            startAt: new Date(row.start),
            endAt: new Date(row.end),
            quantityValue: appleTypes[batch.type].unit ? row.value : null,
            quantityUnit: appleTypes[batch.type].unit,
            categoryValue: appleTypes[batch.type].unit ? null : row.value,
            sourceBundleId: row.sourceBundleId,
            sourceName: row.sourceName,
            deviceName: row.deviceName,
            deviceModel: row.deviceModel,
          })),
        )
        .onConflictDoNothing();
    if (batch.deleted.length)
      await tx
        .insert(t)
        .values(
          batch.deleted.map((id) => ({
            userId,
            sampleId: id,
            sampleType: batch.type,
            deletedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [t.userId, t.sampleId],
          set: {
            deletedAt: sql`COALESCE(${t.deletedAt},excluded.deleted_at)`,
            updatedAt: sql`CASE WHEN ${t.deletedAt} IS NULL THEN NOW() ELSE ${t.updatedAt} END`,
          },
        });
    await queueHealthDays(
      tx as unknown as Db,
      userId,
      source,
      [
        ...previous.flatMap((row) =>
          row.startAt && row.endAt
            ? [
                {
                  start: row.startAt.toISOString(),
                  end: row.endAt.toISOString(),
                  sleep: row.sampleType === 'HKCategoryTypeIdentifierSleepAnalysis',
                },
              ]
            : [],
        ),
        ...batch.samples.map((row) => ({
          start: row.start,
          end: row.end,
          sleep: batch.type === 'HKCategoryTypeIdentifierSleepAnalysis',
        })),
      ],
      timezone,
    );
  });
  return { accepted: batch.samples.length, deleted: batch.deleted.length };
}
export async function rebuildAppleHealth(db: Db, userId: string, timezone: string) {
  const result = await rebuildNativeHealth(
    db,
    userId,
    source,
    timezone,
    async (tx, from, to) => {
      const t = s.appleHealthSamples;
      const rows = await tx
        .select()
        .from(t)
        .where(
          and(eq(t.userId, userId), isNull(t.deletedAt), gte(t.endAt, from), gte(t.startAt, healthProjectionStart(from, timezone)), lt(t.startAt, to)),
        );
      const samples: AppleSample[] = rows.flatMap((row) =>
        row.startAt && row.endAt && row.sourceBundleId && row.sampleType in appleTypes
          ? [
              {
                id: row.sampleId,
                type: row.sampleType as AppleSample['type'],
                start: row.startAt.toISOString(),
                end: row.endAt.toISOString(),
                value: row.quantityValue ?? row.categoryValue ?? 0,
                sourceBundleId: row.sourceBundleId,
                sourceName: row.sourceName ?? row.sourceBundleId,
                deviceName: row.deviceName,
                deviceModel: row.deviceModel,
              },
            ]
          : [],
      );
      return projectAppleHealth(samples, timezone);
    },
  );
  return {
    ...result,
    hrv: result.hrv?.method === 'SDNN' ? { ...result.hrv, method: 'SDNN' as const } : null,
  };
}
