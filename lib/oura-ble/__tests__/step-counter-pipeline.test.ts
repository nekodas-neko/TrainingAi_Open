import { describe, it, expect, vi } from 'vitest'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. The code under test here is ours
// and still runs for real.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { bytesToHex } from '@/lib/oura-ble/decode'
import { runStepCounterPipeline, type RawFrame } from '@/lib/oura-ble/step-counter-pipeline'
import { measuredAtMs } from '@/lib/oura-ble/decode'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// The step count itself comes out of the vendor's dequantization table, so both the absolute
// figure and the non-zero regression guard need the real one. The Tier-1 cross-check and the
// no-windows case assert wiring, and hold either way.
const itVendor = it.skipIf(!hasRealConstants())

const toMs = (ds: number) => measuredAtMs(ds, 0, 1_700_000_000_000)

// A 14-byte body with a fixed fill; callers tweak individual bytes to steer the unpacked columns.
function body(fill: number, tweaks: Record<number, number> = {}): Uint8Array {
  const b = new Uint8Array(14).fill(fill)
  for (const [i, v] of Object.entries(tweaks)) b[Number(i)] = v
  return b
}

// Build the day's 0x7e/0x7f frames for `n` windows spaced ~30 s (300 ds) apart. feature_2 sits at
// ds+1. `walking` drives unpack27 column 14 (p1[11] & 0x7f) below the walk-gate threshold (20).
function stepFrames(n: number, walking: boolean): RawFrame[] {
  const frames: RawFrame[] = []
  for (let i = 0; i < n; i++) {
    const ds = 1000 + i * 300
    const p1 = body(0x10, { 11: walking ? 0x05 : 0x40 }) // col14 = p1[11] & 0x7f
    const p2 = body(0x20, { 13: 0x00 })
    frames.push({ ringTimestampDs: ds, tag: 0x7e, bodyHex: bytesToHex(p1) })
    frames.push({ ringTimestampDs: ds + 1, tag: 0x7f, bodyHex: bytesToHex(p2) })
  }
  return frames
}

describe('step-counter real-data pipeline wiring', () => {
  itVendor('pairs → dequantizes → runs step_counter over synthetic frames', async () => {
    const r = await runStepCounterPipeline(stepFrames(8, true), [], toMs)
    expect(r).not.toBeNull()
    const res = r!
    expect(res.pairedWindows).toBe(8)
    // steps_motion_decoder expands each window into 3 sub-rows.
    expect(res.strideFrequencyHz.length).toBe(8 * 3)
    // Every decoded stride-frequency is finite and within the decoder's [low, high] bound (0.68–3.4).
    for (const hz of res.strideFrequencyHz) {
      expect(Number.isFinite(hz)).toBe(true)
      expect(hz).toBeGreaterThanOrEqual(0)
      expect(hz).toBeLessThanOrEqual(3.4)
    }
    // step_counter (ONNX) must load and produce windows; total is a finite number.
    expect(res.stepWindows.length).toBeGreaterThan(0)
    expect(Number.isFinite(res.totalSteps)).toBe(true)
  })

  it('cross-checks against the Tier-1 walk-gate estimate', async () => {
    const walking = await runStepCounterPipeline(stepFrames(10, true), [], toMs)
    const still = await runStepCounterPipeline(stepFrames(10, false), [], toMs)
    // Walking windows (col14 ≤ 20) credit the gate estimate; still windows do not.
    expect(walking!.gateEstimateSteps).toBeGreaterThan(0)
    expect(still!.gateEstimateSteps).toBe(0)
  })

  it('returns null when there are no paired step windows', async () => {
    // Only feature_1 frames, no matching feature_2 → nothing pairs.
    const onlyF1: RawFrame[] = [{ ringTimestampDs: 1000, tag: 0x7e, bodyHex: bytesToHex(body(0x10)) }]
    expect(await runStepCounterPipeline(onlyF1, [], toMs)).toBeNull()
  })

  // Real captured walk frames (owner's counted 200-step walk, 2026-07-10), tiled into a continuous
  // walk so the step_counter eligibility NN has enough continuous cadence to fire.
  const WALK_200: [string, string][] = [
    ['ca61b3816965000baa5058893850', '764794519381194a0339ca993bd3'],
    ['ab646b136d510b578f83608d665f', '133472f73c17412b705f9e5b7207'],
    ['90be4e1e3d006368c762da813a54', '010bbf6381854a762b2ccc8e49b8'],
    ['bd53c011294d0014bf55ad05484e', '010aad52ae895f2f031dbe7a5f9d'],
    ['bf52d20119660008bc5ea8853e7a', '0210b555850156610118c07058cf'],
    ['c263c7011c7a020abe537d855b71', '061bb25f96824733153dcb8c432f'],
    ['ba64ab823b85020eba62ca8a2d6b', '0111ab2c5622277e378dc98f3cb1'],
  ]
  function continuousWalk(tiles: number): RawFrame[] {
    const out: RawFrame[] = []
    let ds = 100_000
    for (let t = 0; t < tiles; t++) {
      for (const [f1, f2] of WALK_200) {
        out.push({ ringTimestampDs: ds, tag: 0x7e, bodyHex: f1 })
        out.push({ ringTimestampDs: ds + 1, tag: 0x7f, bodyHex: f2 })
        ds += 300
      }
    }
    return out
  }

  itVendor('REGRESSION: a continuous real walk yields non-zero steps (guards the stepmotion column order)', async () => {
    // The decoder→step_counter stepmotion columns are in different orders; an identity pass-through
    // fed the model garbage and returned EXACTLY 0 on all walking (confirmed on-device 2026-07-22).
    // The golden fixture is random noise with all-zero expected output, so it structurally CANNOT
    // catch a column-order regression — only a real walk can. If this ever reads 0, the reorder in
    // step-counter-pipeline.ts (STEPMOTION_MODEL_ORDER) has regressed.
    const r = await runStepCounterPipeline(continuousWalk(40), [], toMs)
    expect(r).not.toBeNull()
    expect(r!.totalSteps).toBeGreaterThan(100)
    // The decoded cadence stays in the walking band regardless (it was always correct).
    const sorted = r!.strideFrequencyHz.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median).toBeGreaterThan(1.4)
    expect(median).toBeLessThan(3.4)
  })
})
