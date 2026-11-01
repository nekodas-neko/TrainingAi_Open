import { haversineDistanceKm } from '@/lib/activity/activity-metrics'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import type { KindAggregate } from './segment-stats'
import {
  MIN_SEGMENTS_FOR_SPEED_TARGET,
  type PaceBand,
  type TargetPair,
} from '@trainingai/shared/walking/walk-pacer'

// The pacer's bands, constants and ladder live once in `packages/shared` so Preview's walk reads
// the same definition of "on pace" (#3525). This module keeps what needs the app's GPS helpers.
export * from '@trainingai/shared/walking/walk-pacer'

/** km/h from a pace in seconds per kilometre. Null in, null out; a zero or negative pace is not a speed. */
export function kmhFromPace(secPerKm: number | null | undefined): number | null {
  if (secPerKm == null || secPerKm <= 0) return null
  return 3600 / secPerKm
}

/**
 * How far back the live speed reads, in seconds.
 *
 * Twenty is a compromise with one hard constraint on each side. Shorter and a single wandering GPS
 * fix — a few metres of drift between two samples — swings the band; longer and the reading stops
 * being *now*, which is the defect this exists to fix. LB-36's device check asks for the band to
 * move within about ten seconds of deliberately slowing, and a twenty-second window has moved most
 * of the way there by then.
 */
export const SPEED_WINDOW_SEC = 20

/**
 * The walker's speed over the last `SPEED_WINDOW_SEC`, in km/h — **not** the average since the walk
 * started (LA-52).
 *
 * The store used to feed `readPacer` with `kmhFromPace(currentPaceSecPerKm)`, and that pace is
 * cumulative distance over cumulative elapsed. Three things followed and none of them were visible
 * from a passing test: twenty minutes in, a thirty-second surge moves a cumulative mean by almost
 * nothing, so the band could not respond within a segment; `STOPPED_KMH` could never fire, because
 * standing still cannot drag a whole-walk average below 1.5 km/h; and warm-up, fast and slow all
 * banded against the same slowly-drifting number.
 *
 * Null under two points or a zero-length span — an unknown speed, which drops the pacer to the heart
 * rate rung rather than reading zero and announcing "Stopped".
 *
 * **It reads the points and nothing else, deliberately.** Adding a wall clock would let the figure
 * decay toward zero while the walker stands still and produces no new fixes — which is right when
 * they have stopped and wrong in a tunnel, and the store only recomputes when a point arrives
 * anyway. A GPS dropout therefore freezes this reading, exactly as it already freezes the cumulative
 * one.
 */
export function windowedSpeedKmh(points: RoutePoint[], windowSec: number = SPEED_WINDOW_SEC): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const cutoff = last.t - windowSec * 1000

  let start = points.findIndex(p => p.t >= cutoff)
  if (start < 0) start = points.length - 1
  // A sparse fix rate can leave one point inside the window. Reaching back for the previous one
  // makes the reading older than `windowSec` rather than absent, which is the better failure: an
  // absent speed silently demotes the whole rung to heart rate.
  if (points.length - start < 2) start = points.length - 2

  const elapsedSec = (last.t - points[start].t) / 1000
  if (elapsedSec <= 0) return null

  let km = 0
  for (let i = start + 1; i < points.length; i++) km += haversineDistanceKm(points[i - 1], points[i])
  return km / (elapsedSec / 3600)
}

/**
 * The speed rung's target pair, derived from the walker's own past fast/slow blocks rather than
 * asked for.
 *
 * `walk-config.tsx` already collects a cadence pair; asking for an HR pair, a cadence pair *and* a
 * speed pair would be three ways to state one intent. The history is already there —
 * `/api/guided-walk/segment-stats` aggregates `avgPaceSecPerKm` per kind across ~3 years of walks —
 * so the target is "your usual fast block", which is exactly the reference a mid-walk cue wants.
 *
 * Returns null rather than a half-pair whenever the history cannot support one, which drops the
 * ladder to heart rate: too few segments, no GPS-derived pace on either kind, or a degenerate pair
 * where the fast blocks were not actually faster than the slow ones.
 */
export function speedTargetsFromHistory(
  stats: { fast: KindAggregate; slow: KindAggregate } | null | undefined,
): TargetPair | null {
  if (!stats) return null
  const { fast, slow } = stats
  if (fast.count < MIN_SEGMENTS_FOR_SPEED_TARGET || slow.count < MIN_SEGMENTS_FOR_SPEED_TARGET) return null
  const fastKmh = kmhFromPace(fast.avgPaceSecPerKm)
  const slowKmh = kmhFromPace(slow.avgPaceSecPerKm)
  if (fastKmh == null || slowKmh == null) return null
  // Treadmill walks contribute heart rate but no pace, so a history of them leaves both averages
  // resting on a handful of outdoor blocks that may not separate. A pair that does not separate
  // cannot pace anything.
  if (fastKmh <= slowKmh) return null
  return { fast: fastKmh, slow: slowKmh }
}

/** Theme token for a band. Paired with {@link PacerReading.mark} at every call site, never alone. */
export function bandColor(band: PaceBand): string {
  if (band === 'green') return 'var(--color-brand)'
  if (band === 'amber') return 'var(--accent-amber)'
  if (band === 'red') return 'var(--color-destructive)'
  return 'var(--color-muted-foreground)'
}
