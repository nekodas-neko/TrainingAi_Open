/**
 * Step counter (Oura `step_counter_1_3_0`). A hybrid model: algorithmic preprocessing (column select
 * + nearest-timestamp merge of the two motion streams) and postprocessing (interval resampling) in
 * TypeScript around a neural core exported to ONNX (`step_counter_1_3_0_core.onnx`, bit-exact vs the
 * .pt). Pinned end-to-end to the captured .pt golden vector
 * (lib/oura-models/onnx/__fixtures__/step_counter_1_3_0.golden.json). Ported verbatim from
 * the vendor's `step_counter_1_3_0` model source (private archive) (app.py forward + steps.py core). The core is
 * server-only (onnxruntime-node); returns null on any inference failure so callers can fall back.
 */
import type { ModelRuntime } from './runtime'

const MODEL_FILE = 'step_counter_1_3_0_core.onnx'
// Vendored model constants (step_counter_1_3_0.pt attributes).
const SELECTED_STEPMOTION_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const SELECTED_MOTION_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7]
const SHIFT_STEPMOTION_MS = -10000
const SHIFT_MOTION_MS = -30000
const MAX_DELTA_MS = 30000
const CURRENT_SAMPLING_INTERVAL_MS = 10000 // seconds_per_batch (10) × 1000

export interface StepCounterInput {
  stepmotionTimestamps: number[]  // epoch ms
  stepmotionData: number[][]      // n rows × ≥11 feature columns
  motionTimestamps: number[]      // epoch ms
  motionData: number[][]          // m rows × ≥8 feature columns
  /** resample the per-sample steps into windows of this size (ms); null = leave at the raw grid. */
  outputSamplingIntervalMs: number | null
}

export interface StepWindow {
  startMs: number
  endMs: number
  steps: number
}

const select = (rows: number[][], cols: number[]): number[][] => rows.map(r => cols.map(c => r[c]))
const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

// _merge_on_timestamp: [n, nSm + nMo] with the selected step-motion columns; each row gets the
// nearest motion row within MAX_DELTA_MS via a forward-only cursor (missing → NaN).
function mergeOnTimestamp(smTs: number[], smData: number[][], moTs: number[], moData: number[][]): number[][] {
  const n = smTs.length
  const nMo = moData[0]?.length ?? 0
  const merged = smData.map(row => [...row, ...new Array(nMo).fill(NaN)])
  const nSm = smData[0]?.length ?? 0
  let cur = 0
  for (let i = 0; i < n; i++) {
    const left = smTs[i] + SHIFT_STEPMOTION_MS
    let best = -1, bestDelta = Infinity
    for (let j = cur; j < moTs.length; j++) {
      const delta = Math.abs(left - (moTs[j] + SHIFT_MOTION_MS))
      if (delta < bestDelta) { bestDelta = delta; best = j } // argmin (first min) over moTs[cur:]
    }
    if (best >= 0 && bestDelta <= MAX_DELTA_MS) {
      for (let c = 0; c < nMo; c++) merged[i][nSm + c] = moData[best][c]
      cur = best
    }
  }
  return merged
}

async function runCore(merged: number[][], runtime: ModelRuntime): Promise<number[] | null> {
  const session = await runtime.session(MODEL_FILE)
  if (!session) return null
  try {
    const n = merged.length
    const f = merged[0]?.length ?? 0
    const flat = new Float32Array(n * f)
    for (let i = 0; i < n; i++) for (let c = 0; c < f; c++) flat[i * f + c] = merged[i][c]
    const out = await session.run({ merged_features: session.float32(flat, [n, f]) })
    return Array.from(out.steps.data as Float32Array)
  } catch (err) {
    console.warn('[step-counter] inference failed:', err)
    return null
  }
}

// _get_start_timestamps_int64: start = roll(end, 1); rows whose end−start interval is outside
// ±tolerance of the expected batch interval are recomputed as end − avg(good intervals).
function getStartTimestamps(end: number[], expected: number, tolerancePct = 0.1): number[] {
  const n = end.length
  const start = end.map((_, i) => end[(i - 1 + n) % n]) // torch.roll(end, [1])
  const delta = end.map((e, i) => e - start[i])
  const upper = expected * (1 + tolerancePct)
  const lower = expected * (1 - tolerancePct)
  const bad = delta.map(dt => dt > upper || dt < lower)
  const good = delta.filter((_, i) => !bad[i])
  const avg = good.length ? mean(good) : expected
  return start.map((s, i) => (bad[i] ? Math.trunc(end[i] - avg) : Math.trunc(s)))
}

