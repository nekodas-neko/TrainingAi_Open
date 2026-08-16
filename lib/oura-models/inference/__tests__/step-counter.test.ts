import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. Everything around the model still
// executes for real, which is the part that can regress.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { runStepCounter } from '@/lib/oura-models/inference/step-counter'

const fx = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'step_counter_1_3_0.golden.json'), 'utf8'))

const flat = (k: string): number[] => fx[k].flat
function reshape2d(k: string): number[][] {
  const { shape, flat: f } = fx[k]
  const [rows, cols] = shape
  const out: number[][] = []
  for (let r = 0; r < rows; r++) out.push(f.slice(r * cols, r * cols + cols))
  return out
}

describe('step-counter end-to-end parity vs TorchScript golden', () => {
  it('matches the resampled window timestamps + steps within 1e-3', async () => {
    const out = await runStepCounter({
      stepmotionTimestamps: flat('in_0'),
      stepmotionData: reshape2d('in_1'),
      motionTimestamps: flat('in_2'),
      motionData: reshape2d('in_3'),
      outputSamplingIntervalMs: flat('in_4')[0],
    })
    expect(out, 'onnxruntime-node core must load').not.toBeNull()
    const windows = out!
    const expTs = reshape2d('out_0')   // [n, 2] = [start, end]
    const expSteps = flat('out_1')     // [n] steps
    expect(windows.length).toBe(expTs.length)
    for (let i = 0; i < expTs.length; i++) {
      expect(windows[i].startMs, `window[${i}].start`).toBe(expTs[i][0])
      expect(windows[i].endMs, `window[${i}].end`).toBe(expTs[i][1])
      expect(Math.abs(windows[i].steps - expSteps[i]), `window[${i}].steps`).toBeLessThan(1e-3)
    }
  })
})
