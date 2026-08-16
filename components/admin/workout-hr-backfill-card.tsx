'use client'

import { HrBackfillCard } from './hr-backfill-card'

// The per-WORKOUT sibling of the per-set backfill (workout_hr_stats, migration 135 / Lever W). Its
// route has existed since 135 but had no button, and until v1.257.2 every write to that table failed
// anyway — `workout_hrv_ms` is an integer column and the rMSSD arriving from `rmssdFromRr` is a
// float, so Postgres rejected the whole insert and the fire-and-forget catch swallowed it. The table
// therefore sat at 0 rows across every session ever logged.
//
// With that fixed, this is what populates the history: run it once to snapshot the existing
// sessions, after which each recap keeps its own up to date.
export default function WorkoutHrBackfillCard() {
  return (
    <HrBackfillCard
      endpoint="/api/oura-ble/backfill-hr-stats"
      maxRows={500}
      title="Backfill per-workout HR summary"
      description={
        <>
          Fills each past workout&apos;s avg/peak HR, best 1-min recovery and rest-window HRV (last 180
          days) so they survive the raw-data prune. Run this once — the table was empty until the
          v1.257.2 fix. Safe to re-run.
        </>
      }
    />
  )
}
