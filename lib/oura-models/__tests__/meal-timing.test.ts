import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runMealTiming } from '@/lib/oura-models/meal-timing'

const fx = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'meal_timing_0_1_0.golden.json'), 'utf8'))
const flat = (k: string): number[] => fx[k].flat

describe('meal-timing parity vs TorchScript golden', () => {
  it('matches the clusters + consistency outputs within 1e-3', () => {
    const out = runMealTiming(flat('in_0'), flat('in_1'))
    // out_0 shape [nClusters, 2] flattened; out_1 shape [1,1] consistency.
    const expectedClusters = fx.out_0.flat
    const gotClusters = out.clusters.flat()
    expect(gotClusters.length).toBe(expectedClusters.length)
    for (let i = 0; i < expectedClusters.length; i++) {
      expect(Math.abs(gotClusters[i] - expectedClusters[i]), `cluster[${i}]: ${gotClusters[i]} vs ${expectedClusters[i]}`).toBeLessThan(1e-3)
    }
    const expConsistency = fx.out_1.flat[0]
    if (expConsistency == null || Number.isNaN(expConsistency)) expect(Number.isNaN(out.consistency)).toBe(true)
    else expect(Math.abs(out.consistency - expConsistency)).toBeLessThan(1e-3)
  })

  it('returns no clusters + NaN consistency for empty / mismatched input', () => {
    expect(runMealTiming([], [])).toEqual({ clusters: [], consistency: NaN })
    expect(runMealTiming([1, 2, 3], [1, 2]).clusters).toEqual([])
  })
})
