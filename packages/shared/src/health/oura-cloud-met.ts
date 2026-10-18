/**
 * #2985 (#2981): Oura's MET series as a 1-minute grid, for rung 1 of `MET/min` (`met-input.ts`)
 * next to the ring's own grid, and for walk detection.
 *
 * The series is `daily_activity.met` as the connector stored it (`oura_cloud_daily.met`), taken as
 * Oura calculated it (owner, 2026-10-18, #2860). Each item covers `interval` seconds from the
 * series' `timestamp`, and a minute takes the overlap-weighted mean of the items covering it: a
 * 60-second series maps one to one, a coarser one gives each minute the value Oura reported for the
 * span holding it, a finer one is averaged. A null item and a minute nothing covers stay null.
 *
 * **Wear gate.** `class_5_min` is that document's 5-minute activity class from the same start, and
 * `0` is non-wear. Oura's MET for a non-wear slot is dropped, so a ring on the charger is missing
 * for the cascade, never rest.
 *
 * Oura's activity day starts at 4 a.m. local, so a local-midnight window needs the day before it
 * as well: every item is placed by its own instant, never by the row's date.
 */

const MINUTE_MS = 60_000
const CLASS_SLOT_MS = 5 * MINUTE_MS
const NON_WEAR = '0'

/** One `oura_cloud_daily` row's activity fields. */
export interface OuraActivitySeriesDay {
  met: { interval: number; items: readonly (number | null)[]; timestamp: string } | null
  class5Min: string | null
}

/** `[fromMs, toMs)` as a grid starting at `fromMs`'s minute; `metsPerMinute[i]` is minute `i`. */
export function ouraCloudMetGrid(
  days: readonly OuraActivitySeriesDay[], fromMs: number, toMs: number,
): { startTimestampMs: number; metsPerMinute: (number | null)[] } {
  const start = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS
  const n = Math.max(0, Math.ceil((toMs - start) / MINUTE_MS))
  const sum = new Array<number>(n).fill(0)
  const weight = new Array<number>(n).fill(0)
  const nonWear = new Array<boolean>(n).fill(false)

  // Every minute `[a, b)` overlaps, with the overlap in ms.
  const eachMinute = (a: number, b: number, fn: (i: number, overlap: number) => void) => {
    const first = Math.max(0, Math.floor((a - start) / MINUTE_MS))
    const last = Math.min(n - 1, Math.ceil((b - start) / MINUTE_MS) - 1)
    for (let i = first; i <= last; i++) {
      const m = start + i * MINUTE_MS
      const overlap = Math.min(b, m + MINUTE_MS) - Math.max(a, m)
      if (overlap > 0) fn(i, overlap)
    }
  }

  for (const day of days) {
    const met = day.met
    if (!met) continue
    const t0 = Date.parse(met.timestamp)
    const step = met.interval * 1000
    if (!Number.isFinite(t0) || !(step > 0)) continue
    met.items.forEach((v, k) => {
      if (v == null || !Number.isFinite(v)) return
      const a = t0 + k * step
      eachMinute(a, a + step, (i, overlap) => { sum[i] += v * overlap; weight[i] += overlap })
    })
    // The class string starts where the MET series does: both come from one document's `timestamp`.
    const classes = day.class5Min ?? ''
    for (let j = 0; j < classes.length; j++) {
      if (classes[j] !== NON_WEAR) continue
      const a = t0 + j * CLASS_SLOT_MS
      eachMinute(a, a + CLASS_SLOT_MS, i => { nonWear[i] = true })
    }
  }

  return {
    startTimestampMs: start,
    metsPerMinute: sum.map((s, i) => (weight[i] > 0 && !nonWear[i] ? s / weight[i] : null)),
  }
}
