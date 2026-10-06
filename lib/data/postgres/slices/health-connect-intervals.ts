// Health Connect movement at the source's own resolution (#2462, migration 202610061624).
//
// Steps and active calories one row per Health Connect record, cadence one row per series sample.
// Server-only: Health Connect itself is the device-side copy and the sync re-reads its whole window
// every time, so there is no local-store domain and no outbox (docs/rules/offline-first-and-storage.md).
import { and, eq, gte, lt, asc, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import { collapseOnConflict } from '../collapse-conflicts'
import type { HealthConnectIntervalKind, HealthConnectIntervalRow } from '../../repository'

type Db = ReturnType<typeof getDb>

/** 8 params a row, so a chunk stays far under pg's 65,535 bind-parameter ceiling. */
const CHUNK = 5000

/**
 * Upsert by `(user_id, kind, record_id, start_at)`. A re-read window is the normal case, so an
 * unchanged row is left alone (`setWhere`), and a record the source app edited replaces its value.
 * Duplicates inside one batch are collapsed first, last wins — the arm is a bare `excluded.*`, and
 * one repeated key would otherwise fail the whole chunk (Q-214, `collapse-conflicts.ts`).
 */
export async function upsertHealthConnectIntervals(
  db: Db, userId: string, rows: readonly HealthConnectIntervalRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const values = collapseOnConflict(
    rows.map(r => ({
      userId, kind: r.kind, recordId: r.recordId, startAt: r.startAt, endAt: r.endAt, value: r.value,
      dataOrigin: r.dataOrigin, deviceType: r.deviceType,
    })),
    r => `${r.kind}|${r.recordId}|${r.startAt.getTime()}`,
  )
  const t = s.healthConnectIntervals
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(t)
      .values(values.slice(i, i + CHUNK))
      // The conflict target leads with user_id, so the matched row is already the caller's.
      .onConflictDoUpdate({
        target: [t.userId, t.kind, t.recordId, t.startAt],
        set: {
          endAt: sql`excluded.end_at`, value: sql`excluded.value`,
          dataOrigin: sql`excluded.data_origin`, deviceType: sql`excluded.device_type`, updatedAt: sql`now()`,
        },
        setWhere: sql`${t.endAt} IS DISTINCT FROM excluded.end_at OR ${t.value} IS DISTINCT FROM excluded.value
          OR ${t.dataOrigin} IS DISTINCT FROM excluded.data_origin OR ${t.deviceType} IS DISTINCT FROM excluded.device_type`,
      })
  }
  return values.length
}

/** One kind's rows starting in [from, to), oldest first. Overlap between apps is NOT resolved here
 *  — a step reader passes these through `stepCandidates`, which de-duplicates them. */
export async function getHealthConnectIntervals(
  db: Db, userId: string, kind: HealthConnectIntervalKind, from: Date, to: Date,
): Promise<HealthConnectIntervalRow[]> {
  const t = s.healthConnectIntervals
  const rows = await db.select({
    kind: t.kind, recordId: t.recordId, startAt: t.startAt, endAt: t.endAt, value: t.value,
    dataOrigin: t.dataOrigin, deviceType: t.deviceType,
  }).from(t)
    .where(and(eq(t.userId, userId), eq(t.kind, kind), gte(t.startAt, from), lt(t.startAt, to)))
    .orderBy(asc(t.startAt))
  return rows
}
