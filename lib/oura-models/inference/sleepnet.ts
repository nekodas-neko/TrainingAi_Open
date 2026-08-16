/**
 * SleepNet (Oura `sleepnet_moonstone_1_2_0`) ONNX inference — the neural sleep stager.
 *
 * Runs the exported CNN core over a preprocessed night and returns per-epoch stage codes + apnea
 * flags. This is the model's neural core only; assembling `highRes`/`lowRes` from BLE samples (the
 * preprocessor port) is a separate step. Infallible: any failure returns `null` and the caller
 * falls back to the heuristic stager.
 *
 * I/O (shapes below):
 *   highRes: Float32Array length 115200*3 = [ibi_ms, amplitude, spo2] @ 2.1333 Hz, C-order (t*3+c)
 *   lowRes:  Float32Array length 1800     = motion per 30-s epoch
 *   → staging_logits (1,4,1800) argmax over 4 classes + 1 → stage code; apnea_logits (1,1,1800).
 *
 * Stage codes match the repo's `sleep_phase_5_min` convention (postprocessor `argmax+1`):
 *   1 = deep, 2 = light, 3 = REM, 4 = awake.
 */
import { getSession } from './session'

const MODEL_FILE = 'sleepnet_moonstone_1_2_0_core.onnx'
const N_EPOCHS = 1800
const N_CLASSES = 4
export const HIGH_RES_LEN = 115200
export const HIGH_RES_CH = 3
export const APNEA_THRESHOLD = 0.61 // _postprocessor.apnea_event_threshold

export type StageCode = 1 | 2 | 3 | 4
export interface SleepNetResult {
  /** length 1800, one code per 30-s epoch (1=deep 2=light 3=rem 4=awake) */
  stageCodes: StageCode[]
  /** length 1800, apnea event per epoch (sigmoid(logit) > 0.61) */
  apnea: boolean[]
}

/**
 * Run SleepNet on a preprocessed night. Returns `null` on any failure (model unavailable, bad
 * input shape, runtime error) so the caller can fall back to the heuristic stager.
 */
export async function runSleepNet(
  highRes: Float32Array,
  lowRes: Float32Array,
): Promise<SleepNetResult | null> {
  if (highRes.length !== HIGH_RES_LEN * HIGH_RES_CH || lowRes.length !== N_EPOCHS) {
    console.warn(
      `[sleepnet] bad input shape: highRes=${highRes.length} (want ${HIGH_RES_LEN * HIGH_RES_CH}), ` +
        `lowRes=${lowRes.length} (want ${N_EPOCHS})`,
    )
    return null
  }

  const session = await getSession(MODEL_FILE)
  if (!session) return null

  try {
    const ort = await import('onnxruntime-node')
    const feeds = {
      high_res: new ort.Tensor('float32', highRes, [1, HIGH_RES_LEN, HIGH_RES_CH]),
      low_res: new ort.Tensor('float32', lowRes, [1, N_EPOCHS, 1]),
    }
    const out = await session.run(feeds)
    const staging = out.staging_logits.data as Float32Array // [1,4,1800] -> c*1800 + t
    const apneaLogits = out.apnea_logits.data as Float32Array // [1,1,1800]

    const stageCodes = new Array<StageCode>(N_EPOCHS)
    const apnea = new Array<boolean>(N_EPOCHS)
    for (let t = 0; t < N_EPOCHS; t++) {
      let best = 0
      let bestVal = staging[t] // class 0 at [0*1800 + t]
      for (let c = 1; c < N_CLASSES; c++) {
        const v = staging[c * N_EPOCHS + t]
        if (v > bestVal) {
          bestVal = v
          best = c
        }
      }
      stageCodes[t] = (best + 1) as StageCode
      // sigmoid(x) > 0.61  <=>  x > logit(0.61)
      apnea[t] = apneaLogits[t] > Math.log(APNEA_THRESHOLD / (1 - APNEA_THRESHOLD))
    }
    return { stageCodes, apnea }
  } catch (err) {
    console.warn('[sleepnet] inference failed:', err)
    return null
  }
}
