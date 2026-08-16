'use client'

import { HrBackfillCard } from './hr-backfill-card'

// One-off admin utility: materialise per-set HR snapshots (set_hr_stats, migration 139) for existing
// completed sessions still inside the 180d oura_heartrate retention window, so the "Heart & Recovery"
// exercise trends have back-data immediately instead of only filling in going forward.
//
// "New workouts populate automatically" is only true if the recap is opened — attribution runs from
// `GET /api/oura/hr-data`, which is the recap fetch, and there is no other trigger. Four recent
// sessions had zero rows for exactly that reason (2026-08-05), so re-running this is the remedy
// whenever a workout ends without its recap being viewed.
export default function SetHrBackfillCard() {
  return (
    <HrBackfillCard
      endpoint="/api/workout/backfill-set-hr-stats"
      maxRows={500}
      title="Backfill per-set HR stats"
      description={
        <>
          Fills the Heart &amp; Recovery trends for past workouts (last 180 days). New workouts populate
          when you open their recap — run this to catch any you skipped. Safe to re-run.
        </>
      }
    />
  )
}
