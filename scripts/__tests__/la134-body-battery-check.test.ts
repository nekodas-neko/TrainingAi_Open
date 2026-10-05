// LA-134. The Body Battery's pass test, as a function of stored rows, so re-checking the provisional
// constants is one command and its verdict cannot overstate how much data it rests on.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { summarise } = require('../tuning/body-battery-replay.cjs') as {
  summarise: (rows: Record<string, unknown>[], prefix: string) => {
    days: number; informativeDays: number; medianNet: number | null; daysAtZero: number
    passes: { medianNet: boolean; zeroShare: boolean }; sufficient: boolean
  }
}

const V6 = 'v6:rest0.05:chg0.12:drn0.08:str0.02:hrmax-observed:oura-rule'
const V5 = 'v5:rest0.05:chg0.2:drn0.6:str0.2:hrmax-observed:oura-rule'
const row = (end: number, chg: number, drn: number, n: number, v = V6) =>
  ({ end_value: end, total_charged: chg, total_drained: drn, hr_sample_count: n, model_version: v })

describe('summarise (LA-134)', () => {
  it('judges only the requested model version, so v5 rows cannot pollute a v6 verdict', () => {
    const s = summarise([row(0, 1, 60, 2000, V5), row(0, 1, 60, 2000, V5), row(40, 2, 7, 2000)], 'v6')
    expect(s.days).toBe(1)
    expect(s.daysAtZero).toBe(0)
  })

  it('counts the owner\'s first twelve v6 days as passing but INSUFFICIENT', () => {
    // The stored rows read on 2026-10-05: none at zero, median net about -2.5, five informative days.
    const rows = [
      row(34, 2, 7, 2901), row(43, 1, 7, 2307), row(46, 2, 10, 2378), row(42, 3, 4, 99), row(43, 0, 2, 2955),
      row(36, 0, 3, 2597), row(49, 2, 3, 85), row(30, 1, 8, 241), row(42, 0, 0, 0), row(38, 0, 0, 50),
      row(31, 0, 0, 0), row(41, 0, 7, 98),
    ]
    const s = summarise(rows, 'v6')
    expect(s).toMatchObject({ days: 12, informativeDays: 5, daysAtZero: 0 })
    expect(s.medianNet).toBeCloseTo(-2.5, 1)
    expect(s.passes).toEqual({ medianNet: true, zeroShare: true })
    expect(s.sufficient).toBe(false)
  })

  it('fails a window that mostly ends at zero, and one whose median net is far from zero', () => {
    const atZero = Array.from({ length: 10 }, (_, i) => row(i < 4 ? 0 : 30, 1, 20, 2000))
    expect(summarise(atZero, 'v6').passes.zeroShare).toBe(false)
    expect(summarise(atZero, 'v6').passes.medianNet).toBe(false)
  })

  it('is sufficient once enough informative days exist', () => {
    const rows = Array.from({ length: 20 }, () => row(40, 2, 3, 1500))
    expect(summarise(rows, 'v6').sufficient).toBe(true)
  })

  it('says nothing for a version with no rows, rather than passing it', () => {
    const s = summarise([row(40, 2, 3, 1500)], 'v7')
    expect(s.days).toBe(0)
    expect(s.passes.zeroShare).toBe(false)
    expect(s.passes.medianNet).toBe(false)
  })
})
