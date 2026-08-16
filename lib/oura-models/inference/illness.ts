/**
 * Illness detection (Oura `illness_detection_0_5_1`) ONNX inference.
 *
 * A two-branch net: a 1-D conv over an 8-channel time series is concatenated with 4 scalars plus
 * the time series' first sample / std / mean per channel, then an MLP → sigmoid → illness
 * probability. Assembling the inputs from biometrics is a separate step; this is the neural core.
 * Infallible: any failure returns `null` so the caller falls back to the heuristic illness radar.
 *
 * Inputs (shapes below):
 *   scalars:    Float32Array length 4
 *   timeSeries: Float32Array length 8*30 = 240, C-order (channel*30 + t)
 *   → illness probability in [0, 1].
 */
import { getSession } from './session'

const MODEL_FILE = 'illness_detection_0_5_1.onnx'
export const ILLNESS_SCALARS_LEN = 4
export const ILLNESS_TS_CHANNELS = 8
export const ILLNESS_TS_LEN = 30

export async function runIllnessDetection(
  scalars: Float32Array,
  timeSeries: Float32Array,
): Promise<number | null> {
  if (scalars.length !== ILLNESS_SCALARS_LEN || timeSeries.length !== ILLNESS_TS_CHANNELS * ILLNESS_TS_LEN) {
    console.warn(
      `[illness] bad input shape: scalars=${scalars.length} (want ${ILLNESS_SCALARS_LEN}), ` +
        `timeSeries=${timeSeries.length} (want ${ILLNESS_TS_CHANNELS * ILLNESS_TS_LEN})`,
    )
    return null
  }
  const session = await getSession(MODEL_FILE)
  if (!session) return null
  try {
    const ort = await import('onnxruntime-node')
    const out = await session.run({
      scalars: new ort.Tensor('float32', scalars, [1, ILLNESS_SCALARS_LEN]),
      time_series: new ort.Tensor('float32', timeSeries, [1, ILLNESS_TS_CHANNELS, ILLNESS_TS_LEN]),
    })
    return (out.illness_prob.data as Float32Array)[0]
  } catch (err) {
    console.warn('[illness] inference failed:', err)
    return null
  }
}
