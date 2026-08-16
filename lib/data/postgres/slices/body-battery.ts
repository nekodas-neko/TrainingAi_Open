import { eq, and, gte, lte, asc, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type { BodyBatteryDailyRow } from '../../repository'

type Db = ReturnType<typeof getDb>

// Write-through daily snapshot. The route calls this every time it computes, so
// the last call of the day lands as that day's end-of-day record. Keyed on
// (user_id, date) — repeated calls update the same row.
export async function upsertBodyBatteryDaily(db: Db, userId: string, row: BodyBatteryDailyRow): Promise<void> {
  await db.insert(s.bodyBatteryDaily)
    .values({
      userId,
      date:          row.date,
      anchor:        row.anchor,
      anchorSource:  row.anchorSource,
      endValue:      row.endValue,
      dayMin:        row.dayMin,
      dayMax:        row.dayMax,
      totalCharged:  row.totalCharged,
      totalDrained:  row.totalDrained,
      restingHr:     row.restingHr,
      hrMax:         row.hrMax,
      hrMaxObserved: row.hrMaxObserved ?? null,
      hrSampleCount: row.hrSampleCount,
      modelVersion:  row.modelVersion,
    })
    .onConflictDoUpdate({
      target: [s.bodyBatteryDaily.userId, s.bodyBatteryDaily.date],
      set: {
        anchor:        row.anchor,
        anchorSource:  row.anchorSource,
        endValue:      row.endValue,
        dayMin:        row.dayMin,
        dayMax:        row.dayMax,
        totalCharged:  row.totalCharged,
        totalDrained:  row.totalDrained,
        restingHr:     row.restingHr,
        hrMax:         row.hrMax,
        hrMaxObserved: row.hrMaxObserved ?? null,
        hrSampleCount: row.hrSampleCount,
        modelVersion:  row.modelVersion,
        updatedAt:     sql`now()`,
      },
    })
}

export async function getBodyBatteryHistory(
  db: Db, userId: string, startDate: string, endDate: string,
): Promise<BodyBatteryDailyRow[]> {
  const rows = await db
    .select()
    .from(s.bodyBatteryDaily)
    .where(and(
      eq(s.bodyBatteryDaily.userId, userId),
      gte(s.bodyBatteryDaily.date, startDate),
      lte(s.bodyBatteryDaily.date, endDate),
    ))
    .orderBy(asc(s.bodyBatteryDaily.date))
  return rows.map(r => ({
    date:          r.date,
    anchor:        r.anchor,
    anchorSource:  r.anchorSource,
    endValue:      r.endValue,
    dayMin:        r.dayMin,
    dayMax:        r.dayMax,
    totalCharged:  r.totalCharged,
    totalDrained:  r.totalDrained,
    restingHr:     r.restingHr,
    hrMax:         r.hrMax,
    hrMaxObserved: r.hrMaxObserved,
    hrSampleCount: r.hrSampleCount,
    modelVersion:  r.modelVersion,
  }))
}
