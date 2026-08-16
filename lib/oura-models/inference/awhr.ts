/**
 * Awake-HR imputation (Oura `awhr_imputation_1_2_0`) ONNX inference.
 *
 * A bidirectional 2-layer LSTM (13 features/step → 4-layer MLP head, `144→144→72→36→1`) that imputes
 * awake heart-rate gaps from a per-step feature sequence. Feature assembly is a separate step.
 * Server-only (onnxruntime-node). Infallible: any bad input or inference failure returns `null` so the
 * caller keeps the measured/absent value.
 */
import { getSession } from './session'

const MODEL_FILE = 'awhr_imputation_1_2_0.onnx'
export const AWHR_FEATURES = 13

/**
 * Run awake-HR imputation over a per-step feature sequence (`seqLen` rows × 13 features).
 * Returns one imputed HR value per step, or `null` on empty/malformed input or inference failure.
 */
export async function runAwhrImputation(sequence: number[][]): Promise<number[] | null> {
  const seqLen = sequence.length
  if (seqLen === 0 || sequence.some(row => row.length !== AWHR_FEATURES)) {
    console.warn('[awhr] bad input sequence (need non-empty rows of 13 features)')
    return null
  }
  const session = await getSession(MODEL_FILE)
  if (!session) return null
  try {
    const flat = new Float32Array(seqLen * AWHR_FEATURES)
    for (let i = 0; i < seqLen; i++)
      for (let c = 0; c < AWHR_FEATURES; c++) flat[i * AWHR_FEATURES + c] = sequence[i][c]
    const ort = await import('onnxruntime-node')
    const out = await session.run({ sequence: new ort.Tensor('float32', flat, [1, seqLen, AWHR_FEATURES]) })
    return Array.from(out.imputed_hr.data as Float32Array)
  } catch (err) {
    console.warn('[awhr] inference failed:', err)
    return null
  }
}
