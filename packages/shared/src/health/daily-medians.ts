// Quality-gated daily median — the correctness core of Oura's `daily_medians_1_1_0`. Our nightly
// HRV is currently a plain MEAN of every in-window RMSSD sample (adapter.ts ~:3848), which is both
// outlier-sensitive and un-gated. Oura instead takes a MEDIAN over samples that survive
// exclusion masks (active periods, sleep windows, low accuracy). This module is the pure gating +
// median; the rollup builds the exclusion windows from the MET/sleep signals and calls it.
//
// Accuracy gate caveat: Oura excludes hrv_accuracy < 20, but our BLE 0x5d decode carries no
// accuracy field, so the rollup substitutes a coverage proxy (band/beat-count checks) — see the
// recovery sub-plan. This core handles the MET/sleep exclusion + median, which are fully sourced.

export interface TimedSample {
  /** Timestamp in ring deciseconds (or any consistent unit shared with the windows). */
  ds: number
  value: number
}

export interface ExclusionWindow {
  startDs: number
  endDs: number
}

/** numpy-style median: average of the two middle values for an even count. Empty → null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const inAnyWindow = (ds: number, windows: ExclusionWindow[]): boolean =>
  windows.some(w => ds >= w.startDs && ds <= w.endDs)

/**
 * Median of the samples whose timestamp falls in NONE of the exclusion windows. Returns null when
 * no sample survives (mirrors the model's "no good-quality measurements" condition — we return
 * null, never throw). This replaces the naive mean for nightly HRV / resting-HR aggregation.
 */
export function medianGated(samples: TimedSample[], exclude: ExclusionWindow[] = []): number | null {
  const kept: number[] = []
  for (const s of samples) {
    if (!Number.isFinite(s.value)) continue
    if (exclude.length && inAnyWindow(s.ds, exclude)) continue
    kept.push(s.value)
  }
  return median(kept)
}

/** Oura's MET activity threshold for `daily_medians` — samples within `forwardSpanDs` after any
 *  MET reading above this are excluded (active-period removal). Inline literal in the model source
 *  (not a vendored JSON attribute); the same 1.8 appears as `ring_met_limit` in stress_daytime_sensing. */
export const MET_ACTIVE_THRESHOLD = 1.8

/**
 * Build active-period exclusion windows from a MET stream: for every MET sample above
 * `threshold`, exclude `[t, t + forwardSpanDs]`. `forwardSpanDs` is in the same unit as the sample
 * `ds` (e.g. 600 = 60 s in ring deciseconds).
 */
export function metActiveWindows(
  met: TimedSample[],
  forwardSpanDs: number,
  threshold = MET_ACTIVE_THRESHOLD,
): ExclusionWindow[] {
  const windows: ExclusionWindow[] = []
  for (const m of met) {
    if (m.value > threshold) windows.push({ startDs: m.ds, endDs: m.ds + forwardSpanDs })
  }
  return windows
}
