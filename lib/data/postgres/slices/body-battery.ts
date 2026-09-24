import { eq, and, gte, lte, asc, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type { BodyBatteryDailyRow } from '../../repository'

type Db = ReturnType<typeof getDb>

// Write-through daily snapshot. The route calls this every time it computes, so
// the last call of the day lands as that day's end-of-day record. Keyed on
// (user_id, date) — repeated calls update the same row.
//
// TN-20 — and "the last call wins" is exactly what lost four days. A read whose waking-hours HR
// query comes back empty computes a whole day of nothing (`hrSampleCount` 0, charged 0, drained 0,
// `endValue` back at the anchor) and, before the guard below, wrote that straight over a correct
// row. Measured in production 2026-09-21: 4 of 84 days store `hr_sample_count = 0` against 272,
// 265, 1,954 and 3,767 raw samples, all four with `total_charged = total_drained = 0` and
// `end_value = anchor`. The owner's own screenshot had shown "−113 drained" on one of them hours
// before the row was flattened.
//
// **The entry guessed a recompute with a delete-before-guard (the Q-528 shape). There is no
// recompute and no delete** — this is the only writer of the table, and it is the ordinary read
// path. That is why nothing looked suspicious: the destructive write is a `GET`.
//
// The guard is deliberately "is the incoming row EMPTY?", not "does it have at least as many
// samples as the stored one?". A monotonic rule would also block a legitimate downward correction
// and could freeze a day at a bad value; the failure being fixed is zero-against-thousands, which
// the entry distinguishes from the ordinary case where a stored count sits slightly *below* raw
// because of waking-hours windowing.
//
// It also repairs rather than only protecting: a later read of the same day that DOES see samples
// passes the guard and overwrites the empty row, so a day flattened in the morning heals itself by
// evening. That is this entry's pass test, met by the write path instead of by a backfill.
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
      // Never overwrite a day that RECORDED MOVEMENT with one that recorded none. A row that
      // measured nothing is still insertable (a genuinely sample-less day) and still replaceable by
      // another such row — what cannot happen is measured → unmeasured.
      //
      // ⚠ RV-163 widened this from `hr_sample_count > 0`, which counted a day as measured on a
      // single sample. 2026-09-23 stored **2** samples against the ring's 203, with 0 charged, 0
      // drained and `end_value` sitting on the anchor — the flattened shape exactly, passing a
      // guard written to stop it. That was TN-20's unidentified trigger.
      //
      // It is deliberately still a SHAPE test rather than a threshold. TN-20 ruled out a monotonic
      // `excluded >= stored` because it freezes a day at a bad value and blocks a legitimate
      // downward correction, and that reasoning holds; a "fewer than N samples" floor would just be
      // the same rule with an invented constant. All four days TN-20 measured, and this one, share
      // charged = 0 AND drained = 0 — a day that genuinely moved never looks like that, whatever
      // its sample count. So no constant is chosen here, and a corrected day with real movement
      // still writes.
      //
      // It still repairs: a later read that does see movement passes and overwrites the flat row.
      setWhere: sql`
        (excluded.hr_sample_count > 0 AND (excluded.total_charged > 0 OR excluded.total_drained > 0))
        OR ${s.bodyBatteryDaily.hrSampleCount} = 0
        OR (${s.bodyBatteryDaily.totalCharged} = 0 AND ${s.bodyBatteryDaily.totalDrained} = 0)
      `,
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
