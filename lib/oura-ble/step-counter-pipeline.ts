/**
 * Real-data step-counter pipeline: assemble Oura's step models' inputs from the ring's stored raw
 * BLE frames and run them, for owner validation against a phone's step count.
 *
 * Chain (all pieces already ported + golden-verified in isolation):
 *   stored 0x7e/0x7f frames → pairStepFeatures/unpack27 (27 quantized gait columns per ~30 s window)
 *     → runStepsMotionDecoder  (dequantize → 11 physical gait features, expand each window to 3×10 s)
 *     → runStepCounter          (+ motion 0x47 stream → per-window step counts)
 *
 * Column-order contract (the bug found + fixed 2026-07-22): `steps_motion_decoder`'s 11 output columns
 * are in a DIFFERENT order than `step_counter`'s stepmotion `features`. Feeding the decoder output
 * straight through made the model read `stride_frequency` from the `first_non_locomotor_frequency`
 * slot (≈0 while walking) → `steps = stride_frequency×10` = 0 on every window (confirmed on-device:
 * clear 2.09 Hz walking → 0 steps). Fixed by `toStepmotionModelOrder` (STEPMOTION_MODEL_ORDER) below.
 * The 0x47 → step_counter 8-motion-column mapping was investigated and is CORRECT (`regular_motion`
 * left NaN → the model's nan→0). `steps_motion_decoder` is golden-verified, so `strideFrequencyHz`
 * (read pre-reorder) is a physically interpretable cadence sanity signal (walking ≈ 1.5–3 Hz)
 * independent of the step_counter total.
 *
 * REMAINING device gate (accuracy, not the 0-bug): the admin console exists to confirm the count now
 * matches a *counted* walk before we adopt step_counter as primary + run the historical backfill.
 *
 * Timestamps: stored frames are keyed by ring deciseconds (`ring_timestamp_ds`); both streams are
 * converted to epoch ms by the SAME caller-supplied resolver, so the models' diff/merge math
 * is anchor-invariant.
 */
import { decodeEventBody, hexToBytes } from './decode'
import { pairStepFeatures, type StepFeatureFrame } from './step-features'
import { runStepsMotionDecoder, setStepsDecoderConstants, hasStepsDecoderConstants, STRIDE_FREQUENCY_COLUMN } from '@/lib/oura-models/steps-motion-decoder'
import { getStepsDecoderConstants } from '@/lib/oura-models/constants'
import { runStepCounter, type StepWindow } from '@/lib/oura-models/inference/step-counter'
import { estimateSteps } from '@trainingai/shared/health/step-estimate'

/** A stored raw sample row reduced to what the pipeline needs. */
export interface RawFrame {
  ringTimestampDs: number
  tag: number
  bodyHex: string
}

// steps_motion_decoder output column 4 is `stride_frequency` (Hz) — the interpretable cadence
// signal. The column-index constant lives in steps-motion-decoder.ts (the module that owns that
// output shape) rather than here, since this file also imports runStepCounter/onnxruntime-node —
// a client-side consumer that only needs the column index (lib/health/gait-classifier.ts's
// caller, lib/activity/auto-detection-service.ts) must never have to pull that ONNX dependency
// into its bundle just to read a constant.

// CRITICAL: steps_motion_decoder's 11 output columns are in a DIFFERENT order than step_counter's
// stepmotion feature order — feeding the decoder output straight through made the model read
// `stride_frequency` from the `first_non_locomotor_frequency` slot (≈0 while walking), so
// `steps = stride_frequency×10` computed on ~0 → 0 steps on every window (confirmed on-device
// 2026-07-22: clear walking @2.09 Hz cadence → 0 steps). Reorder into the model's `features` order.
//   decoder output_columns (timestamp-excluded): [sum_accel_mg_std, y_accel_std_ratio,
//     z_accel_std_ratio, total_amplitude_mg, stride_frequency, stride_amplitude_frac,
//     first_non_locomotor_frequency, first_non_locomotor_amplitude_frac, gait_amplitude_frac,
//     frequency_bin_high_frac, frequency_bin_mid_frac]
//   model features[0..10]: [first_non_locomotor_frequency, first_non_locomotor_amplitude_frac,
//     frequency_bin_high_frac, frequency_bin_mid_frac, gait_amplitude_frac, stride_amplitude_frac,
//     stride_frequency, sum_accel_mg_std, total_amplitude_mg, y_accel_std_ratio, z_accel_std_ratio]
// So model col i sources decoder col STEPMOTION_MODEL_ORDER[i]. (The golden fixture is already in
// model order + is random noise, so the golden parity test structurally can't catch this.)
const STEPMOTION_MODEL_ORDER = [6, 7, 9, 10, 8, 5, 4, 0, 3, 1, 2] as const
const toStepmotionModelOrder = (rows: number[][]): number[][] =>
  rows.map((r) => STEPMOTION_MODEL_ORDER.map((c) => r[c]))

// step_counter resamples steps into fixed windows; 60 s is a sensible export grain for validation.
const OUTPUT_SAMPLING_INTERVAL_MS = 60_000

const STEP_TAG_FEATURE_1 = 0x7e
const STEP_TAG_FEATURE_2 = 0x7f
const MOTION_TAG = 0x47

