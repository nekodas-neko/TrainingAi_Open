// Colmi R09 ring storage — LEARNING MODE (PS-8, migration 231).
//
// These tables are separate from the scoring inputs on purpose; see migration 231's header for why
// ranking a source cannot deliver that isolation. Nothing here reads or writes
// oura_heartrate / body_metrics / sleep_sessions / oura_daily / oura_daily_derived, and
// scripts/check-learning-mode-isolation.js fails CI if that changes.
import { eq, and, gte, lte, asc, desc, inArray } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'

type Db = ReturnType<typeof getDb>

export type ColmiReadingKind =
  | 'heart_rate' | 'steps' | 'calories' | 'distance'
  | 'hrv' | 'stress' | 'spo2' | 'temperature' | 'battery'

export interface ColmiReadingInput {
  kind: ColmiReadingKind
  measuredAt: Date
  localDate: string
  value: number
  valueHigh?: number | null
}

export interface ColmiSleepSegmentInput {
  localDate: string
  startedAt: Date
  endedAt: Date
  stage: number
  minutes: number
}

/**
 * Idempotent bulk insert. A re-sync overlapping a previous one is expected — the ring's history
 * buffer is re-readable and the cursor is ours, not the ring's — so a repeat must be free rather
 * than a duplicate. `onConflictDoNothing` on `(user_id, kind, measured_at)` gives that; first
 * writer wins, which is correct here because the ring reports the same sample identically.
 */
export async function insertColmiReadings(db: Db, userId: string, rows: ColmiReadingInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await db.insert(s.colmiReadings)
    .values(rows.map(r => ({
      userId,
      kind: r.kind,
      measuredAt: r.measuredAt,
      localDate: r.localDate,
      value: r.value,
      valueHigh: r.valueHigh ?? null,
    })))
    .onConflictDoNothing()
    .returning({ id: s.colmiReadings.id })
  return inserted.length
}

export async function insertColmiSleepSegments(db: Db, userId: string, rows: ColmiSleepSegmentInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await db.insert(s.colmiSleepSegments)
    .values(rows.map(r => ({
      userId,
      localDate: r.localDate,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      stage: r.stage,
      minutes: r.minutes,
    })))
    .onConflictDoNothing()
    .returning({ id: s.colmiSleepSegments.id })
  return inserted.length
}

/** Point samples of one or more kinds in a window. Every read is `user_id`-scoped, no exceptions. */
export async function getColmiReadings(
  db: Db, userId: string, kinds: ColmiReadingKind[], from: Date, to: Date,
): Promise<{ kind: string; measuredAt: Date; localDate: string; value: number; valueHigh: number | null }[]> {
  if (kinds.length === 0) return []
  const rows = await db
    .select({
      kind: s.colmiReadings.kind,
      measuredAt: s.colmiReadings.measuredAt,
      localDate: s.colmiReadings.localDate,
      value: s.colmiReadings.value,
      valueHigh: s.colmiReadings.valueHigh,
    })
    .from(s.colmiReadings)
    .where(and(
      eq(s.colmiReadings.userId, userId),
      inArray(s.colmiReadings.kind, kinds),
      gte(s.colmiReadings.measuredAt, from),
      lte(s.colmiReadings.measuredAt, to),
    ))
    .orderBy(asc(s.colmiReadings.measuredAt))
  return rows
}

export async function getColmiSleepSegments(
  db: Db, userId: string, fromDate: string, toDate: string,
): Promise<{ localDate: string; startedAt: Date; endedAt: Date; stage: number; minutes: number }[]> {
  return db
    .select({
      localDate: s.colmiSleepSegments.localDate,
      startedAt: s.colmiSleepSegments.startedAt,
      endedAt: s.colmiSleepSegments.endedAt,
      stage: s.colmiSleepSegments.stage,
      minutes: s.colmiSleepSegments.minutes,
    })
    .from(s.colmiSleepSegments)
    .where(and(
      eq(s.colmiSleepSegments.userId, userId),
      gte(s.colmiSleepSegments.localDate, fromDate),
      lte(s.colmiSleepSegments.localDate, toDate),
    ))
    .orderBy(asc(s.colmiSleepSegments.startedAt))
}

/** Newest sample the ring has given us, for the pairing card's "last synced" readout. */
export async function getColmiLatestReadingAt(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ measuredAt: s.colmiReadings.measuredAt })
    .from(s.colmiReadings)
    .where(eq(s.colmiReadings.userId, userId))
    .orderBy(desc(s.colmiReadings.measuredAt))
    .limit(1)
  return row?.measuredAt ?? null
}
