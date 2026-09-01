/**
 * Which body-fat number a SCREEN shows (LA-45).
 *
 * `/api/body-metadata` and `/api/day-log` carry three fields per reading: `bodyFat` (the raw stored
 * value), `bodyFatCorrected` (the DEXA-corrected one) and `bodyFatIsCorrected`. Screens display the
 * corrected value; the raw one exists so the log sheet can seed from it.
 *
 * **`bodyFat` must stay the value the log sheet seeds from and POSTs back.** `openLog` writes at
 * source `manual`, which outranks `scale_ble` — so a corrected value round-tripped through the edit
 * sheet would overwrite the measurement permanently and collapse the next calibration toward zero.
 * Seed from `bodyFat`, display `displayBodyFat`. Getting it backwards is silent and unrecoverable.
 *
 * This is a display rule, not the correction itself — `correctBodyFatPct`
 * (`@trainingai/shared/health/body-fat-calibration`) is the one place that computes a corrected
 * value, and it has already run server-side by the time a row reaches here.
 */

/** The three fields every corrected-capable payload row carries. Both are optional: a client that
 *  builds a row literal for its own optimistic paint after a log has no calibration to apply, and
 *  absent is the truthful value there rather than a fabricated one. */
export interface BodyFatReading {
  bodyFat: number | null
  bodyFatCorrected?: number | null
  bodyFatIsCorrected?: boolean
}

/** What to render. Falls back to the raw reading when the payload predates the correction or the
 *  row was built client-side — never a fabricated correction. */
export function displayBodyFat(r: BodyFatReading | null | undefined): number | null {
  if (!r) return null
  return r.bodyFatCorrected ?? r.bodyFat
}

/**
 * Whether a calibration was actually applied to this reading.
 *
 * **Never infer this from `bodyFatCorrected !== bodyFat`.** An offset can round to zero, and
 * "corrected by 0.0" and "not corrected" are different claims — which matters because two thirds of
 * the owner's history is on instruments the calibration does not cover, so a trend spanning the
 * changeover contains both kinds and needs to say where the calibrated span begins rather than draw
 * an unexplained step.
 */
export function isCorrectedReading(r: BodyFatReading | null | undefined): boolean {
  return r?.bodyFatIsCorrected === true
}

/** How many of a window's readings carry a correction, and how many carry a body fat at all. The
 *  two numbers together are what lets a chart say "the last 4 of 7" rather than imply all or none. */
export function correctedSpan(rows: readonly BodyFatReading[]): { corrected: number; total: number } {
  let corrected = 0
  let total = 0
  for (const r of rows) {
    if (r.bodyFat == null && r.bodyFatCorrected == null) continue
    total++
    if (isCorrectedReading(r)) corrected++
  }
  return { corrected, total }
}

/**
 * The once-per-response calibration `/api/body-metadata` carries alongside the rows.
 *
 * Declared here rather than imported from the route: the route is Lane A's and this is a display
 * concern, and every other client-side reader of that payload already declares the slice it uses
 * (`details-content.tsx`, `goals-section.tsx`). The fields are the three the route returns.
 */
export interface BodyFatCalibrationMeta {
  /** Mean (DEXA − scale) over the pairs. Positive = the scale under-reads. */
  offsetPct: number
  /** How many (scan, reading) pairs it was derived from. **One is not a calibration yet** — at a
   *  single pair an offset and a ratio are the same number, so a UI must not present it as settled. */
  pairCount: number
  /** The instrument it belongs to (`source_map->>'body_fat_pct'`). A reading from any other source
   *  is left alone, because a different scale is a different bias. */
  source: string
}
