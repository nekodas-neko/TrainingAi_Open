import { describe, it, expect } from 'vitest'
import { plateBreakdown } from '@/components/workout/utils'

describe('plateBreakdown', () => {
  it('breaks a simple load into one plate per side', () => {
    expect(plateBreakdown(60)).toEqual({ perSide: [20], achievableKg: 60, exact: true })
  })

  it('combines plates greedily, heaviest first', () => {
    expect(plateBreakdown(100)).toEqual({ perSide: [25, 15], achievableKg: 100, exact: true })
    expect(plateBreakdown(102.5)).toEqual({ perSide: [25, 15, 1.25], achievableKg: 102.5, exact: true })
    expect(plateBreakdown(67.5)).toEqual({ perSide: [20, 2.5, 1.25], achievableKg: 67.5, exact: true })
  })

  it('returns an empty bar for exactly the bar weight', () => {
    expect(plateBreakdown(20)).toEqual({ perSide: [], achievableKg: 20, exact: true })
  })

  it('returns null below the bar weight', () => {
    expect(plateBreakdown(15)).toBeNull()
  })

  it('reports the closest achievable load when the per-side value is not reachable', () => {
    // 61.25 kg → 20.625 kg per side; best is a single 20 → 60 kg total
    expect(plateBreakdown(61.25)).toEqual({ perSide: [20], achievableKg: 60, exact: false })
  })

  it('caps at one pair of each plate size', () => {
    // (177.5 − 20) / 2 = 78.75 = every plate once
    expect(plateBreakdown(177.5)).toEqual({ perSide: [25, 20, 15, 10, 5, 2.5, 1.25], achievableKg: 177.5, exact: true })
    // beyond the rack: all plates on, flagged inexact
    expect(plateBreakdown(197.5)).toEqual({ perSide: [25, 20, 15, 10, 5, 2.5, 1.25], achievableKg: 177.5, exact: false })
  })
})
