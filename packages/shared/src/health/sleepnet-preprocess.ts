/**
 * SleepNet (moonstone) preprocessor — TypeScript port of the Oura on-device preprocessing that
 * turns raw ring samples into the model's `highRes (115200,3)` / `lowRes (1800,1)` input tensors.
 *
 * Ported byte-faithfully from the vendored TorchScript source
 * (the vendor's `sleepnet` model source (private archive) + `training/Transforms.py`)
 * and validated bit-close against a golden `sample` captured from the original `.pt`
 * (`lib/health/__tests__/sleepnet-preprocess.test.ts`). Do NOT "improve" the math — every step is
 * pinned to the model that consumes it.
 *
 * Pipeline: reference-time + relative-seconds → gap-aware interpolation onto the bedtime grid →
 * per-column normalize (clip + zscore_hr/zscore/minmax, nan-aware) → fillna(0) → center crop/pad.
 *
 * Channels (from the model's constants `attributes`):
 *   highRes = [ibi (zscore_hr, clip[300,1875]), amplitude (zscore, clip[0,5000]), spo2 (minmax[90,100])]
 *   lowRes  = [motion (minmax[0,10])]   (temp is decoded but dropped for moonstone)
 */

const HIGH_RES_FS = 2.1333333333333333 // 64 samples / 30 s
const HIGH_RES_STEP_S = 1 / HIGH_RES_FS // 0.46875
const LOW_RES_STEP_S = 30
const EXPECTED_SIGNAL_LEN = 115200
const EXPECTED_EVENT_LEN = 1800
const EPOCH_LEN = 32
const HIGH_RES_CH = 3

export interface SleepNetRawNight {
  bedtimeStartMs: number
  bedtimeEndMs: number
  ibi: { tsMs: number[]; ibiMs: number[]; amplitude: number[]; valid: number[] }
  motion: { tsMs: number[]; value: number[] }
  spo2: { tsMs: number[]; value: number[] }
}

export interface SleepNetInput {
  highRes: Float32Array // 115200 * 3, C-order (t*3 + c): [ibi, amplitude, spo2]
  lowRes: Float32Array // 1800: motion
  /** epoch index (into the 1800-epoch output) where the real bedtime window begins (rest is zero-pad) */
  realEpochStart: number
  /** number of real (non-padding) epochs = the bedtime window length in 30-s epochs */
  realEpochCount: number
}

const NaNv = Number.NaN

/** torch.arange(start, stop, step) — half-open, matches the preprocessor's grid construction. */
function arange(start: number, stop: number, step: number): Float64Array {
  const n = Math.max(0, Math.ceil((stop - start) / step))
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = start + i * step
  return a
}

/**
 * Port of `interpolate_with_gaps`: linear-interpolate `dataV` (timestamped `dataT`, ascending)
 * onto `desired`. NaN for out-of-bounds and for any query inside a source gap > `thrGap` seconds.
 * Rows where the value is NaN are dropped first.
 */
function interpolateWithGaps(
  desired: Float64Array,
  dataT: Float64Array,
  dataV: Float64Array,
  thrGap: number,
): Float64Array {
  // drop NaN rows (any of ts/value NaN)
  const xs: number[] = []
  const vs: number[] = []
  for (let i = 0; i < dataT.length; i++) {
    if (!Number.isNaN(dataT[i]) && !Number.isNaN(dataV[i])) {
      xs.push(dataT[i])
      vs.push(dataV[i])
    }
  }
  const out = new Float64Array(desired.length)
  if (xs.length === 0) {
    out.fill(NaNv)
    return out
  }
  const nLast = xs.length - 1
  for (let i = 0; i < desired.length; i++) {
    const d = desired[i]
    // searchsorted(xs, d, right=True) - 1
    const low = upperBound(xs, d) - 1
    const high = Math.min(low + 1, nLast)
    const outbounds = low < 0 || low >= xs.length
    if (outbounds) {
      out[i] = NaNv
      continue
    }
    if (high === low) {
      // clamped at right edge (d >= last timestamp): torch fraction = (d-x)/(x-x) = 0/0 or n/0,
      // and torch.lerp(v, v, NaN/Inf) -> NaN. So every query at/after the last sample is NaN.
      out[i] = NaNv
      continue
    }
    const frac = (d - xs[low]) / (xs[high] - xs[low])
    out[i] = vs[low] + frac * (vs[high] - vs[low])
  }
  // gap masking: diff_sec = diff(xs, prepend 0); where diff > thrGap, NaN the (start, stop) span
  let prev = 0
  for (let k = 0; k < xs.length; k++) {
    const diffSec = xs[k] - prev
    if (diffSec > thrGap) {
      const start = xs[k] - diffSec
      const stop = xs[k]
      for (let i = 0; i < desired.length; i++) {
        if (desired[i] > start && desired[i] < stop) out[i] = NaNv
      }
    }
    prev = xs[k]
  }
  return out
}

