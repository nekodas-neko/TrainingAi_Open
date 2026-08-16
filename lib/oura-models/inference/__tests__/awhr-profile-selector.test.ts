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

import { runAwhrProfileSelector } from '@/lib/oura-models/inference/awhr-profile-selector'

const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'lib',
      'oura-models',
      'onnx',
      '__fixtures__',
      'awhr_profile_selector_1_0_1.golden.json',
    ),
    'utf8',
  ),
)

const flat = (k: string): number[] => fx[k].flat
function reshape2d(k: string): number[][] {
  const { shape, flat: f } = fx[k]
  const [rows, cols] = shape
  const out: number[][] = []
  for (let r = 0; r < rows; r++) out.push(f.slice(r * cols, r * cols + cols))
  return out
}

describe('awhr-profile-selector end-to-end parity vs TorchScript golden', () => {
  it('matches the main activity + resampled activity series within 1e-3', async () => {
    const out = await runAwhrProfileSelector({
      stepmotionTimestamps: flat('in_0'),
      stepmotionData: reshape2d('in_1'),
      motionTimestamps: flat('in_2'),
      motionData: reshape2d('in_3'),
      outputSamplingIntervalMs: flat('in_4')[0],
    })
    expect(out, 'onnxruntime-node core must load').not.toBeNull()
    const r = out!

    // out_0 () — main activity ecore id.
    expect(Math.abs(r.mainActivityEcoreId - flat('out_0')[0])).toBeLessThan(1e-3)

    // out_1 (7,) — resampled block timestamps.
    const expTs = flat('out_1')
    expect(r.timestamps.length).toBe(expTs.length)
    for (let i = 0; i < expTs.length; i++) expect(r.timestamps[i], `timestamp[${i}]`).toBe(expTs[i])

    // out_2 (7, 1) — per-block activity ecore ids.
    const expIds = reshape2d('out_2') // [7][1]
    expect(r.activityEcoreIds.length).toBe(expIds.length)
    for (let i = 0; i < expIds.length; i++) {
      expect(Math.abs(r.activityEcoreIds[i] - expIds[i][0]), `activityEcoreId[${i}]`).toBeLessThan(1e-3)
    }
  })

  it('returns a main activity that is one of the mapped ecore ids', async () => {
    const out = await runAwhrProfileSelector({
      stepmotionTimestamps: flat('in_0'),
      stepmotionData: reshape2d('in_1'),
      motionTimestamps: flat('in_2'),
      motionData: reshape2d('in_3'),
      outputSamplingIntervalMs: null, // no-resample path → per-timestep grid
    })
    expect(out).not.toBeNull()
    const r = out!
    expect([14, 5, 12]).toContain(r.mainActivityEcoreId)
    // Without resampling, one activity id per input timestep.
    expect(r.timestamps.length).toBe(256)
    expect(r.activityEcoreIds.length).toBe(256)
  })
})
