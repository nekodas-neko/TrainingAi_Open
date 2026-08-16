import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `helpers/replay-session.ts`. Everything else (feed layout, argmax, apnea threshold, the
// null-on-bad-shape contract) executes for real, which is the part that can actually regress.
vi.mock('../session', async importOriginal => {
  const actual = await importOriginal<typeof import('../session')>()
  const { makeReplayGetSession } = await import('./helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { runSleepNet, HIGH_RES_LEN, HIGH_RES_CH, APNEA_THRESHOLD } from '../sleepnet'

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
const N_EPOCHS = 1800

/** Deterministic ramp identical to the reference generator: x[i] = ((i % 97) - 48) / 50. */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = ((i % 97) - 48) / 50
  return a
}

function readF32(name: string): Float32Array {
  const buf = fs.readFileSync(path.join(FIX, name))
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

describe('SleepNet ONNX inference (onnxruntime-node)', () => {
  it('matches the TorchScript reference on the deterministic ramp input', async () => {
    const highRes = ramp(HIGH_RES_LEN * HIGH_RES_CH)
    const lowRes = ramp(N_EPOCHS)

    const result = await runSleepNet(highRes, lowRes)
    // Proves onnxruntime-node loads + runs the vendored ONNX in this runtime (incl. CI).
    expect(result, 'runSleepNet returned null — onnxruntime-node failed to load/run').not.toBeNull()

    // Expected codes/apnea derived from the original TorchScript output (argmax+1, sigmoid>0.61).
    const refStaging = readF32('moonstone_ramp_staging.bin') // [1,4,1800] -> c*1800 + t
    const refApnea = readF32('moonstone_ramp_apnea.bin') // [1,1,1800]
    const thr = Math.log(APNEA_THRESHOLD / (1 - APNEA_THRESHOLD))

    let stageMismatch = 0
    let apneaMismatch = 0
    for (let t = 0; t < N_EPOCHS; t++) {
      let best = 0
      let bestVal = refStaging[t]
      for (let c = 1; c < 4; c++) {
        const v = refStaging[c * N_EPOCHS + t]
        if (v > bestVal) {
          bestVal = v
          best = c
        }
      }
      if (result!.stageCodes[t] !== best + 1) stageMismatch++
      if (result!.apnea[t] !== refApnea[t] > thr) apneaMismatch++
    }

    // ONNX vs TorchScript differ by ~5e-6, so argmax can only flip on a near-exact tie (none here).
    expect(stageMismatch, `${stageMismatch}/1800 stage codes differ from TorchScript`).toBe(0)
    expect(apneaMismatch, `${apneaMismatch}/1800 apnea flags differ from TorchScript`).toBe(0)
  })

  it('returns null on bad input shape (infallible contract)', async () => {
    expect(await runSleepNet(new Float32Array(10), new Float32Array(1800))).toBeNull()
  })
})
