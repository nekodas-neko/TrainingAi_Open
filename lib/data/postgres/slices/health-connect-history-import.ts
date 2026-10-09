// How far back the user's explicit Health Connect "Import more history" run has reached (issue 2169,
// migration 202610081422). One row per account: the oldest local calendar day imported. Server-only,
// as `health_connect_intervals` is - Health Connect is the device-side copy.
import { eq, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'

type Db = ReturnType<typeof getDb>

export async function getHealthConnectHistoryOldest(db: Db, userId: string): Promise<string | null> {
  const t = s.healthConnectHistoryImport
  const [row] = await db.select({ oldestDate: t.oldestDate }).from(t).where(eq(t.userId, userId)).limit(1)
  return row?.oldestDate ?? null
}

/**
 * Move the stored day older, never newer. `LEAST` makes the writer idempotent and order-proof: two
 * overlapping runs, or a retry of a window that already landed, leave the cursor at the older of the
 * two instead of walking it forward and re-reading finished history. The only value taken from the
 * caller is the day itself, named in the column list - never a request body into `.set()`.
 */
export async function advanceHealthConnectHistoryOldest(db: Db, userId: string, date: string): Promise<string> {
  const t = s.healthConnectHistoryImport
  const [row] = await db.insert(t)
    .values({ userId, oldestDate: date })
    .onConflictDoUpdate({
      target: t.userId,
      set: { oldestDate: sql`LEAST(${t.oldestDate}, excluded.oldest_date)`, updatedAt: sql`now()` },
    })
    .returning({ oldestDate: t.oldestDate })
  return row.oldestDate
}
