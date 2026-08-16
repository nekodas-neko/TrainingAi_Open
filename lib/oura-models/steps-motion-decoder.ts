// steps_motion_decoder_2_0_0 — a faithful TypeScript port of the 0-parameter algorithmic
// TorchScript model (StepsMotionDecoderModel). It dequantizes the ring's compact 30-second
// motion frames (27 encoded columns per frame) back into gait features, then expands each 30 s
// frame into three 10-second sub-rows (11 output features each) with interpolated timestamps.
//
// Each frame packs three consecutive 10 s windows: three shared per-frame columns
// (sum_accel_mg_std, y/z_accel_std_ratio) + eight per-window gait features repeated for windows
// _1/_2/_3. Decoding is per-column linear dequantization (optionally through a log/sqrt transform)
// using the vendored `decoder_base_settings` / `decoder_transform_settings` tables.
//
// Pinned to the captured .pt golden vector
// (lib/oura-models/onnx/__fixtures__/steps_motion_decoder_2_0_0.golden.json, both outputs bit-exact).
// Ported from the vendor's `steps_motion_decoder_2_0_0` model source (private archive). Constants via
// getStepsDecoderConstants() — do NOT hardcode the low/high/bits tables.
//
// Library port only — not yet wired into the ring's motion-frame decode path (lib/oura-ble/decode.ts)
// or the step-counter pipeline; feeding it real ring frames is the follow-on.

import type { StepsDecoderConstants } from './constants/steps-decoder-types'

// The dequantisation table is INJECTED, not imported (Q-221). Holding it at module scope meant a
// static JSON import, which webpack compiled into the browser bundle — and `_next/static` is outside
// `middleware.ts`'s matcher, so those chunks are served with no session. That breaks the owner's
// rule that nothing Oura-derived is reachable unauthenticated. Server callers inject from disk;
// the client fetches it once from an authenticated route.
let _k: StepsDecoderConstants | null = null

/** Provide the dequantisation table. Server: from disk. Client: from `/api/oura-ble/decoder-constants`. */
export function setStepsDecoderConstants(k: StepsDecoderConstants): void {
  _k = k
}

/** Test-only: forget the injected table so a test can assert the unset behaviour. */
export function __clearStepsDecoderConstants(): void {
  _k = null
}

export function hasStepsDecoderConstants(): boolean {
  return _k !== null
}

/**
 * Throws rather than defaulting, deliberately. Every number this decoder produces is a physical
 * quantity derived from these bounds — with no table it would emit plausible, wrong values that
 * flow into step counts and activity auto-detection. A caller that cannot supply the table must do
 * nothing, not guess.
 */
function getK(): StepsDecoderConstants {
  if (!_k) {
    throw new Error(
      'steps-motion-decoder: constants not set — call setStepsDecoderConstants() first ' +
        '(server: getStepsDecoderConstants() from lib/oura-models/constants; client: GET /api/oura-ble/decoder-constants)',
    )
  }
  return _k
}

// This module's own output column order (decoder output_columns, timestamp-excluded):
// [sum_accel_mg_std, y_accel_std_ratio, z_accel_std_ratio, total_amplitude_mg, stride_frequency,
// stride_amplitude_frac, first_non_locomotor_frequency, first_non_locomotor_amplitude_frac,
// gait_amplitude_frac, frequency_bin_high_frac, frequency_bin_mid_frac]. Exported so every
// consumer of this decoder's raw output reads the same indices instead of re-deriving them —
// NOT the STEPMOTION_MODEL_ORDER-reordered indices step-counter-pipeline.ts uses to feed
// `runStepCounter`, which is a different model with a different expected column order.
export const TOTAL_AMPLITUDE_MG_COLUMN = 3
export const STRIDE_FREQUENCY_COLUMN = 4
export const STRIDE_AMPLITUDE_FRAC_COLUMN = 5

export interface StepsMotionDecoderInput {
  timestamps: number[] // [N] int (ms since epoch, one per 30 s frame)
  data: number[][]     // [N][27] quantized motion columns (see K.data_columns for the order)
}

export interface StepsMotionDecoderOutput {
  timestamps: number[] // [3N] int — three interpolated sub-row timestamps per frame
  data: number[][]     // [3N][11] dequantized gait features
}

// apply_transform_func: the four named transforms, else identity (covers the "" default).
function applyTransform(name: string, x: number): number {
  switch (name) {
    case 'log_transform':
      return Math.log10(x + 1)
    case 'log_itransform':
      return Math.pow(10, x) - 1
    case 'sqrt':
      return Math.sqrt(x)
    case 'square':
      return x * x
    default:
      return x
  }
}

