// astd_event_detection_0_1_0 — a faithful TypeScript port of the 0-parameter algorithmic
// TorchScript model (EventDetection). Given a day's Automatic Stress-Type Detection (ASTD) series
// — one dsa value per 15-minute bin, in [−1, 1], with millisecond timestamps — it detects
// sustained "stressed" (dsa ≤ −threshold) and "restored" (dsa ≥ threshold) events by sliding a
// fixed 4-bin window, then sorting + merging adjacent same-type windows. Returns per-type event
// counts and total minutes plus the raw event list (type / start / end / duration).
//
// Pinned to the captured .pt golden vector
// (lib/oura-models/onnx/__fixtures__/astd_event_detection_0_1_0.golden.json). The golden is the
// zero-events case (its 1 ms bin spacing makes every window shorter than min_window_delta), so the
// event-collection / sort / merge / duration path is additionally pinned against synthetic vectors
// captured from the same .pt (…__fixtures__/astd_event_detection_0_1_0.scenarios.json).
//
// Ported from the vendor's `astd_event_detection_0_1_0` model source (private archive). The Validator is a
// pragmatic gate: invalid input yields the empty/zero result (the model's raise path), never throws.
// Constants via getAstdConstants().
//
// Library port only — not wired into any surface or the stress rollup.

import { getAstdConstants } from './constants'

// Read on FIRST USE, memoised — not at module scope. `next build` imports every route to
// collect page data, so a module-scope read opened the constants file at build time, and the
// directory only exists at runtime now that the vendored copies are gone (Q-49 A4b). Each
// function below takes its own `const K = K_()` so the bodies read exactly as before.
let kCache: ReturnType<typeof getAstdConstants> | null = null
const K_ = (): ReturnType<typeof getAstdConstants> => (kCache ??= getAstdConstants())

export interface AstdEventDetectionInput {
  dsaValues: number[]       // [N] per-bin ASTD value in [−1, 1] (NaN = missing bin)
  dsaTimestampsMs: number[] // [N] bin start timestamps, strictly increasing
}

export interface AstdEventDetectionResult {
  nStressed: number
  nRestored: number
  totalStressedMin: number
  totalRestoredMin: number
  eventTypeIds: number[]   // −1 = stressed, +1 = restored
  eventStartMs: number[]
  eventEndMs: number[]
  durationsMin: number[]
}

const EMPTY_RESULT: AstdEventDetectionResult = {
  nStressed: 0,
  nRestored: 0,
  totalStressedMin: 0,
  totalRestoredMin: 0,
  eventTypeIds: [],
  eventStartMs: [],
  eventEndMs: [],
  durationsMin: [],
}

// Validator.validate → 0 when OK, non-zero error code otherwise (we gate on non-zero).
function validate(values: number[], timestamps: number[]): number {
  const K = K_()
  if (values.length < K.minNBins) return 1
  if (timestamps.length !== values.length) return 2
  if (timestamps.length > 1) {
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] - timestamps[i - 1] <= 0) return 3 // non-increasing timestamps
    }
  }
  const finite = values.filter((v) => !Number.isNaN(v))
  if (finite.some((v) => v < -1 || v > 1)) return 4
  return 0
}

interface Classified {
  isFinite: boolean[]
  isFullyStressed: boolean[]
  isBorderlineStressed: boolean[]
  isFullyRestored: boolean[]
  isBorderlineRestored: boolean[]
}

// Preprocessor.classify: threshold each bin into the four stress/restored categories.
function classify(values: number[]): Classified {
  const K = K_()
  const ext = K.extremeStressThreshold
  const rel = K.relaxedThreshold
  return {
    isFinite: values.map((v) => !Number.isNaN(v)),
    isFullyStressed: values.map((v) => v <= -ext),
    isBorderlineStressed: values.map((v) => v > -ext && v <= -rel),
    isFullyRestored: values.map((v) => v >= ext),
    isBorderlineRestored: values.map((v) => v >= rel && v < ext),
  }
}

const countTrue = (a: boolean[], lo: number, hi: number): number => {
  let c = 0
  for (let i = lo; i < hi; i++) if (a[i]) c += 1
  return c
}

