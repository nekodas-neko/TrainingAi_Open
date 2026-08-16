/**
 * Daytime-HRV imputation (Oura `dhrv_imputation_1_1_0`) ONNX inference.
 *
 * A 4-layer MLP (10 features → imputed daytime HRV), used to fill sparse daytime HRV that feeds the
 * daytime-stress signal (`intensity = dhrv − baseline`). Feature assembly is a separate step.
 * Infallible: any failure returns `null` so the caller keeps the measured/absent value.
 */
import { getSession } from './session'

const MODEL_FILE = 'dhrv_imputation_1_1_0.onnx'
export const DHRV_FEATURES = 10

export async function runDhrvImputation(features: Float32Array): Promise<number | null> {
  if (features.length !== DHRV_FEATURES) {
    console.warn(`[dhrv] bad feature length ${features.length} (want ${DHRV_FEATURES})`)
    return null
  }
  const session = await getSession(MODEL_FILE)
  if (!session) return null
  try {
    const ort = await import('onnxruntime-node')
    const out = await session.run({ features: new ort.Tensor('float32', features, [1, DHRV_FEATURES]) })
    return (out.dhrv.data as Float32Array)[0]
  } catch (err) {
    console.warn('[dhrv] inference failed:', err)
    return null
  }
}