/** searchsorted right: first index where xs[idx] > d (xs ascending). */
function upperBound(xs: number[], d: number): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= d) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** nan-aware standard scale: (x - nanmean) / sqrt(nanmean((x-mean)^2)). In place. */
function standardScaleInPlace(a: Float64Array) {
  let sum = 0
  let cnt = 0
  for (let i = 0; i < a.length; i++)
    if (!Number.isNaN(a[i])) {
      sum += a[i]
      cnt++
    }
  if (cnt === 0) return
  const mean = sum / cnt
  let sq = 0
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i])) sq += (a[i] - mean) ** 2
  const std = Math.sqrt(sq / cnt)
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mean) / std
}

function clipInPlace(a: Float64Array, lo: number, hi: number) {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isNaN(a[i])) a[i] = a[i] < lo ? lo : a[i] > hi ? hi : a[i]
  }
}

function minmaxInPlace(a: Float64Array, lo: number, hi: number) {
  const span = hi - lo
  for (let i = 0; i < a.length; i++) a[i] = ((a[i] - lo) / span) * 2 - 1
}

/** center crop/pad a 1-D channel array to targetLen with `value`; matches crop_or_pad_tensor. */
function cropPad(a: Float64Array, padLeft: number, padRight: number, value: number): Float64Array {
  const target = a.length + padLeft + padRight
  const out = new Float64Array(target)
  out.fill(value)
  // negative pad => crop from that side
  const srcStart = padLeft < 0 ? -padLeft : 0
  const dstStart = padLeft > 0 ? padLeft : 0
  const copyLen = Math.min(a.length - srcStart, target - dstStart)
  for (let i = 0; i < copyLen; i++) out[dstStart + i] = a[srcStart + i]
  return out
}

/**
 * `fill_motion_series_with_zeros`: snap motion timestamps to the 30-s grid, fill each grid slot
 * with the nearest sample within 15 s (else 0). Returns { t, v } on the new grid.
 */
function fillMotionWithZeros(ts: number[], v: number[]): { t: number[]; v: number[] } {
  const n = ts.length
  if (n === 0) return { t: [], v: [] }
  // mode of (ts % 30) — the dominant phase offset
  const offsetCount = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const r = ((ts[i] % 30) + 30) % 30
    offsetCount.set(r, (offsetCount.get(r) ?? 0) + 1)
  }
  let modeOffset = 0
  let modeC = -1
  for (const [r, c] of offsetCount)
    if (c > modeC || (c === modeC && r < modeOffset)) {
      modeOffset = r
      modeC = c
    }
  const newTs = ts.map((t) => t - (((t % 30) + 30) % 30) + modeOffset)
  const start = newTs[0]
  let end = newTs[n - 1]
  if (end < ts[n - 1]) end += 30
  const grid: number[] = []
  for (let t = start; t < end + 1; t += 30) grid.push(t)
  const outV = new Array<number>(grid.length).fill(0)
  for (let i = 0; i < grid.length; i++) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let j = 0; j < n; j++) {
      const dist = Math.abs(grid[i] - ts[j])
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = j
      }
    }
    if (bestDist <= 15) outV[i] = v[bestIdx]
  }
  return { t: grid, v: outV }
}

/** pad the motion grid out to the full bedtime window with zeros (pad_zeros_to_bedtime). */
function padZerosToBedtime(t: number[], v: number[], bedStart: number, bedEnd: number): { t: number[]; v: number[] } {
  let outT = t.slice()
  let outV = v.slice()
  if (bedStart < outT[0]) {
    const left: number[] = []
    for (let x = bedStart; x < outT[0]; x += 30) left.push(x)
    outT = [...left, ...outT]
    outV = [...left.map(() => 0), ...outV]
  }
  const last = outT[outT.length - 1]
  if (bedEnd > last) {
    const right: number[] = []
    for (let x = last; x < bedEnd; x += 30) right.push(x + 30)
    outT = [...outT, ...right]
    outV = [...outV, ...right.map(() => 0)]
  }
  return { t: outT, v: outV }
}

