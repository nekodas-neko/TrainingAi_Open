import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. Everything around the model still
// executes for real, which is the part that can regress.
vi.mock('../session', async importOriginal => {
  const actual = await importOriginal<typeof import('../session')>()
  const { makeReplayGetSession } = await import('./helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { runDhrvImputation } from '../dhrv'
import { nodeModelRuntime } from '@/lib/oura-models/inference/runtime-node'

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
function readF32(name: string): Float32Array {
  const buf = fs.readFileSync(path.join(FIX, name))
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

describe('dhrv imputation ONNX inference (onnxruntime-node)', () => {
  it('matches the TorchScript reference on the golden input', async () => {
    const feats = readF32('dhrv_imputation_1_1_0_features.bin')
    const ref = readF32('dhrv_imputation_1_1_0_dhrv.bin')[0]
    const v = await runDhrvImputation(feats, nodeModelRuntime)
    expect(v, 'runDhrvImputation returned null').not.toBeNull()
    expect(Math.abs(v! - ref), `got ${v} vs ref ${ref}`).toBeLessThan(1e-3)
  })

  it('returns null on bad feature length', async () => {
    expect(await runDhrvImputation(new Float32Array(5), nodeModelRuntime)).toBeNull()
  })
})
