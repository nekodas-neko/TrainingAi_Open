/**
 * WASM-vs-native ONNX parity (Task 0 gate for the on-device rollup).
 *
 * The on-device rollup (Oura raw-on-device architecture, decision D1) runs the neural models in the
 * WebView via onnxruntime-web instead of the server-only onnxruntime-node addon. This test proves the
 * WASM runtime reproduces the models' behaviour for the two the rollup depends on — SleepNet (staging +
 * apnea) and dHRV imputation.
 *
 * It anchors WASM to GROUND TRUTH, not just to the node runtime: it feeds the same deterministic golden
 * inputs the models were validated against (the `ramp()` used by `inference/__tests__/sleepnet.test.ts`,
 * and the captured `__fixtures__/*.bin` feature vectors) and asserts the WASM output against the captured
 * TorchScript reference outputs (`moonstone_ramp_staging.bin`, `moonstone_ramp_apnea.bin`,
 * `dhrv_imputation_1_1_0_dhrv.bin`). It also cross-checks WASM against node. So the chain is
 * web ≈ TorchScript AND web ≈ node on the SAME realistic input — a random-noise input can pass while real
 * inference diverges, so it is deliberately NOT used here.
 *
 * Pass bar: SleepNet per-epoch stage argmax + apnea flags match the TorchScript reference EXACTLY (a
 * shifted stage boundary is a visible regression); dHRV within a tight abs tolerance. If this fails after
 * a model/runtime bump, re-validate the on-device neural half before shipping — do not relax the bar.
 *
 * NOTE (device gap, tracked in the plan): this runs onnxruntime-web under Node's WASM backend. The S25
 * WebView may negotiate different execution-provider options (SIMD/threads), which can change reduction
 * order and rounding — so a one-time on-device parity run against these same fixtures is still required
 * (Task 0/6). CI-green here is necessary, not sufficient.
 *
 * SKIPPED WHEN THE MODEL FILES ARE ABSENT, and this is the one real coverage loss in Q-49 Phase A2.
 * Every other model test replays a recording of its model (`inference/__tests__/helpers/replay-session.ts`)
 * because what those tests protect is our own code around a frozen binary. This one is different: it
 * compares *two runtimes* over the same bytes, so replaying either side would assert a recording against
 * itself and prove nothing. It needs the real `.onnx`. Once the models live only in the bucket, this runs
 * where they are available — a machine with the tree copies, or a deliberate fetch — and not in CI. Do not
 * "fix" it by replaying; deleting the check is more honest than a check that cannot fail.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as ortNode from 'onnxruntime-node'
import * as ortWeb from 'onnxruntime-web'

const ONNX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx')

/** The two models this file loads directly. Both must be on disk for any of it to mean anything. */
const MODELS_PRESENT = ['sleepnet_moonstone_1_2_0_core.onnx', 'dhrv_imputation_1_1_0.onnx']
  .every(f => fs.existsSync(path.join(ONNX, f)))
const FX = path.join(ONNX, '__fixtures__')

function readF32(name: string): Float32Array {
  const buf = fs.readFileSync(path.join(FX, name))
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/** Deterministic ramp identical to the reference generator (sleepnet.test.ts): x[i]=((i%97)-48)/50. */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = ((i % 97) - 48) / 50
  return a
}

const maxAbs = (a: Float32Array, b: Float32Array): number => {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

const HIGH_RES_LEN = 115200, HIGH_RES_CH = 3, N_EPOCHS = 1800, N_CLASSES = 4
const APNEA_THRESHOLD = 0.61
const argmax = (s: Float32Array, t: number): number => {
  let best = 0, bestVal = s[t]
  for (let c = 1; c < N_CLASSES; c++) {
    const v = s[c * N_EPOCHS + t]
    if (v > bestVal) { bestVal = v; best = c }
  }
  return best
}

describe.skipIf(!MODELS_PRESENT)('onnxruntime-web (WASM) parity — anchored to the TorchScript golden, not just to node', () => {
  it('SleepNet: WASM stage codes + apnea match the TorchScript reference exactly (and node)', async () => {
    const highRes = ramp(HIGH_RES_LEN * HIGH_RES_CH)
    const lowRes = ramp(N_EPOCHS)
    const buf = fs.readFileSync(path.join(ONNX, 'sleepnet_moonstone_1_2_0_core.onnx'))
    const nSess = await ortNode.InferenceSession.create(buf)
    const wSess = await ortWeb.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'] })
    const feeds = (ort: typeof ortNode | typeof ortWeb) => ({
      high_res: new ort.Tensor('float32', highRes, [1, HIGH_RES_LEN, HIGH_RES_CH]),
      low_res: new ort.Tensor('float32', lowRes, [1, N_EPOCHS, 1]),
    })
    const nOut = await nSess.run(feeds(ortNode) as never)
    const wOut = await wSess.run(feeds(ortWeb) as never)
    const sW = wOut.staging_logits.data as Float32Array
    const aW = wOut.apnea_logits.data as Float32Array
    const sN = nOut.staging_logits.data as Float32Array

    // Ground truth: captured TorchScript output (argmax+1 staging, sigmoid>0.61 apnea).
    const refStaging = readF32('moonstone_ramp_staging.bin') // [1,4,1800]
    const refApnea = readF32('moonstone_ramp_apnea.bin')     // [1,1,1800]
    const thr = Math.log(APNEA_THRESHOLD / (1 - APNEA_THRESHOLD))

    let stageVsRef = 0, apneaVsRef = 0, stageVsNode = 0
    for (let t = 0; t < N_EPOCHS; t++) {
      const wStage = argmax(sW, t)
      if (wStage !== argmax(refStaging, t)) stageVsRef++
      if (wStage !== argmax(sN, t)) stageVsNode++
      if ((aW[t] > thr) !== (refApnea[t] > thr)) apneaVsRef++
    }
    expect(stageVsRef, 'WASM SleepNet stages must match the TorchScript golden exactly').toBe(0)
    expect(apneaVsRef, 'WASM SleepNet apnea flags must match the TorchScript golden exactly').toBe(0)
    expect(stageVsNode, 'WASM SleepNet stages must also match onnxruntime-node').toBe(0)
  }, 120_000)

  it('dHRV: WASM output matches the captured golden output (and node) within 1e-4', async () => {
    const feat = readF32('dhrv_imputation_1_1_0_features.bin') // 10 golden features
    const ref = readF32('dhrv_imputation_1_1_0_dhrv.bin')      // captured reference output
    const buf = fs.readFileSync(path.join(ONNX, 'dhrv_imputation_1_1_0.onnx'))
    const nSess = await ortNode.InferenceSession.create(buf)
    const wSess = await ortWeb.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'] })
    const nOut = await nSess.run({ features: new ortNode.Tensor('float32', feat, [1, 10]) })
    const wOut = await wSess.run({ features: new ortWeb.Tensor('float32', feat, [1, 10]) })
    const w = wOut.dhrv.data as Float32Array
    expect(maxAbs(w, ref), 'WASM dHRV must match the captured golden output').toBeLessThan(1e-4)
    expect(maxAbs(w, nOut.dhrv.data as Float32Array), 'WASM dHRV must also match onnxruntime-node').toBeLessThan(1e-4)
  }, 60_000)
})