export interface StepCounterPipelineResult {
  /** Paired 0x7e/0x7f windows found (before dequantization). */
  pairedWindows: number
  /** Motion (0x47) frames used for the motion stream. */
  motionFrames: number
  /** step_counter step-count windows (experimental — see the module header caveats). */
  stepWindows: StepWindow[]
  /** Sum of step_counter window steps. */
  totalSteps: number
  /** The independent Tier-1 walk-gate estimate (lib/health/step-estimate.ts) for cross-check. */
  gateEstimateSteps: number
  /** Decoded stride-frequency (Hz) per 10 s sub-row — the physically interpretable sanity signal. */
  strideFrequencyHz: number[]
}

/** Build the motion feature matrix [m][8] from decoded 0x47 frames, in step_counter's column order:
 *  [orientation, motion_seconds, avg_x, avg_y, avg_z, regular_motion (NaN — not decoded),
 *   low_intensity, high_intensity]. Frames that don't decode are skipped. */
function motionRows(frames: RawFrame[]): { data: number[][]; ds: number[] } {
  const data: number[][] = []
  const ds: number[] = []
  for (const f of frames) {
    const decoded = decodeEventBody(f.tag, hexToBytes(f.bodyHex))
    if (!decoded) continue
    const num = (k: string): number => (typeof decoded[k] === 'number' ? (decoded[k] as number) : NaN)
    data.push([
      num('orientation'),
      num('motion_seconds'),
      num('avg_x'),
      num('avg_y'),
      num('avg_z'),
      NaN, // regular_motion — not decoded from 0x47
      num('low_intensity'),
      num('high_intensity'),
    ])
    ds.push(f.ringTimestampDs)
  }
  return { data, ds }
}

/**
 * Run the full real-data step pipeline over a set of stored raw frames. `stepFrames` should be the
 * day's 0x7e/0x7f frames; `motionFrames` the day's 0x47 frames (may be empty — the step model then
 * runs with a zeroed motion stream). Returns null only if there are no usable paired step windows.
 */
export async function runStepCounterPipeline(
  stepFrames: RawFrame[],
  motionFrames: RawFrame[],
  /** ds -> wall-clock ms. The caller owns anchor policy; this pipeline only needs the conversion. */
  toMs: (ds: number) => number,
): Promise<StepCounterPipelineResult | null> {

  // 1. Pair + unpack the step-feature frames into 27-column windows.
  const frames: StepFeatureFrame[] = stepFrames
    .filter((f) => f.tag === STEP_TAG_FEATURE_1 || f.tag === STEP_TAG_FEATURE_2)
    .map((f) => ({ ds: f.ringTimestampDs, tag: f.tag, body: hexToBytes(f.bodyHex) }))
  const paired = pairStepFeatures(frames)
  if (paired.length === 0) return null

  // 2. Dequantize: 27 columns → 11 physical gait features, each window expanded to 3×10 s sub-rows.
  // Server-side, so the table comes off disk (Q-221 — the decoder no longer holds it at module
  // scope, because that static import is what put it in the browser bundle). Memoised by the
  // constants reader, so this is one file read per process.
  if (!hasStepsDecoderConstants()) setStepsDecoderConstants(getStepsDecoderConstants())
  const decoded = runStepsMotionDecoder({
    timestamps: paired.map((p) => toMs(p.ds)),
    data: paired.map((p) => p.columns),
  })
  const strideFrequencyHz = decoded.data.map((row) => row[STRIDE_FREQUENCY_COLUMN])

  // 3. Motion stream from 0x47. step_counter's ONNX core needs 19 columns (11 stepmotion + 8
  //    motion), so when no motion frames exist (0x47 is often absent daytime) we feed an all-NaN
  //    8-column motion stream aligned to the stepmotion timestamps → the model's nan→0 zeroes it.
  const motion = motionRows(motionFrames.filter((f) => f.tag === MOTION_TAG))
  let motionData = motion.data
  let motionTimestamps = motion.ds.map(toMs)
  if (motionData.length === 0) {
    motionData = decoded.timestamps.map(() => new Array<number>(8).fill(NaN))
    motionTimestamps = decoded.timestamps.slice()
  }

  // 4. step_counter over the decoded stepmotion + motion streams.
  const stepWindows =
    (await runStepCounter({
      stepmotionTimestamps: decoded.timestamps,
      // Reorder the decoder's 11 columns into step_counter's stepmotion feature order (see
      // STEPMOTION_MODEL_ORDER) — an identity pass-through fed the model garbage and zeroed steps.
      stepmotionData: toStepmotionModelOrder(decoded.data),
      motionTimestamps,
      motionData,
      outputSamplingIntervalMs: OUTPUT_SAMPLING_INTERVAL_MS,
    })) ?? []

  return {
    pairedWindows: paired.length,
    motionFrames: motion.data.length, // real 0x47 frames used (0 when the zeroed stream was synthesized)
    stepWindows,
    totalSteps: stepWindows.reduce((s, w) => s + w.steps, 0),
    gateEstimateSteps: estimateSteps(paired).estimatedSteps,
    strideFrequencyHz,
  }
}