// Processor._accept_window: does the fixed N-bin window qualify as an event of this rule/type?
function acceptWindow(
  n: number,
  rule: number,
  isFinite: boolean[],
  isFully: boolean[],
  isBorderline: boolean[],
  lo: number,
  hi: number,
): boolean {
  const K = K_()
  const nFinite = countTrue(isFinite, lo, hi)
  const nFully = countTrue(isFully, lo, hi)
  const nBorderline = countTrue(isBorderline, lo, hi)
  const nNan = n - nFinite
  const nOther = nFinite - nFully - nBorderline

  const borderlineOk =
    K.borderlineCountRule === 0 ? nFully >= K.borderlineMinFullyCount : nBorderline <= nFully

  if (rule === 0) return nNan === 0 && nOther === 0 && borderlineOk
  if (rule === 1) return nOther === 0 && nNan <= 1 && nFully > 0 && borderlineOk
  return false
}

interface Window {
  typeId: number
  startMs: number
  endMs: number
}

// Processor._collect_pass: slide a fixed N-bin window across the series, emit one window per
// accepted position (windows may overlap; they are sorted+merged later).
function collectPass(
  n: number,
  rule: number,
  typeId: number,
  timestamps: number[],
  isFinite: boolean[],
  isFully: boolean[],
  isBorderline: boolean[],
): Window[] {
  const K = K_()
  const out: Window[] = []
  const total = timestamps.length
  if (total < n) return out
  for (let start = 0; start <= total - n; start++) {
    const jLast = start + n - 1
    if (!isFinite[start]) continue
    if (!isFinite[jLast]) continue
    const firstTs = timestamps[start]
    const lastTs = timestamps[jLast]
    const coveredMs = lastTs - firstTs + K.binWidthMs
    if (coveredMs < K.minWindowDeltaMs) continue
    if (coveredMs > K.maxWindowDeltaMs) continue
    if (!acceptWindow(n, rule, isFinite, isFully, isBorderline, start, jLast + 1)) continue
    out.push({ typeId, startMs: firstTs, endMs: lastTs })
  }
  return out
}

// Processor.segment: collect stressed + restored windows, stable-sort by start, then merge
// adjacent same-type windows whose gap ≤ allowed_merge_gap_ms.
function segment(timestamps: number[], c: Classified): Window[] {
  const K = K_()
  const stressed = collectPass(
    K.nStressed,
    K.ruleStressed,
    -1,
    timestamps,
    c.isFinite,
    c.isFullyStressed,
    c.isBorderlineStressed,
  )
  const restored = collectPass(
    K.nRestored,
    K.ruleRestored,
    1,
    timestamps,
    c.isFinite,
    c.isFullyRestored,
    c.isBorderlineRestored,
  )
  const windows = [...stressed, ...restored]
  if (windows.length === 0) return []

  // Insertion sort by startMs (matches the .pt's stable insertion sort).
  for (let i = 1; i < windows.length; i++) {
    const cur = windows[i]
    let j = i - 1
    while (j >= 0 && windows[j].startMs > cur.startMs) {
      windows[j + 1] = windows[j]
      j -= 1
    }
    windows[j + 1] = cur
  }

  const merged: Window[] = []
  for (const w of windows) {
    const last = merged[merged.length - 1]
    if (last && last.typeId === w.typeId && w.startMs - last.endMs <= K.allowedMergeGapMs) {
      if (w.endMs > last.endMs) last.endMs = w.endMs
    } else {
      merged.push({ ...w })
    }
  }
  return merged
}

/** Run the ASTD event-detection model. Never throws — invalid input (too few bins, mismatched or
 *  non-increasing timestamps, dsa out of [−1, 1]) yields the empty/zero result (the model's raise
 *  path). */
export function runAstdEventDetection(input: AstdEventDetectionInput): AstdEventDetectionResult {
  const K = K_()
  const { dsaValues, dsaTimestampsMs } = input
  if (validate(dsaValues, dsaTimestampsMs) !== 0) return EMPTY_RESULT

  const classified = classify(dsaValues)
  const events = segment(dsaTimestampsMs, classified)

  const eventTypeIds = events.map((e) => e.typeId)
  const eventStartMs = events.map((e) => e.startMs)
  const eventEndMs = events.map((e) => e.endMs)
  const durationsMin = events.map((e) => (e.endMs - e.startMs) / 60000 + K.binWidthMinutes)

  let nStressed = 0
  let nRestored = 0
  let totalStressedMin = 0
  let totalRestoredMin = 0
  for (let i = 0; i < events.length; i++) {
    if (eventTypeIds[i] === -1) {
      nStressed += 1
      totalStressedMin += durationsMin[i]
    } else if (eventTypeIds[i] === 1) {
      nRestored += 1
      totalRestoredMin += durationsMin[i]
    }
  }

  return {
    nStressed,
    nRestored,
    totalStressedMin,
    totalRestoredMin,
    eventTypeIds,
    eventStartMs,
    eventEndMs,
    durationsMin,
  }
}
