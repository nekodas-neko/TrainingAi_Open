import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runStepsMotionDecoder,
  setStepsDecoderConstants,
  __clearStepsDecoderConstants,
  type StepsMotionDecoderInput,
} from '@/lib/oura-models/steps-motion-decoder'
import { getStepsDecoderConstants } from '@/lib/oura-models/constants'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// The decoder takes its dequantisation table by injection (Q-221) — holding it at module scope meant
// a static JSON import, which webpack compiled into unauthenticated `_next/static` chunks. This is a
// server-side test, so it injects from disk exactly as the rollup does.
beforeAll(() => {
  setStepsDecoderConstants(getStepsDecoderConstants())
})

const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'lib',
      'oura-models',
      'onnx',
      '__fixtures__',
      'steps_motion_decoder_2_0_0.golden.json',
    ),
    'utf8',
  ),
)
const num = (v: number | null): number => (v === null ? NaN : v)
const flat = (k: string): number[] => (fx[k].flat as (number | null)[]).map(num)
const shape = (k: string): number[] => fx[k].shape

function reshape(arr: number[], cols: number): number[][] {
  const rows: number[][] = []
  for (let i = 0; i < arr.length; i += cols) rows.push(arr.slice(i, i + cols))
  return rows
}

function inputFromGolden(): StepsMotionDecoderInput {
  const [, cols] = shape('in_1') // [256, 27]
  return {
    timestamps: flat('in_0'),
    data: reshape(flat('in_1'), cols),
  }
}

describe('steps-motion-decoder parity vs TorchScript golden', () => {
  it.skipIf(!hasRealConstants())('matches both outputs bit-exactly (< 1e-3)', () => {
    const out = runStepsMotionDecoder(inputFromGolden())

    const expTs = flat('out_0') // [768]
    expect(out.timestamps.length).toBe(expTs.length)
    for (let i = 0; i < expTs.length; i++) {
      expect(out.timestamps[i], `timestamp[${i}]`).toBe(expTs[i])
    }

    const [, dcols] = shape('out_1') // [768, 11]
    const expData = reshape(flat('out_1'), dcols)
    expect(out.data.length).toBe(expData.length)
    for (let r = 0; r < expData.length; r++) {
      for (let c = 0; c < dcols; c++) {
        expect(
          Math.abs(out.data[r][c] - expData[r][c]),
          `data[${r}][${c}]: got ${out.data[r][c]}, expected ${expData[r][c]}`,
        ).toBeLessThan(1e-3)
      }
    }
  })

  it('expands N frames into 3N sub-rows with descending interpolated timestamps', () => {
    const out = runStepsMotionDecoder(inputFromGolden())
    const n = inputFromGolden().timestamps.length
    expect(out.timestamps.length).toBe(3 * n)
    expect(out.data.length).toBe(3 * n)
    // Within a frame, the three sub-row timestamps strictly increase to the frame timestamp.
    expect(out.timestamps[0]).toBeLessThan(out.timestamps[1])
    expect(out.timestamps[1]).toBeLessThan(out.timestamps[2])
  })

  it('encode_zero column restores exact zeros (stride_frequency, col 4)', () => {
    // A frame whose stride_frequency_1 code is 0 must decode that output column back to 0.
    const i = inputFromGolden()
    i.data[0] = i.data[0].slice()
    i.data[0][4] = 0 // stride_frequency_1 quantized code 0 → "no value"
    const out = runStepsMotionDecoder(i)
    expect(out.data[0][4]).toBe(0) // sub-row 0 carries the _1 group's stride_frequency
  })
})

describe('steps-motion-decoder without its constants', () => {
  // Refusing is the point. With no table every output is a physical quantity derived from absent
  // bounds — plausible, wrong, and fed straight into step counts and activity auto-detection. A
  // caller that cannot supply the table has to do nothing rather than guess.
  it('throws rather than decoding on absent constants', () => {
    __clearStepsDecoderConstants()
    try {
      expect(() => runStepsMotionDecoder({ timestamps: [0], data: [new Array(27).fill(0)] }))
        .toThrow(/constants not set/)
    } finally {
      setStepsDecoderConstants(getStepsDecoderConstants())
    }
  })
})
