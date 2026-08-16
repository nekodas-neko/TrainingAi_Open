/**
 * Energy expenditure (Oura `energy_expenditure_1_0_0`) ONNX inference.
 *
 * Two MLP heads: a with-HR model (50 features) and a no-HR model (42 features), each →
 * active-energy (kcal, ReLU-clamped ≥ 0). Assembling the feature vector from motion/steps/HR is a
 * separate step. Infallible: any failure returns `null` so the caller keeps the existing value.
 */
import { getSession } from './session'

export const ENERGY_HR_FEATURES = 50
export const ENERGY_NO_HR_FEATURES = 42

/**
 * Run active-energy inference. The head is chosen by feature length: 50 → with-HR, 42 → no-HR.
 * Returns kcal, or `null` on any failure or an unrecognised feature length.
 */
export async function runEnergyExpenditure(features: Float32Array): Promise<number | null> {
  const file =
    features.length === ENERGY_HR_FEATURES
      ? 'energy_expenditure_1_0_0_hr.onnx'
      : features.length === ENERGY_NO_HR_FEATURES
        ? 'energy_expenditure_1_0_0_no_hr.onnx'
        : null
  if (!file) {
    console.warn(`[energy] bad feature length ${features.length} (want ${ENERGY_HR_FEATURES} or ${ENERGY_NO_HR_FEATURES})`)
    return null
  }
  const session = await getSession(file)
  if (!session) return null
  try {
    const ort = await import('onnxruntime-node')
    const out = await session.run({ features: new ort.Tensor('float32', features, [1, features.length]) })
    return (out.output.data as Float32Array)[0]
  } catch (err) {
    console.warn('[energy] inference failed:', err)
    return null
  }
}
