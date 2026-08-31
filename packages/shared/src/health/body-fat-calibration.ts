import { isPlausibleBodyFatPct } from './body-composition'
import { daysBetweenDateStrs } from '../date-utils'

/**
 * One (DEXA, scale) observation. The scale date is carried separately from the scan date because
 * the two need not coincide — see `pairScansWithReadings` — and a pairing you cannot inspect is a
 * pairing nobody can check.
 */
export interface CalibrationPair {
  /** The DEXA's `scanned_on`. */
  scannedOn: string
  /** The `body_metrics.date` actually paired with it. */
  scaleDate: string
  /** The DEXA's `pct_fat` — the reference. */
  referencePct: number
  /** `body_metrics.body_fat_pct` on `scaleDate` — what the instrument said. */
  measuredPct: number
}

/**
 * A correction belonging to ONE instrument. `source` is the `source_map->>'body_fat_pct'` value the
 * pairs were drawn from; a reading from any other source is left alone, because a different scale is
 * a different bias and applying this one to it would be worse than applying none.
 */
export interface BodyFatCalibration {
  source: string
  /** Mean of `referencePct − measuredPct` over the pairs. Positive = the instrument under-reads. */
  offsetPct: number
  /** Never empty — a calibration with no pairs is `null`, never a zero offset. */
  pairs: CalibrationPair[]
}

export interface CorrectedBodyFat {
  /** What to use. Equals `rawPct` when nothing applied. */
  pct: number
  /** Always the stored reading, so a caller can show both without a second lookup. */
  rawPct: number
  /**
   * Whether a calibration was applied. **Not derivable from `pct !== rawPct`** — an offset can
   * legitimately round to zero, and "corrected by 0.0" and "not corrected" are different claims.
   */
  corrected: boolean
}

/**
 * The instrument the calibration is for by default — the value `source_map->>'body_fat_pct'` carries
 * for a Renpho reading over BLE, and the only body-fat source with any pairs. Spelled here rather
 * than imported from `lib/data/health-source.ts` because that module ranks sources for the write
 * merge, which is a different question: this is *which instrument was calibrated*, and a source can
 * be highly ranked and uncalibrated (a manual entry) or low ranked and calibrated.
 */
export const DEFAULT_CALIBRATED_SOURCE = 'scale_ble'

/** The most days apart a scan and a reading may be and still count as one observation. */
export const PAIR_WINDOW_DAYS = 3

const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * Derive the correction for one instrument from its pairs.
 *
 * **Offset, not ratio — and with one pair that is a choice about the future, not about the fit.**
 * At n = 1 the two forms agree exactly on the observed point and diverge everywhere else: a ratio
 * asserts the bias scales with the reading (at 5 % it would imply a gap of 0.6 points), an offset
 * asserts only the gap that was measured. One pair supports neither, so prefer the one that makes no
 * claim about readings never observed. Revisit at n ≥ 2, when the pairs can actually distinguish them.
 */
export function deriveBodyFatCalibration(
  pairs: readonly CalibrationPair[],
  source: string,
): BodyFatCalibration | null {
  const usable = pairs.filter(p =>
    Number.isFinite(p.referencePct) && Number.isFinite(p.measuredPct) &&
    p.referencePct > 0 && p.measuredPct > 0)
  if (usable.length === 0) return null
  const offsetPct = usable.reduce((sum, p) => sum + (p.referencePct - p.measuredPct), 0) / usable.length
  if (!Number.isFinite(offsetPct)) return null
  return { source, offsetPct: round1(offsetPct), pairs: [...usable] }
}

/**
 * Apply a calibration to one stored reading.
 *
 * Returns the reading untouched when there is no calibration, when the reading came from a different
 * instrument, or when correcting it would push the value outside `PLAUSIBLE_BODY_FAT_PCT` — a
 * calibration that produces an implausible number is a broken calibration, not a licence to store an
 * implausible one. A `null` source never matches: an unknown instrument is not this one.
 */
export function correctBodyFatPct(
  rawPct: number | null | undefined,
  source: string | null | undefined,
  calibration: BodyFatCalibration | null | undefined,
): CorrectedBodyFat | null {
  if (rawPct == null || !Number.isFinite(rawPct)) return null
  const raw = rawPct
  if (calibration == null || source == null || source !== calibration.source) {
    return { pct: raw, rawPct: raw, corrected: false }
  }
  const next = round1(raw + calibration.offsetPct)
  if (!isPlausibleBodyFatPct(next)) return { pct: raw, rawPct: raw, corrected: false }
  return { pct: next, rawPct: raw, corrected: true }
}

/** A stored DEXA row, reduced to the two columns the calibration needs. */
export interface DexaObservation {
  scannedOn: string
  pctFat: number
}

/** A stored `body_metrics` row, likewise. `source` is `source_map->>'body_fat_pct'` — **null for
 *  every row written before provenance was recorded**, and null never matches an instrument. */
export interface ScaleObservation {
  date: string
  bodyFatPct: number
  source: string | null
}

/**
 * Pair each scan with the nearest same-instrument reading within `PAIR_WINDOW_DAYS`.
 *
 * Same-day is the expected case — the owner was told to weigh in as close to the scan as practical,
 * because a pair's scale half cannot be reconstructed afterwards. The window exists so a missed
 * morning does not throw a scan away, not to reach for a reading a week out: BIA moves with
 * hydration, so a distant reading is a different measurement, not a late one.
 *
 * A scan and a reading each pair at most once. Ties on distance go to the earlier reading, so the
 * result does not depend on input order.
 */
export function pairScansWithReadings(
  scans: readonly DexaObservation[],
  readings: readonly ScaleObservation[],
  source: string,
): CalibrationPair[] {
  const candidates = readings
    .filter(r => r.source === source && Number.isFinite(r.bodyFatPct) && r.bodyFatPct > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const taken = new Set<string>()
  const pairs: CalibrationPair[] = []

  for (const scan of [...scans].sort((a, b) => (a.scannedOn < b.scannedOn ? -1 : 1))) {
    if (!Number.isFinite(scan.pctFat) || scan.pctFat <= 0) continue
    let best: ScaleObservation | null = null
    let bestDistance = Infinity
    for (const reading of candidates) {
      if (taken.has(reading.date)) continue
      const distance = Math.abs(daysBetweenDateStrs(scan.scannedOn, reading.date))
      if (distance > PAIR_WINDOW_DAYS) continue
      if (distance < bestDistance) {
        best = reading
        bestDistance = distance
      }
    }
    if (best == null) continue
    taken.add(best.date)
    pairs.push({
      scannedOn: scan.scannedOn,
      scaleDate: best.date,
      referencePct: scan.pctFat,
      measuredPct: best.bodyFatPct,
    })
  }
  return pairs
}
