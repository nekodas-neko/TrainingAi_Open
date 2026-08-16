// Shared tachogram resampler — the "IBI → clean beat stream → even-grid resample" step used by
// both the breathing-rate estimator (respiratory band) and the LF/HF frequency-domain HRV term.
// One resampler, one place (extracted from breathing-rate.ts so the two never drift).
//
// The tachogram is the sequence of IBI values plotted against beat time; resampling it onto an even
// time grid (via linear interpolation) turns an irregularly-sampled series into one a plain FFT or a
// moving-average detrend can operate on. Beat-count / span *gates* are the caller's job (they differ:
// breathing needs ~40 beats, LF/HF needs a denser ~90) — this helper only does the geometry and
// returns null when it cannot build a grid at all.

const IBI_LO = 300 // ms — physiological beat band (~200 bpm max); drops decoder artifacts
const IBI_HI = 2000 // ms (~30 bpm min)

export interface Tachogram {
  /** Evenly-resampled tachogram (IBI value in ms per grid sample). */
  grid: number[]
  /** Grid sample spacing in ms (1000 / fs). */
  dtMs: number
  /** Number of clean beats the grid was built from. */
  beatCount: number
  /** Total span of the beat stream in ms. */
  spanMs: number
}

/**
 * Filter an ordered IBI sequence (ms) to the physiological band and resample the tachogram onto an
 * even grid at `fs` Hz via linear interpolation (piecewise-constant past the last beat). Returns null
 * when there are no clean beats or the span is degenerate. Pure and deterministic; never throws.
 */
export function resampleTachogram(ibiMs: number[], fs: number): Tachogram | null {
  const dtMs = 1000 / fs
  const clean = ibiMs.filter((v) => Number.isFinite(v) && v >= IBI_LO && v <= IBI_HI)
  if (clean.length === 0) return null

  // Beat times (ms) — cumulative sum of IBIs — paired with the IBI observed at that beat.
  const beatT: number[] = new Array(clean.length)
  let acc = 0
  for (let i = 0; i < clean.length; i++) { beatT[i] = acc; acc += clean[i] }
  const spanMs = acc
  if (spanMs <= 0) return null

  const nGrid = Math.floor(spanMs / dtMs) + 1
  const grid = new Array<number>(nGrid)
  let k = 0
  for (let g = 0; g < nGrid; g++) {
    const tg = g * dtMs
    while (k < clean.length - 1 && beatT[k + 1] <= tg) k++
    if (k >= clean.length - 1) { grid[g] = clean[clean.length - 1]; continue }
    const t0 = beatT[k], t1 = beatT[k + 1]
    const frac = t1 > t0 ? (tg - t0) / (t1 - t0) : 0
    grid[g] = clean[k] + (clean[k + 1] - clean[k]) * frac
  }

  return { grid, dtMs, beatCount: clean.length, spanMs }
}
