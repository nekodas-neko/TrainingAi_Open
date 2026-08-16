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

import { runAwhrImputation, AWHR_FEATURES } from '@/lib/oura-models/inference/awhr'

const fx = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'awhr_imputation_1_2_0.golden.json'), 'utf8'))

// input golden shape is [batch=1, seqLen, AWHR_FEATURES]; reshape the flat buffer to seqLen rows.
function inputRows(): number[][] {
  const { shape, flat } = fx.input as { shape: number[]; flat: number[] }
  const [, seqLen, feat] = shape
  const rows: number[][] = []
  for (let i = 0; i < seqLen; i++) rows.push(flat.slice(i * feat, i * feat + feat))
  return rows
}

describe('awhr imputation ONNX inference (onnxruntime-node)', () => {
  it('matches the TorchScript reference on the golden input within 1e-3', async () => {
    expect(fx.input.shape[2]).toBe(AWHR_FEATURES)
    const out = await runAwhrImputation(inputRows())
    expect(out, 'onnxruntime-node core must load').not.toBeNull()
    const ref = fx.output.flat as number[]
    expect(out!.length).toBe(ref.length)
    for (let i = 0; i < ref.length; i++) {
      const a = out![i]
      const b = ref[i]
      if (Number.isNaN(b)) expect(Number.isNaN(a), `step[${i}] expected NaN`).toBe(true)
      else expect(Math.abs(a - b), `step[${i}] got ${a} vs ref ${b}`).toBeLessThan(1e-3)
    }
  })

  it('returns null on empty or malformed input', async () => {
    expect(await runAwhrImputation([])).toBeNull()
    expect(await runAwhrImputation([new Array(AWHR_FEATURES - 1).fill(0)])).toBeNull()
  })
})