// decode(): per-column linear dequantization. `x` holds the quantized integer codes (as floats).
// A truthy encode_zero reserves code 0 for "no value" (shift down one, restore the zeros at the
// end via the > 0 mask). low/high are optionally transformed, and the mapped value optionally
// inverse-transformed, matching the .pt's `decode`.
function decodeColumn(
  x: number[],
  low: number,
  high: number,
  bits: number,
  encodeZero: number,
  transform: string,
  inverseTransform: string,
): number[] {
  const zeroMask = x.map((v) => (v > 0 ? 1 : 0))
  let availableValues = Math.pow(2, bits)
  let xs = x
  if (encodeZero) {
    availableValues = availableValues - 1
    const shifted = x.map((v) => v - 1)
    const mx = Math.max(...shifted)
    xs = shifted.map((v) => Math.min(Math.max(v, 0), mx)) // torch.clamp(x-1, 0, max(x-1))
  }
  const low0 = applyTransform(transform, low)
  const high0 = applyTransform(transform, high)
  return xs.map((v, i) => {
    let val = (v / availableValues) * (high0 - low0) + low0
    val = applyTransform(inverseTransform, val)
    if (encodeZero) val = val * zeroMask[i]
    return val
  })
}

// get_decoder_settings: strip the _1/_2/_3 window suffix to reach the base column key.
function baseKey(column: string): string {
  return column.replaceAll('_1', '').replaceAll('_2', '').replaceAll('_3', '')
}

const N_SHARED = 3 // the three per-frame columns shared across all 3 sub-rows

/** Run the steps motion decoder. `data` must be [N][27] (K.data_columns order). Returns the
 *  dequantized [3N][11] gait feature rows + their interpolated timestamps. */
export function runStepsMotionDecoder(input: StepsMotionDecoderInput): StepsMotionDecoderOutput {
  const K = getK()
  const { timestamps, data } = input
  const n = timestamps.length
  const nCols = K.data_columns.length // 27

  // Dequantize each of the 27 columns in place on a clone of the input frame matrix.
  const decoded: number[][] = data.map((row) => row.slice())
  for (let col = 0; col < nCols; col++) {
    const key = baseKey(K.data_columns[col])
    const s = K.decoder_base_settings[key]
    const t = K.decoder_transform_settings[key] ?? { transform: '', inverse_transform: '' }
    const column = decoded.map((row) => row[col])
    const dq = decodeColumn(
      column,
      s.low,
      s.high,
      s.bits,
      s.encode_zero ?? 0,
      t.transform ?? '',
      t.inverse_transform ?? '',
    )
    for (let f = 0; f < n; f++) decoded[f][col] = dq[f]
  }

  // reshape: expand each frame into 3 sub-rows with interpolated timestamps.
  const nFeat = (nCols - N_SHARED) / K.n_features_30s // 8 repeated gait features per window

  let diffs: number[]
  if (n > 1) {
    diffs = [timestamps[1] - timestamps[0]]
    for (let i = 1; i < n; i++) diffs.push(timestamps[i] - timestamps[i - 1])
    // A frame gap outside ~30 s (25.5–34.5 s) is treated as a nominal 30 s.
    diffs = diffs.map((dprev) => (dprev > 34500 || dprev < 25500 ? 30000 : dprev))
  } else {
    diffs = [30000]
  }
  const delta = diffs.map((d) => Math.floor(d / 3))

  const outTimestamps = new Array<number>(K.n_features_30s * n)
  const outData: number[][] = Array.from({ length: K.n_features_30s * n }, () =>
    new Array<number>(K.n_output_features).fill(0),
  )

  for (let f = 0; f < n; f++) {
    const r0 = 3 * f
    outTimestamps[r0 + 0] = timestamps[f] - delta[f] * 2
    outTimestamps[r0 + 1] = timestamps[f] - delta[f]
    outTimestamps[r0 + 2] = timestamps[f]

    // Shared columns (0..2) copied to all three sub-rows.
    for (let i = 0; i < N_SHARED; i++) {
      outData[r0 + 0][i] = decoded[f][i]
      outData[r0 + 1][i] = decoded[f][i]
      outData[r0 + 2][i] = decoded[f][i]
    }
    // Per-window gait features: sub-row k takes the _{k+1} group.
    for (let fi = 0; fi < nFeat; fi++) {
      outData[r0 + 0][N_SHARED + fi] = decoded[f][N_SHARED + fi]
      outData[r0 + 1][N_SHARED + fi] = decoded[f][N_SHARED + nFeat + fi]
      outData[r0 + 2][N_SHARED + fi] = decoded[f][N_SHARED + 2 * nFeat + fi]
    }
  }

  return { timestamps: outTimestamps, data: outData }
}
