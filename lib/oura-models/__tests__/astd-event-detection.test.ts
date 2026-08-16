import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runAstdEventDetection,
  type AstdEventDetectionInput,
} from '@/lib/oura-models/astd-event-detection'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// Pinned to the vendor's own thresholds, so they need the vendor's own constants. The two blocks
// below that are NOT guarded pass against the synthetic fixtures as well — an all-empty golden and
// an input rejected before any threshold is consulted — and guarding them would give up CI coverage
// for nothing.
const itVendor = it.skipIf(!hasRealConstants())

const fxDir = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
const golden = JSON.parse(
  fs.readFileSync(path.join(fxDir, 'astd_event_detection_0_1_0.golden.json'), 'utf8'),
)
const scenarios = JSON.parse(
  fs.readFileSync(path.join(fxDir, 'astd_event_detection_0_1_0.scenarios.json'), 'utf8'),
)
const num = (v: number | null): number => (v === null ? NaN : v)
const flat = (obj: Record<string, { flat: (number | null)[] }>, k: string): number[] =>
  obj[k].flat.map(num)

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-3
}

// Assert a run matches the 8-output tuple (out_0..out_7) captured from the .pt.
function expectMatches(input: AstdEventDetectionInput, outputs: number[][], label: string): void {
  const r = runAstdEventDetection(input)
  const got = [
    [r.nStressed],
    [r.nRestored],
    [r.totalStressedMin],
    [r.totalRestoredMin],
    r.eventTypeIds,
    r.eventStartMs,
    r.eventEndMs,
    r.durationsMin,
  ]
  for (let i = 0; i < 8; i++) {
    expect(got[i].length, `${label} out_${i} length`).toBe(outputs[i].length)
    for (let j = 0; j < outputs[i].length; j++) {
      expect(close(got[i][j], outputs[i][j]), `${label} out_${i}[${j}]: got ${got[i][j]}, exp ${outputs[i][j]}`).toBe(true)
    }
  }
}

describe('astd-event-detection parity vs TorchScript golden', () => {
  it('matches the golden (zero-events case)', () => {
    const input: AstdEventDetectionInput = {
      dsaValues: flat(golden, 'in_0'),
      dsaTimestampsMs: flat(golden, 'in_1'),
    }
    const expected = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => flat(golden, `out_${i}`))
    expectMatches(input, expected, 'golden')
  })

  itVendor('matches synthetic event vectors captured from the .pt (collect / sort / merge / durations)', () => {
    for (const [name, s] of Object.entries(scenarios) as [
      string,
      { values: (number | null)[]; timestamps: number[]; outputs: number[][] },
    ][]) {
      expectMatches(
        { dsaValues: s.values.map(num), dsaTimestampsMs: s.timestamps },
        s.outputs,
        name,
      )
    }
  })

  itVendor('detects a stressed then restored event with correct counts and minutes', () => {
    const s = scenarios['stressed_and_restored'] as {
      values: (number | null)[]
      timestamps: number[]
      outputs: number[][]
    }
    const r = runAstdEventDetection({ dsaValues: s.values.map(num), dsaTimestampsMs: s.timestamps })
    expect(r.nStressed).toBe(1)
    expect(r.nRestored).toBe(1)
    expect(r.eventTypeIds).toEqual([-1, 1])
    expect(r.totalStressedMin).toBeGreaterThan(0)
    expect(r.totalRestoredMin).toBeGreaterThan(0)
  })

  it('returns the empty/zero result on invalid input (fewer than min_n_bins)', () => {
    const r = runAstdEventDetection({ dsaValues: [0.6, 0.6], dsaTimestampsMs: [0, 900000] })
    expect(r.nStressed).toBe(0)
    expect(r.eventTypeIds).toEqual([])
    expect(r.durationsMin).toEqual([])
  })
})