// resample_steps: fold the per-sample steps into fixed `desired`-ms blocks, splitting each sample's
// steps proportionally across the block boundary it straddles; optionally drop incomplete edge blocks.
function resampleSteps(
  start: number[], end: number[], steps: number[], desired: number,
  removeLast: boolean, removeFirst: boolean,
): { start: number[]; end: number[]; steps: number[] } {
  const n = start.length
  const leftR = start.map(s => desired * Math.floor(s / desired))
  const rightR = end.map(e => desired * Math.floor(e / desired))
  const pctLeft = start.map((s, i) => (leftR[i] !== rightR[i] ? (rightR[i] - s) / (end[i] - s) : 0.5))
  const pctRight = pctLeft.map(p => 1 - p)
  const stepsLeft = steps.map((s, i) => s * pctLeft[i])
  const stepsRight = steps.map((s, i) => s * pctRight[i])

  const blocks = [...new Set([...leftR, ...rightR])].sort((a, b) => a - b)
  const resampledSteps = blocks.map(() => 0)
  const nOriginal = blocks.map(() => 0)
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    let ss = 0, se = 0, pl = 0, pr = 0
    for (let j = 0; j < n; j++) {
      if (leftR[j] === b) { ss += stepsLeft[j]; pl += pctLeft[j] }
      if (rightR[j] === b) { se += stepsRight[j]; pr += pctRight[j] }
    }
    resampledSteps[i] = ss + se
    nOriginal[i] = pl + pr
  }
  let rStart = blocks
  let rEnd = blocks.map(b => b + desired)
  rEnd[rEnd.length - 1] = end[end.length - 1] // copy the last real end timestamp

  const originalSampling = mean(end.map((e, i) => e - start[i]))
  const expectedOriginal = originalSampling !== 0 ? desired / originalSampling : 0
  let rSteps = resampledSteps
  if (removeLast && nOriginal[nOriginal.length - 1] < expectedOriginal * 0.95) {
    rStart = rStart.slice(0, -1); rEnd = rEnd.slice(0, -1); rSteps = rSteps.slice(0, -1)
  }
  if (removeFirst && nOriginal[0] < expectedOriginal * 0.95) {
    rStart = rStart.slice(1); rEnd = rEnd.slice(1); rSteps = rSteps.slice(1)
  }
  return { start: rStart, end: rEnd, steps: rSteps }
}

/**
 * Run the full step-counter pipeline: select columns → merge the two motion streams on timestamp →
 * neural core (ONNX) → resample into windows. Returns null if the ONNX core is unavailable (caller
 * falls back). Each window is [startMs, endMs, steps].
 */
export async function runStepCounter(input: StepCounterInput, runtime: ModelRuntime): Promise<StepWindow[] | null> {
  const smData = select(input.stepmotionData, SELECTED_STEPMOTION_COLUMNS)
  const moData = select(input.motionData, SELECTED_MOTION_COLUMNS)
  const merged = mergeOnTimestamp(input.stepmotionTimestamps, smData, input.motionTimestamps, moData)
  const endTimestamps = input.stepmotionTimestamps.slice()

  const steps = await runCore(merged, runtime)
  if (steps == null) return null

  const startTimestamps = getStartTimestamps(endTimestamps, CURRENT_SAMPLING_INTERVAL_MS)

  if (input.outputSamplingIntervalMs != null && !Number.isNaN(input.outputSamplingIntervalMs)) {
    const r = resampleSteps(startTimestamps, endTimestamps, steps, input.outputSamplingIntervalMs, false, true)
    return r.start.map((s, i) => ({ startMs: s, endMs: r.end[i], steps: r.steps[i] }))
  }
  return startTimestamps.map((s, i) => ({ startMs: s, endMs: endTimestamps[i], steps: steps[i] }))
}
