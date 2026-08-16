// Workout-cooldown recovery-episode detection (HRP-2, plan 2026-07-22-hr-recovery-profile.md).
// Detects ONE recovery episode per completed Oura-classified workout (an `ouraWorkouts` row): the
// workout's peak HR and how it declines into the rest immediately after. This is the `run_cooldown`
// source from hr-recovery-profile.ts's RecoveryEpisode type, applied at whole-workout granularity —
// the same peak-then-decline shape lib/workout/set-hr-stats.ts already proves out for lifting sets,
// re-implemented here at the workout level (set-hr-stats.ts's dropAt/firstCrossingSec are private
// closures, not reusable as-is; unifying them into one shared module is a documented follow-up, not
// done here to avoid touching shipped, tested per-set code).
//
// SCOPE (deliberately limited): this detects exactly one episode per completed workout — the
// post-effort cooldown. True WITHIN-workout interval-rep detection (multiple peak/decline cycles
// inside one continuous run, e.g. a fartlek) is NOT implemented: the running system has no
// execution-time segment tracking to anchor on (confirmed — no interval-rep start/end data exists
// anywhere in the schema), and a general-purpose multi-peak detector over noisy, unconstrained HR is
// exactly the highest-risk, lowest-value piece the spec (§6) warns against building first. Deferred
// as a documented backlog follow-up (HRP-2b), not silently dropped.
//
// Any Oura-classified workout is treated as a candidate — activity type is NOT pattern-matched
// (no hardcoded "running"/"cycling" strings), consistent with the source-agnostic RecoveryEpisode
// design. Known limitation: a strength workout that Oura also auto-detects will produce BOTH this
// whole-session cooldown episode AND the many per-set episodes from set_hr_stats for the same time
// span — these measure different things (session-end recovery vs. per-set micro-recovery) so it's
// not wrong, but no cross-source de-duplication is attempted in this phase.
import { nearestBpm, type HrReading } from '@trainingai/shared/workout/hr-analysis'
import type { RecoveryEpisode } from './hr-recovery-profile'

export interface WorkoutWindow {
  startDatetime: Date
  endDatetime: Date
}

// How far past the workout's end to look for the decline — mirrors computeWorkoutHr's ±10min pattern.
export const WORKOUT_COOLDOWN_PADDING_MS = 10 * 60_000
const NEAREST_TOL_MS = 30_000
// Ambient HR is thinned to ~1 sample/30s; a real monitored workout+cooldown at that rate should clear
// this easily — below it the drop curve isn't trustworthy (mirrors set-hr-stats.ts's same gate).
const MIN_COVERAGE_SAMPLES = 5

function readingsInWindow(readings: HrReading[], fromMs: number, toMs: number): HrReading[] {
  return readings.filter(r => {
    const t = r.timestamp.getTime()
    return t >= fromMs && t <= toMs
  })
}

function dropAtOffset(
  readings: HrReading[], bpmAtEnd: number, endMs: number, offsetSec: number, horizonEndMs: number,
): number | null {
  const targetMs = endMs + offsetSec * 1000
  if (targetMs > horizonEndMs) return null
  const b = nearestBpm(readings, new Date(targetMs), NEAREST_TOL_MS)
  return b != null ? bpmAtEnd - b : null
}

/** Seconds from `fromMs` to the first reading in (fromMs, toMs] at or below `threshold`. `hadData`
 *  distinguishes "searched a populated window and never crossed" (censored) from "no readings at all"
 *  (unknown). Readings must be sorted ascending by timestamp. */
function firstCrossingSec(
  readings: HrReading[], fromMs: number, toMs: number, threshold: number,
): { sec: number | null; hadData: boolean } {
  let hadData = false
  for (const r of readings) {
    const t = r.timestamp.getTime()
    if (t <= fromMs) continue
    if (t > toMs) break
    hadData = true
    if (r.bpm <= threshold) return { sec: Math.round((t - fromMs) / 1000), hadData: true }
  }
  return { sec: null, hadData }
}

/** Detect the cooldown recovery episode for one completed workout. `readings` should already span at
 *  least [workout.startDatetime, workout.endDatetime + WORKOUT_COOLDOWN_PADDING_MS] — fetch once per
 *  workout (bounded, cheap indexed range query), not the whole lookback window. `restingHr` is the
 *  day's resting-HR baseline (`resolveHrProfile`); pass null to skip the resting-HR recovery model
 *  (peak/drop-curve fields are still computed). Returns null when there's no trustworthy peak or too
 *  few samples to trust the drop curve — never a fabricated episode. Pure; never throws. */
export function detectWorkoutCooldownEpisode(
  readings: HrReading[], workout: WorkoutWindow, restingHr: number | null,
): RecoveryEpisode | null {
  const startMs = workout.startDatetime.getTime()
  const endMs = workout.endDatetime.getTime()
  if (!(endMs > startMs)) return null

  const effortReadings = readingsInWindow(readings, startMs, endMs)
  if (effortReadings.length === 0) return null
  const peakBpm = Math.max(...effortReadings.map(r => r.bpm))

  const bpmAtEnd = nearestBpm(readings, workout.endDatetime, NEAREST_TOL_MS)
  if (bpmAtEnd == null) return null

  const horizonEndMs = endMs + WORKOUT_COOLDOWN_PADDING_MS
  const spanReadings = readingsInWindow(readings, startMs, horizonEndMs)
  if (spanReadings.length < MIN_COVERAGE_SAMPLES) return null

  const drop30s = dropAtOffset(readings, bpmAtEnd, endMs, 30, horizonEndMs)
  const drop60s = dropAtOffset(readings, bpmAtEnd, endMs, 60, horizonEndMs)
  const drop90s = dropAtOffset(readings, bpmAtEnd, endMs, 90, horizonEndMs)
  const drop120s = dropAtOffset(readings, bpmAtEnd, endMs, 120, horizonEndMs)

  let secToResting: number | null = null
  let recoveredResting: boolean | null = null
  if (restingHr != null) {
    const { sec, hadData } = firstCrossingSec(readings, endMs, horizonEndMs, restingHr)
    secToResting = sec
    recoveredResting = hadData ? sec != null : null
  }

  return {
    peakBpm, loggedAt: workout.endDatetime, source: 'run_cooldown',
    drop30s, drop60s, drop90s, drop120s,
    secToResting, recoveredResting,
  }
}
