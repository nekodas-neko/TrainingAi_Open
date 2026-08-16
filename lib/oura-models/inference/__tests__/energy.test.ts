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

import { runEnergyExpenditure } from '../energy'

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
function readF32(name: string): Float32Array {
  const buf = fs.readFileSync(path.join(FIX, name))
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

describe('energy expenditure ONNX inference (onnxruntime-node)', () => {
  it('HR head matches the TorchScript reference', async () => {
    const feats = readF32('energy_expenditure_1_0_0_hr_features.bin')
    const ref = readF32('energy_expenditure_1_0_0_hr_output.bin')[0]
    const kcal = await runEnergyExpenditure(feats)
    expect(kcal, 'runEnergyExpenditure returned null').not.toBeNull()
    expect(Math.abs(kcal! - ref), `got ${kcal} vs ref ${ref}`).toBeLessThan(1e-3)
  })

  it('no-HR head matches the TorchScript reference', async () => {
    const feats = readF32('energy_expenditure_1_0_0_no_hr_features.bin')
    const ref = readF32('energy_expenditure_1_0_0_no_hr_output.bin')[0]
    const kcal = await runEnergyExpenditure(feats)
    expect(kcal).not.toBeNull()
    expect(Math.abs(kcal! - ref)).toBeLessThan(1e-3)
  })

  it('returns null on an unrecognised feature length', async () => {
    expect(await runEnergyExpenditure(new Float32Array(7))).toBeNull()
  })
})
