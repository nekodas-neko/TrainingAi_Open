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

import { runIllnessDetection } from '../illness'

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
function readF32(name: string): Float32Array {
  const buf = fs.readFileSync(path.join(FIX, name))
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

describe('illness detection ONNX inference (onnxruntime-node)', () => {
  it('matches the TorchScript reference on the golden input', async () => {
    const scalars = readF32('illness_scalars.bin')
    const timeSeries = readF32('illness_time_series.bin')
    const ref = readF32('illness_illness_prob.bin')[0]
    const prob = await runIllnessDetection(scalars, timeSeries)
    expect(prob, 'runIllnessDetection returned null').not.toBeNull()
    expect(Math.abs(prob! - ref), `got ${prob} vs ref ${ref}`).toBeLessThan(1e-3)
  })

  it('returns null on bad input shape (infallible contract)', async () => {
    expect(await runIllnessDetection(new Float32Array(2), new Float32Array(240))).toBeNull()
  })
})
