// Per-5-minute median-HR + HRV-quality series from raw per-beat IBI.
//
// Ported from the preserved Oura source
// the vendor's `sleepstaging_2_6_0` model source (private archive)
// (`FeatureExtractor_IBIRawToLowLevel.forward`). The cumulative-stress model
// (`lib/oura-models/cumulative-stress.ts`) consumes two of that extractor's per-window
// outputs — `hrv_medianHR_5min` (line ~241 `medianHR = median(60000/ibi)`) and
// `hrv_quality_5min` (line ~83 `quality = valid/total × 100`) — and reduces each to its
// `nanmean` (`normaliseHrvMedianHR5min`, `medianHrvQuality5min`). Because only the mean over
// windows is consumed, we produce non-overlapping 5-minute buckets rather than the source's
// 30-second-hop sliding windows: the mean of per-window medians is equivalent in expectation
// and far simpler. See the module comment in cumulative-stress-assembly.ts for the wiring.
//
// The two frequency-domain features in the source (HF/LF/breathing) are NOT consumed by
// cumulative-stress, so the custom `oura_biquad_cascade`/`oura_find_peaks` ops are deliberately
// not ported — only `filter_ibi` (3-tap validity erosion) and the two simple window statistics.

/** A decoded green_ibi_quality (tag 0x80) event: the event's wall-clock start and its per-beat
 *  interbeat intervals (ms) + per-beat 2-bit quality code (q === 1 is a good beat). */
export interface Ibi5MinEvent {
  startMs: number
  ibiMs: number[]
  quality: number[]
}

const WINDOW_MS = 5 * 60 * 1000
const MIN_VALID_BEATS = 20 // source `enough_ibis_5min = size(ibi_5min) >= 20`
const IBI_MIN_MS = 300
const IBI_MAX_MS = 2000

interface Beat {
  t: number // reconstructed wall-clock ms (event start + intra-event cumulative IBI)
  ibi: number
  valid: boolean
}

/** torch.quantile(0.5): the true median with linear interpolation (average of the two middle
 *  values on even n). Matches the source's `q_hr = torch.quantile(hr, [...0.5...])`. */
function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const pos = 0.5 * (s.length - 1)
  const lo = Math.floor(pos)
  const frac = pos - lo
  return lo + 1 >= s.length ? s[s.length - 1] : s[lo] + frac * (s[lo + 1] - s[lo])
}

/** `filter_ibi`: a beat survives only if it and both neighbours are valid (a 3-tap all-valid
 *  erosion, `torch.all(unfold(valid, 3), 1)`), with replicate padding at the two edges. */
function erodeValidity(valid: boolean[]): boolean[] {
  const n = valid.length
  if (n === 0) return []
  if (n < 3) return valid.map(() => valid.every(Boolean))
  const core: boolean[] = [] // length n-2: core[j] = valid[j] && valid[j+1] && valid[j+2]
  for (let j = 0; j <= n - 3; j++) core.push(valid[j] && valid[j + 1] && valid[j + 2])
  // pad [1,1] replicate: final[0]=core[0], final[1..n-2]=core[0..n-3], final[n-1]=core[n-3]
  const out = new Array<boolean>(n)
  out[0] = core[0]
  for (let k = 1; k <= n - 2; k++) out[k] = core[k - 1]
  out[n - 1] = core[n - 3]
  return out
}

/**
 * Build the latest-night per-5-min `hrvMedianHR5min` (bpm) and `hrvQuality5min` (0–100) series
 * from the night's decoded green_ibi_quality events. Returns one element per qualifying 5-min
 * bucket (≥ 20 surviving beats). Empty arrays when there is no usable IBI — the caller feeds
 * those straight to the model, which yields NaN intermediates (the cold-start / no-signal path).
 */
export function computeHrv5MinSeries(events: Ibi5MinEvent[]): {
  hrvMedianHR5min: number[]
  hrvQuality5min: number[]
} {
  const beats: Beat[] = []
  for (const ev of events) {
    let acc = 0
    const n = Math.min(ev.ibiMs.length, ev.quality.length)
    for (let k = 0; k < n; k++) {
      const ibi = ev.ibiMs[k]
      acc += ibi
      beats.push({
        t: ev.startMs + acc,
        ibi,
        valid: ev.quality[k] === 1 && ibi >= IBI_MIN_MS && ibi <= IBI_MAX_MS,
      })
    }
  }
  if (beats.length === 0) return { hrvMedianHR5min: [], hrvQuality5min: [] }
  beats.sort((a, b) => a.t - b.t)

  const eroded = erodeValidity(beats.map((b) => b.valid))
  for (let i = 0; i < beats.length; i++) beats[i].valid = eroded[i]

  // Tumbling 5-min buckets anchored at the first beat. A >5s inter-beat gap simply falls between
  // buckets — no beat is placed in a window it did not occur in, matching the source's gap cap.
  const t0 = beats[0].t
  const buckets = new Map<number, Beat[]>()
  for (const b of beats) {
    const idx = Math.floor((b.t - t0) / WINDOW_MS)
    const arr = buckets.get(idx)
    if (arr) arr.push(b)
    else buckets.set(idx, [b])
  }

  const hrvMedianHR5min: number[] = []
  const hrvQuality5min: number[] = []
  for (const idx of [...buckets.keys()].sort((a, b) => a - b)) {
    const win = buckets.get(idx)!
    const total = win.length
    const validBeats = win.filter((b) => b.valid)
    if (validBeats.length < MIN_VALID_BEATS) continue
    // quality = surviving / total (source `valid/with_nans × 100`). A >5s inter-event gap places
    // its beats in a later bucket via each event's own startMs anchor, so no window straddles it.
    hrvQuality5min.push((validBeats.length / total) * 100)
    hrvMedianHR5min.push(median(validBeats.map((b) => 60000 / b.ibi)))
  }
  return { hrvMedianHR5min, hrvQuality5min }
}
