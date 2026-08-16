// Nightly skin temperature + deviation. Ported faithfully from open_oura's
// `nightly_temperature_calculate @ 0x203520`
// (`crates/oura-analysis/src/ported/temperature.rs`, pinned 2026-07-11): a 7-sample
// sliding median, then 30-sample windows; each window contributes its max when its
// range < 2.50 degC, and the nightly value is the minimum of those window maxima
// (needs >= 4 valid windows). Units: ring temperature is centi-degC (value/100 = degC),
// matching decodeTemperatures' `temps_c` output scaled back up by *100.
//
// We "store temps but compute nothing" was the standing gap this closes (per the
// oura-native-ble skill) — feeds both the Readiness Temperature contributor and
// oura_daily_summary.temp_dev via lib/health/personal-baseline.ts's asymmetric EMA.

const WINDOW = 30 // samples
const RANGE_THRESHOLD = 250 // 2.50 degC in centi-degC
const MIN_WINDOWS = 4

function median7(buf: number[]): number {
  return [...buf].sort((a, b) => a - b)[3]
}

/**
 * Nightly temperature (centi-degC) from per-sample skin temps (centi-degC; 0 = invalid).
 * `null` if fewer than 4 valid 30-sample windows passed the range gate.
 */
export function nightlyTemperatureCentiC(samples: number[]): number | null {
  const ring = new Array(7).fill(0)
  let idx = 0
  let winMin = Infinity
  let winMax = 0
  const maxima: number[] = []

  for (let i = 0; i < samples.length; i++) {
    ring[idx] = samples[i]
    idx = idx === 6 ? 0 : idx + 1
    const m = median7(ring)
    if (m !== 0) {
      winMin = Math.min(winMin, m)
      winMax = Math.max(winMax, m)
    }
    if ((i + 1) % WINDOW === 0) {
      if (winMax >= winMin && winMax !== 0 && winMax - winMin < RANGE_THRESHOLD) {
        maxima.push(winMax)
      }
      winMin = Infinity
      winMax = 0
    }
  }

  if (maxima.length < MIN_WINDOWS) return null
  return Math.min(...maxima)
}

/** Temperature deviation (centi-degC) = nightly temperature - personal baseline mean. */
export function temperatureDeviationCentiC(nightlyCenti: number, baselineMeanCenti: number): number {
  return nightlyCenti - baselineMeanCenti
}

/** One decoded temperature frame: several probes read at the same instant. */
export type TemperatureFrame = { ds: number; tempsC: number[] }

/**
 * Collapse each frame's simultaneous probes to a single sample, ordered in time.
 *
 * `nightlyTemperatureCentiC` above is a temporal pipeline — median-7, then 30-sample
 * windows, then min-of-window-maxima — so it assumes one chronologically ordered
 * series. A frame's `temps_c` array is NOT that: its values are probes read at the
 * same instant, all carrying the frame's single `ds`. Flattening them (what the
 * rollup did) inflated 631 real frames into 2,398 "samples" sharing 631 timestamps
 * and fed positional structure to an algorithm reading it as elapsed time.
 *
 * Median rather than max/mean: it is the collapse that resists one bad probe without
 * pulling the value toward a cold outlier. Even-length frames average the two middles,
 * which can land on a half-centi — rounded, since the pipeline is integer centi-degC.
 */
export function temperatureFrameSeries(frames: TemperatureFrame[]): { ds: number; centi: number }[] {
  const out: { ds: number; centi: number }[] = []
  for (const f of frames) {
    const centi = f.tempsC.map(c => Math.round(c * 100)).sort((a, b) => a - b)
    if (centi.length === 0) continue
    const mid = centi.length >> 1
    out.push({
      ds: f.ds,
      centi: centi.length % 2 === 1 ? centi[mid] : Math.round((centi[mid - 1] + centi[mid]) / 2),
    })
  }
  return out.sort((a, b) => a.ds - b.ds)
}
