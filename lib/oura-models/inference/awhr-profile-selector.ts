/**
 * AWHR profile selector (Oura `awhr_profile_selector_1_0_1`). A hybrid model: algorithmic
 * pre/postprocessing in TypeScript around a neural core exported to ONNX
 * (`awhr_profile_selector_1_0_1_core.onnx`, bit-exact vs the .pt). It classifies the day's dominant
 * activity "profile" from the ring's stepmotion + motion feature streams — selecting columns, merging
 * the two streams on timestamp, running an MLP→BiLSTM→FC core, then aggregating per-timestep
 * probabilities into a main activity id and a resampled per-block activity series.
 *
 * Pinned end-to-end to the captured .pt golden vector
 * (lib/oura-models/onnx/__fixtures__/awhr_profile_selector_1_0_1.golden.json). Ported verbatim from
 * the vendor's `awhr_profile_selector_1_0_1` model source (private archive) (app.py + activity.py + core.py). The
 * neural core (MLP + bidirectional LSTM + FC) is exported by
 * scripts/oura-models/export-awhr-profile-selector-core.py; the glue (column select, timestamp merge,
 * nan→0, zero-row masking, softmax, aggregation, id→ecore mapping, resample) lives here. The core's
 * zero-row NaN mask is applied to the LSTM *output*, so masking the softmax rows in TS is exact.
 *
 * Server-only (onnxruntime-node); returns null on any inference failure so callers can fall back.
 * Library port only — not wired into any surface or the rollup.
 */
import { getSession } from './session'

const MODEL_FILE = 'awhr_profile_selector_1_0_1_core.onnx'
// Vendored model constants (awhr_profile_selector_1_0_1.pt attributes).
const SELECTED_STEPMOTION_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const SELECTED_MOTION_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7]
const SHIFT_STEPMOTION_MS = -10000
const SHIFT_MOTION_MS = -30000
const MAX_DELTA_MS = 30000
const NUM_CLASSES = 3
const ID_TO_ECORE_ID: Record<number, number> = { 0: 14, 1: 5, 2: 12 }

export interface AwhrProfileSelectorInput {
  stepmotionTimestamps: number[] // epoch ms
  stepmotionData: number[][]     // n rows × ≥11 feature columns
  motionTimestamps: number[]     // epoch ms
  motionData: number[][]         // m rows × ≥8 feature columns
  /** resample the per-sample activity probabilities into blocks of this size (ms); null = no resample. */
  outputSamplingIntervalMs: number | null
}

export interface AwhrProfileSelectorResult {
  mainActivityEcoreId: number  // dominant activity (ecore id) over the whole window
  timestamps: number[]         // per-block timestamps (resampled grid, or raw stepmotion grid)
  activityEcoreIds: number[]   // dominant activity (ecore id) per block
}

const select = (rows: number[][], cols: number[]): number[][] => rows.map((r) => cols.map((c) => r[c]))

// _merge_on_timestamp: [n, nSm + nMo] with the selected step-motion columns first; each row gets the
// nearest motion row within MAX_DELTA_MS via a forward-only cursor (missing → NaN).
function mergeOnTimestamp(
  smTs: number[],
  smData: number[][],
  moTs: number[],
  moData: number[][],
): number[][] {
  const n = smTs.length
  const nMo = moData[0]?.length ?? 0
  const nSm = smData[0]?.length ?? 0
  const merged = smData.map((row) => [...row, ...new Array(nMo).fill(NaN)])
  let cur = 0
  for (let i = 0; i < n; i++) {
    const left = smTs[i] + SHIFT_STEPMOTION_MS
    let best = -1
    let bestDelta = Infinity
    for (let j = cur; j < moTs.length; j++) {
      const delta = Math.abs(left - (moTs[j] + SHIFT_MOTION_MS))
      if (delta < bestDelta) {
        bestDelta = delta
        best = j
      } // argmin (first min) over moTs[cur:]
    }
    if (best >= 0 && bestDelta <= MAX_DELTA_MS) {
      for (let c = 0; c < nMo; c++) merged[i][nSm + c] = moData[best][c]
      cur = best
    }
  }
  return merged
}

