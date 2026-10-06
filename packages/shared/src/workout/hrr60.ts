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

/**
 * HRR60 for a set ending at `setEndMs`, or null when the series is not dense enough to measure it.
 * Pure and total: unsorted input, non-finite values and an empty series all give null, never a throw.
 */
export function deriveHrr60(readings: readonly SourcedReading[], setEndMs: number | null): Hrr60 | null {
  if (setEndMs == null || !Number.isFinite(setEndMs)) return null
  const lo = setEndMs - HRR60_ANCHOR_TOL_MS
  const hi = setEndMs + HRR60_OFFSET_MS + HRR60_ANCHOR_TOL_MS
  const window = readings
    .filter(r => {
      const t = r.timestamp?.getTime?.()
      return t != null && Number.isFinite(t) && t >= lo && t <= hi && Number.isFinite(r.bpm)
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  if (window.length < 2) return null

  const atEnd = nearestWithin(window, setEndMs, HRR60_ANCHOR_TOL_MS)
  const at60 = nearestWithin(window, setEndMs + HRR60_OFFSET_MS, HRR60_ANCHOR_TOL_MS)
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

/**
 * The persisted rest verdict from a measured HRR60: today's 15 bpm bar, null when there is no
 * measurement. A set with no HRR60 is "not measured", never a cross. The personal bar (#2299 step 2)
 * replaces the constant here, in one place.
 */
export function restAdequateFromHrr60(hrr60Bpm: number | null): boolean | null {
  return hrr60Bpm == null ? null : hrr60Bpm >= ADEQUATE_HRR1_BPM
}
