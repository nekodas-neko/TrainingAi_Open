import {
  activityImplausibleReason,
  MAX_ACTIVITY_DURATION_MIN, MAX_ACTIVITY_DISTANCE_KM, MAX_ACTIVITY_KCAL,
  MAX_ACTIVITY_STEPS, MAX_ACTIVITY_ELEVATION_M, MAX_PACE_SEC_PER_KM,
  MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM,
} from './plausibility'
import { MAX_PLAUSIBLE_SPM } from '@trainingai/shared/health/cadence'
import { z } from 'zod'

// Shared by the web route (app/api/activity-logs/route.ts) and pushMutations
// so an outbox payload can never write through unvalidated, and endTime
// derivation can't drift between the two write paths (SYNC-P3).
const SplitSchema = z.object({
  km: z.number().nonnegative().max(MAX_ACTIVITY_DISTANCE_KM),
  paceSec: z.number().nonnegative().max(MAX_PACE_SEC_PER_KM),
})
const PacePointSchema = z.object({
  tSec: z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN * 60),
  paceSec: z.number().nonnegative().max(MAX_PACE_SEC_PER_KM),
})
const ElevationPointSchema = z.object({
  distKm: z.number().nonnegative().max(MAX_ACTIVITY_DISTANCE_KM),
  // Signed: an elevation profile carries altitude, which is below sea level in places.
  eleM: z.number().min(-MAX_ACTIVITY_ELEVATION_M).max(MAX_ACTIVITY_ELEVATION_M),
})
const CadencePointSchema = z.object({
  tSec: z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN * 60),
  spm: z.number().nonnegative().max(MAX_PLAUSIBLE_SPM),
})
const WalkSegmentStatSchema = z.object({
  index: z.number().int().nonnegative().max(1000),
  setNumber: z.number().int().nonnegative().max(1000),
  kind: z.enum(['warmup', 'fast', 'slow', 'cooldown']),
  startSec: z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN * 60),
  endSec: z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN * 60),
  // Segment means are rounded to 1dp by computeWalkSegmentStats, so these are NOT integers.
  // `.int()` here rejected the whole activity payload on both write paths and dead-lettered
  // every guided walk whose segment mean HR wasn't whole (2026-08-02). The `segments` JSONB
  // column types these as plain `number | null`, so a fractional value stores fine.
  avgHr: z.number().min(MIN_PLAUSIBLE_BPM).max(MAX_PLAUSIBLE_BPM).nullable(),
  maxHr: z.number().min(MIN_PLAUSIBLE_BPM).max(MAX_PLAUSIBLE_BPM).nullable(),
  hrAtStart: z.number().min(MIN_PLAUSIBLE_BPM).max(MAX_PLAUSIBLE_BPM).nullable(),
  avgPaceSecPerKm: z.number().positive().max(MAX_PACE_SEC_PER_KM).nullable(),
  distanceKm: z.number().nonnegative().max(MAX_ACTIVITY_DISTANCE_KM).nullable(),
  avgCadenceSpm: z.number().nonnegative().max(MAX_PLAUSIBLE_SPM).nullable(),
})

export const ActivityLogBody = z.object({
  // Both separators: the client fills date params from localDateString(), which emits
  // slashes — a dash-only regex rejects every real request before the handler runs (Q-130).
  date:            z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  activityType:    z.string().min(1),
  title:           z.string().min(1).max(120),
  startTime:       z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime:         z.string().regex(/^\d{2}:\d{2}$/).optional(),
  // `.nonnegative()`, not `.positive()` (Q-351). `activity-store.ts` rounds to one decimal, so an
  // activity under **3 real seconds** becomes exactly `0` — and `.positive()` then rejected it, the
  // route answered a bare `400 {"error":"Invalid body"}`, and the UI reported "Failed to save
  // activity". The recording was discarded and the user was told the save failed rather than that
  // the activity was too short to measure. Measured on the Q-450 E2E spec: 2 s → 400 with
  // `activity_logs` still empty, 5 s → 201 with `duration_min = 0.1`.
  //
  // Accepting the zero is the honest outcome: the user pressed Start and Finish, so the activity
  // happened, and a row saying it lasted ~0 minutes is worth more than silence plus a wrong error.
  // It also removes the same failure from the **offline** path — `pushMutations` parses with this
  // schema, and a sub-3-second activity queued offline was landing in `errors[]` and being dropped.
  //
  // Safe by construction, not by luck: the cross-field rate checks below already skip a zero
  // duration (`plausibility.ts:115` sets `mins = null` and returns before any division), which is
  // what the comment on `.superRefine` has always said. Every other field stays bounded on its own.
  durationMin:     z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN).optional(),
  distanceKm:      z.number().positive().max(MAX_ACTIVITY_DISTANCE_KM).optional(),
  caloriesBurned:  z.number().positive().max(MAX_ACTIVITY_KCAL).optional(),
  notes:           z.string().max(1000).optional(),
  routePolyline:   z.string().optional(),
  splits:          z.array(SplitSchema).max(200).optional(),
  bestEfforts:     z.record(z.string(), z.number().nonnegative().max(MAX_ACTIVITY_DURATION_MIN * 60)).optional(),
  paceSeries:      z.array(PacePointSchema).max(2000).optional(),
  avgPaceSecPerKm: z.number().positive().max(MAX_PACE_SEC_PER_KM).optional(),
  elevationGainM:  z.number().nonnegative().max(MAX_ACTIVITY_ELEVATION_M).optional(),
  elevationLossM:  z.number().nonnegative().max(MAX_ACTIVITY_ELEVATION_M).optional(),
  elevationProfile: z.array(ElevationPointSchema).max(2000).optional(),
  avgHr:           z.number().int().min(MIN_PLAUSIBLE_BPM).max(MAX_PLAUSIBLE_BPM).optional(),
  maxHr:           z.number().int().min(MIN_PLAUSIBLE_BPM).max(MAX_PLAUSIBLE_BPM).optional(),
  steps:           z.number().int().nonnegative().max(MAX_ACTIVITY_STEPS).optional(),
  // Bounds mirror MIN/MAX_PLAUSIBLE_SPM in lib/health/cadence.ts — a value outside them is
  // a decode error, not a person, and must not reach the DB from either write path.
  cadenceSpm:      z.number().min(60).max(220).optional(),
  cadenceSeries:   z.array(CadencePointSchema).max(1000).optional(),
  cadenceSource:   z.enum(['ring', 'strap']).optional(),
  segments:        z.array(WalkSegmentStatSchema).max(500).optional(),
})
  // Cross-field: every numeric above is bounded on its own (Q-164), but the COMBINATION needs its
  // own check — 420 km in 1 minute at 900,000 kcal is individually in range and jointly absurd.
  // The two layers are complementary: the rate checks below are all skipped when `durationMin` is
  // absent or zero, which is exactly the hole the single-field `.max()`es above now close. Applied on the schema rather than in
  // the route so the offline `activity_logs` push branch, which parses with this same schema, gets
  // it too; that branch writes with `overwrite: true`, so bad data there REPLACES a genuine
  // Health-Connect or Oura row rather than merely joining it.
  .superRefine((v, ctx) => {
    const reason = activityImplausibleReason(v)
    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Implausible activity: ${reason}` })
  })

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (((h * 60 + m + Math.round(minutes)) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function deriveEndTime(startTime: string | undefined, durationMin: number | undefined, providedEndTime: string | undefined): string | undefined {
  return providedEndTime ?? (startTime && durationMin != null ? addMinutes(startTime, durationMin) : undefined)
}