// Run the ONNX neural core (MLP → BiLSTM → FC) over the nan→0 merged features → per-timestep logits.
async function runCore(merged: number[][]): Promise<number[][] | null> {
  const session = await getSession(MODEL_FILE)
  if (!session) return null
  try {
    const n = merged.length
    const f = merged[0]?.length ?? 0
    const flat = new Float32Array(n * f)
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < f; c++) {
        const v = merged[i][c]
        flat[i * f + c] = Number.isNaN(v) ? 0 : v // ActivityCoreModel nan_to_num (all defaults 0)
      }
    }
    const ort = await import('onnxruntime-node')
    const out = await session.run({ merged_features: new ort.Tensor('float32', flat, [n, f]) })
    const data = out.logits.data as Float32Array
    const logits: number[][] = []
    for (let i = 0; i < n; i++) logits.push(Array.from(data.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES)))
    return logits
  } catch (err) {
    console.warn('[awhr-profile-selector] inference failed:', err)
    return null
  }
}

function softmaxRow(logits: number[]): number[] {
  const mx = Math.max(...logits)
  const e = logits.map((v) => Math.exp(v - mx))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / s)
}

// torch.argmax: index of the first maximal element (NaN never compares greater; all-NaN → 0).
function argmax(a: number[]): number {
  let bestI = 0
  let best = a[0]
  for (let i = 1; i < a.length; i++) {
    if (a[i] > best) {
      best = a[i]
      bestI = i
    }
  }
  return bestI
}

// Column-wise mean over a set of probability rows (NaN-propagating, like torch.mean).
function meanRows(rows: number[][]): number[] {
  const out = new Array(NUM_CLASSES).fill(0)
  for (const r of rows) for (let c = 0; c < NUM_CLASSES; c++) out[c] += r[c]
  return out.map((v) => v / rows.length)
}

/**
 * Run the full AWHR profile-selector pipeline: select columns → merge the two streams on timestamp →
 * neural core (ONNX) → softmax + zero-row masking → aggregate to a main activity and (optionally)
 * resample the per-timestep activity into blocks. Returns null if the ONNX core is unavailable.
 */
export async function runAwhrProfileSelector(
  input: AwhrProfileSelectorInput,
): Promise<AwhrProfileSelectorResult | null> {
  const smData = select(input.stepmotionData, SELECTED_STEPMOTION_COLUMNS)
  const moData = select(input.motionData, SELECTED_MOTION_COLUMNS)
  const merged = mergeOnTimestamp(input.stepmotionTimestamps, smData, input.motionTimestamps, moData)

  const logits = await runCore(merged)
  if (logits == null) return null

  // Per-timestep probabilities; a row of exact zeros (all features 0) is masked to NaN, matching the
  // model's zero-mask applied to the LSTM output (NaN → NaN softmax).
  const zeroMask = merged.map((row) => row.every((v) => v === 0))
  const probs = logits.map((row, i) => (zeroMask[i] ? new Array(NUM_CLASSES).fill(NaN) : softmaxRow(row)))

  // Main activity: argmax of the mean probability over all timesteps.
  const agg = meanRows(probs)
  const mainActivityEcoreId = ID_TO_ECORE_ID[argmax(agg)]

  const timestamps = input.stepmotionTimestamps
  const interval = input.outputSamplingIntervalMs
  if (interval != null && !Number.isNaN(interval)) {
    const resampledTs = timestamps.map((t) => interval * Math.floor(t / interval))
    const blocks = [...new Set(resampledTs)].sort((a, b) => a - b)
    const blockEcoreIds = blocks.map((b) => {
      const rows = probs.filter((_, i) => resampledTs[i] === b)
      return ID_TO_ECORE_ID[argmax(meanRows(rows))]
    })
    return { mainActivityEcoreId, timestamps: blocks, activityEcoreIds: blockEcoreIds }
  }

  // No resample: per-timestep argmax on the raw grid.
  return {
    mainActivityEcoreId,
    timestamps,
    activityEcoreIds: probs.map((row) => ID_TO_ECORE_ID[argmax(row)]),
  }
}
