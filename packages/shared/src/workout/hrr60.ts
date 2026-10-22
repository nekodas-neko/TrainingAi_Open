// HRR60 — the heart-rate drop in the 60 s after a set, measured only where the series can see it.
// The one implementation behind `set_hr_stats.hrr1_bpm` (#2457, step 1 of #2299 v2), used by the
// per-set writer (`computeSetHrStats`) and the historical backfill alike.
//
// The rule the owner signed (#2299 v2, 2026-10-06): a value exists only when BOTH anchors — the
// set's end and end + 60 s — have a reading within 3 s, and no gap longer than 5 s lies between
// those two readings. That is "dense HR": the chest strap at 1 Hz passes; the ring's 5-minute
// points and its patchy beat stream do not, and a set measured only by them has no HRR60 — never a
// noisy one. Measured on production for the proposal: 276 of 893 sets qualify, all strap.
//
// It reads one merged series (`mergeHrSources`, strap-first) and never names a device, so any
// future source dense enough — a watch, another strap — qualifies with no new code.
import type { HrReading } from './hr-analysis'
import { ADEQUATE_HRR1_BPM } from './hr-analysis'
import { median } from '@trainingai/shared/stats'

/** A reading may sit at most this far from each anchor (set end, set end + 60 s). */
export const HRR60_ANCHOR_TOL_MS = 3_000
/** No gap between consecutive readings across the minute may exceed this. */
export const HRR60_MAX_GAP_MS = 5_000
const HRR60_OFFSET_MS = 60_000

export interface Hrr60 {
  /** HR(end) − HR(end + 60 s), bpm. Positive means the heart rate fell. */
  bpm: number
  /** The anchors' source when both share one, 'mixed' when they differ, null when neither carries one. */
  source: string | null
}

type SourcedReading = HrReading & { source?: string | null }

function nearestWithin(sorted: SourcedReading[], targetMs: number, tolMs: number): SourcedReading | null {
  let best: SourcedReading | null = null
  let bestDiff = Infinity
  for (const r of sorted) {
    const t = r.timestamp.getTime()
    if (t < targetMs - tolMs) continue
    if (t > targetMs + tolMs) break
    const d = Math.abs(t - targetMs)
    if (d < bestDiff) { best = r; bestDiff = d }
  }
  return best
}

/** The instant a set's rest is measured from: the timed set end, else the time it was logged. The ONE
 *  anchor — the live writer (`computeSetHrStats`) and the `backfill-set-hrr1` job both read it, so a
 *  timed set cannot get one HRR60 from the writer and another from the backfill (#3238). */
export function setRestAnchorMs(setEndMs: number | null | undefined, loggedAt: Date | null | undefined): number | null {
  return setEndMs ?? loggedAt?.getTime() ?? null
}

/**
 * HRR60 for a set ending at `setEndMs`, or null when the series is not dense enough to measure it.
 * Pure and total: unsorted input, non-finite values and an empty series all give null, never a throw.
 */
export function deriveHrr60(readings: readonly SourcedReading[], setEndMs: number | null): Hrr60 | null {
  return deriveHrrAt(readings, setEndMs, HRR60_OFFSET_MS)
}

/**
 * The same dense rule at any offset after the set (#2601, owner 2026-10-07): the drop curve's
 * `drop_30s`…`drop_120s` exist only where the series can see that offset, exactly as HRR60 does.
 * Before this a drop took the nearest reading within 30 s, which accepts the ring's sparse points:
 * 63 ring-only sets carried a `drop_60s` with a median of 0.
 */