/** Build the model input tensors from a raw night. Returns null if the night is unusable. */
export function preprocessSleepNet(night: SleepNetRawNight): SleepNetInput | null {
  try {
    const start = night.bedtimeStartMs
    const end = night.bedtimeEndMs
    // ref = floor(floor((start+end)/2)/60000)*60000
    const ref = Math.floor(Math.floor((start + end) / 2) / 60000) * 60000
    const toRel = (ms: number) => (ms - ref) / 1000
    const bedStart = toRel(start)
    const bedEnd = toRel(end)

    const highGrid = arange(bedStart, bedEnd - 1e-9, HIGH_RES_STEP_S)
    const lowGrid = arange(bedStart, bedEnd - 1e-9, LOW_RES_STEP_S)

    // ---- high_res: IBI + amplitude ----
    const ibiTs = night.ibi.tsMs.map(toRel)
    const ibiV = night.ibi.ibiMs.slice()
    const ampV = night.ibi.amplitude.slice()
    const valid = night.ibi.valid
    // cummax on timestamps (enforce monotonic)
    let cm = -Infinity
    for (let i = 0; i < ibiTs.length; i++) {
      cm = Math.max(cm, ibiTs[i])
      ibiTs[i] = cm
    }
    // keep = valid==1 & ibi<2000
    const kT: number[] = []
    const kIbi: number[] = []
    const kAmp: number[] = []
    for (let i = 0; i < ibiTs.length; i++) {
      if (valid[i] === 1 && ibiV[i] < 2000) {
        kT.push(ibiTs[i])
        kIbi.push(ibiV[i])
        kAmp.push(ampV[i] === 0 ? NaNv : ampV[i]) // amp==0 -> NaN
      }
    }
    const ibiInterp = interpolateWithGaps(highGrid, Float64Array.from(kT), Float64Array.from(kIbi), 5)
    const ampInterp = interpolateWithGaps(highGrid, Float64Array.from(kT), Float64Array.from(kAmp), 5)
    for (let i = 0; i < ibiInterp.length; i++) ibiInterp[i] = Math.round(ibiInterp[i]) // round ibi to 0 dp

    // ---- high_res: SpO2 ----
    const spTs = night.spo2.tsMs.map(toRel)
    const spInterp = interpolateWithGaps(highGrid, Float64Array.from(spTs), Float64Array.from(night.spo2.value), 5)
    for (let i = 0; i < spInterp.length; i++) spInterp[i] = round3(spInterp[i])

    // ---- low_res: motion (input_indexed_on="end" -> shift ts by -30) ----
    const mTs = night.motion.tsMs.map((t) => toRel(t) - 30)
    const filled = fillMotionWithZeros(mTs, night.motion.value)
    const padded = padZerosToBedtime(filled.t, filled.v, bedStart, bedEnd)
    const motionInterp = interpolateWithGaps(lowGrid, Float64Array.from(padded.t), Float64Array.from(padded.v), 60)
    for (let i = 0; i < motionInterp.length; i++) motionInterp[i] = round3(motionInterp[i])

    // ---- Normalize (clip + method) ----
    clipInPlace(ibiInterp, 300, 1875)
    const hr = new Float64Array(ibiInterp.length)
    for (let i = 0; i < hr.length; i++) hr[i] = 60000 / ibiInterp[i]
    standardScaleInPlace(hr) // zscore_hr
    clipInPlace(ampInterp, 0, 5000)
    standardScaleInPlace(ampInterp) // zscore
    minmaxInPlace(spInterp, 90, 100) // spo2 (no clip)
    minmaxInPlace(motionInterp, 0, 10) // motion (no clip)

    // ---- Fillna(0) ----
    const nz = (a: Float64Array) => {
      for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i])) a[i] = 0
    }
    nz(hr)
    nz(ampInterp)
    nz(spInterp)
    nz(motionInterp)

    // ---- CropPad to fixed length ----
    const signalLen = highGrid.length
    const eventLen = lowGrid.length
    const isSignalOdd = signalLen % 2 !== 0 ? 1 : 0
    const isEventOdd = eventLen % 2 !== 0 ? 1 : 0
    const padSig = EXPECTED_SIGNAL_LEN - signalLen
    const sigPadLeft = Math.floor(padSig / 2) + isSignalOdd + EPOCH_LEN * isEventOdd
    const sigPadRight = Math.floor(padSig / 2) - EPOCH_LEN * isEventOdd
    const padEv = EXPECTED_EVENT_LEN - eventLen
    const evPadLeft = isEventOdd + Math.floor(padEv / 2)
    const evPadRight = Math.floor(padEv / 2)

    const hrP = cropPad(hr, sigPadLeft, sigPadRight, 0)
    const ampP = cropPad(ampInterp, sigPadLeft, sigPadRight, 0)
    const spP = cropPad(spInterp, sigPadLeft, sigPadRight, 0)
    const moP = cropPad(motionInterp, evPadLeft, evPadRight, 0)

    // interleave high_res into C-order [t*3 + c]
    const highRes = new Float32Array(EXPECTED_SIGNAL_LEN * HIGH_RES_CH)
    for (let t = 0; t < EXPECTED_SIGNAL_LEN; t++) {
      highRes[t * 3] = hrP[t]
      highRes[t * 3 + 1] = ampP[t]
      highRes[t * 3 + 2] = spP[t]
    }
    const lowRes = Float32Array.from(moP)
    return { highRes, lowRes, realEpochStart: evPadLeft, realEpochCount: eventLen }
  } catch (err) {
    console.warn('[sleepnet-preprocess] failed:', err)
    return null
  }
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}