export function deriveHrrAt(readings: readonly SourcedReading[], setEndMs: number | null, offsetMs: number): Hrr60 | null {
  if (setEndMs == null || !Number.isFinite(setEndMs) || !(offsetMs > 0)) return null
  const lo = setEndMs - HRR60_ANCHOR_TOL_MS
  const hi = setEndMs + offsetMs + HRR60_ANCHOR_TOL_MS
  const window = readings
    .filter(r => {
      const t = r.timestamp?.getTime?.()
      return t != null && Number.isFinite(t) && t >= lo && t <= hi && Number.isFinite(r.bpm)
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  if (window.length < 2) return null

  const atEnd = nearestWithin(window, setEndMs, HRR60_ANCHOR_TOL_MS)
  const at60 = nearestWithin(window, setEndMs + offsetMs, HRR60_ANCHOR_TOL_MS)
  if (!atEnd || !at60 || atEnd === at60) return null

  const from = atEnd.timestamp.getTime()
  const to = at60.timestamp.getTime()
  let prev = from
  for (const r of window) {
    const t = r.timestamp.getTime()
    if (t <= from) continue
    if (t > to) break
    if (t - prev > HRR60_MAX_GAP_MS) return null
    prev = t
  }

  const a = atEnd.source ?? null
  const b = at60.source ?? null
  const source = a == null && b == null ? null : a === b ? a : a == null ? b : b == null ? a : 'mixed'
  return { bpm: Math.round(atEnd.bpm - at60.bpm), source }
}

/** The personal bar's bounds and inputs (#2299 v2, owner-signed 2026-10-06). Never harsher than the
 *  15 bpm population bar it replaces, never below 5. */
export const HRR60_BAR_MIN_BPM = 5
export const HRR60_BAR_MAX_BPM = ADEQUATE_HRR1_BPM
/** Measured sets needed before the bar is the person's own; fewer keep the population 15. */
export const HRR60_BAR_MIN_SETS = 20
/** How far back the measured sets are read: from local midnight this many days before the session's
 *  day, up to the session's start. */
export const HRR60_BAR_WINDOW_DAYS = 30

/**
 * The person's "adequate rest" bar: the median of their own measured HRR60 over the last
 * HRR60_BAR_WINDOW_DAYS, clamped to [5, 15]; the population 15 until HRR60_BAR_MIN_SETS exist.
 * The owner: "Let's have it specific to the user."
 */
export function personalHrr60Bar(recentHrr60Bpm: readonly number[]): number {
  const measured = recentHrr60Bpm.filter(Number.isFinite)
  if (measured.length < HRR60_BAR_MIN_SETS) return ADEQUATE_HRR1_BPM
  const m = median(measured) as number
  return Math.min(HRR60_BAR_MAX_BPM, Math.max(HRR60_BAR_MIN_BPM, m))
}

/**
 * The rest verdict from a measured HRR60 against a bar (`personalHrr60Bar`; the population 15 when
 * none is given). Null when there is no measurement: a set with no HRR60 is "not measured", never a
 * cross. The one place the verdict is decided — the stored `rest_adequate`, its backfill and the
 * live recap all call it.
 */
export function restAdequateFromHrr60(hrr60Bpm: number | null, barBpm: number = ADEQUATE_HRR1_BPM): boolean | null {
  return hrr60Bpm == null ? null : hrr60Bpm >= barBpm
}

/**
 * The live recap's per-set recovery on the same footing as the stored row (#2299 step 2): `hrr1` is
 * the dense HRR60 and `adequate` its verdict against the person's bar. The recap used the
 * nearest-reading hrr1, so on a ring-only set the screen and `set_hr_stats.rest_adequate` could
 * disagree; now a set the series cannot see shows no mark in either. `hrr1Best` (the session
 * summary's best HRR) follows, because `summariseWorkoutHr` takes the max of these `hrr1`s (#2601).
 */
export function withHrr60Recovery<T extends { setEndMs?: number | null; loggedAt: Date | null; hrr1: number | null; adequate: boolean | null }>(
  stats: readonly T[], readings: readonly SourcedReading[], barBpm: number,
): T[] {
  return stats.map(st => {
    const hrr1 = deriveHrr60(readings, st.setEndMs ?? st.loggedAt?.getTime() ?? null)?.bpm ?? null
    return { ...st, hrr1, adequate: restAdequateFromHrr60(hrr1, barBpm) }
  })
}
