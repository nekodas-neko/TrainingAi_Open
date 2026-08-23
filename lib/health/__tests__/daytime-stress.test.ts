import { describe, it, expect, vi } from 'vitest'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { dhrvFeatures, buildDaytimeStressSeriesFromModel, daytimeStressLevel, type DhrvBaselines } from '../daytime-stress'
import { computeDaytimeStress, buildDaytimeStressSeries } from '../daytime-stress-inference'
import { nodeModelRuntime } from '@/lib/oura-models/inference/runtime-node'
import type { DaytimeHrvModel } from '@trainingai/shared/health/daytime-hrv-model'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// Guarded per block rather than per file: the null-input cases, the [−1,1] bound, the D5
// own-model sibling and the whole `summarizeStressDay` aggregation are independent of the
// vendor's scaling table, and stay in CI. What needs the real table is the dhrv magnitudes, the
// scaled-level values, and the calm-vs-stressed ordering the table decides.
const itVendor = it.skipIf(!hasRealConstants())

// Golden dhrv values captured from dhrv_imputation_1_1_0.pt forward() — validates the ported
// Preprocessor + scaling end-to-end through the ONNX MLP (which is itself golden-verified).
describe('computeDaytimeStress — pinned to the .pt forward', () => {
  const cases: { name: string; temp: number[]; met: number[]; hr: number[]; b: DhrvBaselines; dhrv: number }[] = [
    { name: 'rest', temp: Array(8).fill(33.5), met: Array(16).fill(1.05), hr: [58, 60, 62],
      b: { dhrvBaseline: 45, hrBaseline: 60, tempBaseline: 33.5 }, dhrv: 47.7429 },
    { name: 'mild-stress', temp: [33.8, 33.9, 33.7, 33.8, 34.0, 33.9, 33.8, 33.9],
      met: [1.2, 1.1, 1.3, 1.2, 1.1, 1.2, 1.3, 1.2, 1.1, 1.2, 1.3, 1.2, 1.1, 1.2, 1.3, 1.4], hr: [66, 70, 74],
      b: { dhrvBaseline: 48, hrBaseline: 62, tempBaseline: 33.6 }, dhrv: 44.9709 },
    { name: 'elevated', temp: Array(10).fill(34.2),
      met: [1.5, 1.4, 1.6, 1.5, 1.4, 1.5, 1.6, 1.5, 1.4, 1.5, 1.6, 1.5, 1.4, 1.5, 1.6, 1.7], hr: [78, 82, 88],
      b: { dhrvBaseline: 50, hrBaseline: 64, tempBaseline: 33.7 }, dhrv: 33.8211 },
    { name: 'single-hr', temp: [33.4, 33.5, 33.4], met: Array(10).fill(1.0), hr: [61],
      b: { dhrvBaseline: 44, hrBaseline: 60, tempBaseline: 33.5 }, dhrv: 31.7611 },
  ]

  itVendor.each(cases)('$name → dhrv ≈ $dhrv', async ({ temp, met, hr, b, dhrv }) => {
    const out = await computeDaytimeStress(temp, met, hr, b, nodeModelRuntime)
    expect(out).not.toBeNull()
    expect(out!.dhrv).toBeCloseTo(dhrv, 1)
    expect(out!.stress).toBeCloseTo(dhrv - b.dhrvBaseline, 1)
  })

  it('returns null on empty inputs or bad baselines', async () => {
    const b: DhrvBaselines = { dhrvBaseline: 45, hrBaseline: 60, tempBaseline: 33.5 }
    expect(await computeDaytimeStress([], [1], [60], b, nodeModelRuntime)).toBeNull()
    expect(await computeDaytimeStress([33.5], [1], [60], { ...b, dhrvBaseline: 0 }, nodeModelRuntime)).toBeNull()
  })
})

describe('daytimeStressLevel — Oura stress rule pinned to the .pt', () => {
  // (dhrv, dhrv_baseline, night_hrv_baseline) → scaled level [−1,1], from the .pt forward.
  const cases: [number, number, number, number][] = [
    [45, 45, 50, 0.0],
    [40, 45, 50, -0.2315],
    [55, 45, 50, 0.3676],
    [20, 45, 50, -0.9383],
    [40, 45, 35, -0.2841],
    [40, 45, 80, -0.1894],
    [70, 45, 50, 0.7794],
  ]
  itVendor.each(cases)('dhrv %i, base %i, nb %i → %f', (dhrv, base, nb, expected) => {
    expect(daytimeStressLevel(dhrv, base, nb)).toBeCloseTo(expected, 3)
  })
  it('is bounded to [−1, 1]', () => {
    expect(daytimeStressLevel(0, 45, 50)).toBeGreaterThanOrEqual(-1)
    expect(daytimeStressLevel(200, 45, 50)).toBeLessThanOrEqual(1)
  })
})

describe('buildDaytimeStressSeries', () => {
  const b: DhrvBaselines = { dhrvBaseline: 45, hrBaseline: 60, tempBaseline: 33.5 }
  const H = 3_600_000

  it('returns [] with no data', async () => {
    expect(await buildDaytimeStressSeries([], [], [], b, 0, H, nodeModelRuntime)).toEqual([])
    expect(await buildDaytimeStressSeries([{ tsMs: 0, valueC: 33.5 }], [], [], b, 0, H, nodeModelRuntime)).toEqual([])
  })

  itVendor('scores per bucket; relStress is dHRV vs the day median (calm > stressed)', async () => {
    // Two 30-min buckets: a calm one (low HR) then a stressed one (high HR + higher temp).
    const temp = [
      { tsMs: 5 * 60_000, valueC: 33.4 }, { tsMs: 20 * 60_000, valueC: 33.5 },
      { tsMs: 35 * 60_000, valueC: 34.1 }, { tsMs: 50 * 60_000, valueC: 34.2 },
    ]
    const met = Array.from({ length: 20 }, (_, i) => ({ tsMs: i * 3 * 60_000, value: 1.1 }))
    const hr = [
      { tsMs: 5 * 60_000, bpm: 56 }, { tsMs: 10 * 60_000, bpm: 58 }, { tsMs: 20 * 60_000, bpm: 60 },
      { tsMs: 35 * 60_000, bpm: 84 }, { tsMs: 45 * 60_000, bpm: 88 }, { tsMs: 50 * 60_000, bpm: 92 },
    ]
    const series = await buildDaytimeStressSeries(temp, met, hr, b, 0, H, nodeModelRuntime)
    expect(series.length).toBe(2)
    // calm bucket (first) has higher dHRV → above the day median → positive stressLevel (recovered);
    // stressed bucket → below median → negative.
    expect(series[0].dhrv).toBeGreaterThan(series[1].dhrv)
    expect(series[0].stressLevel).toBeGreaterThan(series[1].stressLevel)
    expect(series[0].stressLevel).toBeGreaterThan(0)
    expect(series[1].stressLevel).toBeLessThan(0)
    // bounded to [−1, 1]
    for (const p of series) expect(Math.abs(p.stressLevel)).toBeLessThanOrEqual(1)
  })
})

describe('buildDaytimeStressSeriesFromModel — D5 own-model sibling', () => {
  const b: DhrvBaselines = { dhrvBaseline: 45, hrBaseline: 60, tempBaseline: 33.5 }
  const model: DaytimeHrvModel = { intercept: 4.5, hrCoef: -0.02, tempCoef: 0, residualStd: 0.1, nSamples: 100 }
  const H = 3_600_000

  it('returns [] with no data', () => {
    expect(buildDaytimeStressSeriesFromModel([], [], [], model, b, 0, H)).toEqual([])
  })

  it('scores a resting bucket and skips an active (high-MET) one', () => {
    const temp = [{ tsMs: 5 * 60_000, valueC: 33.5 }, { tsMs: 35 * 60_000, valueC: 33.5 }]
    const met = [{ tsMs: 5 * 60_000, value: 1.1 }, { tsMs: 35 * 60_000, value: 3.0 }] // 2nd bucket active
    const hr = [{ tsMs: 5 * 60_000, bpm: 58 }, { tsMs: 35 * 60_000, bpm: 90 }]
    const series = buildDaytimeStressSeriesFromModel(temp, met, hr, model, b, 0, H)
    expect(series.length).toBe(1)
    expect(series[0].t).toBe(15 * 60_000) // first bucket's midpoint
  })

  it('skips a bucket missing any of hr/temp/met', () => {
    const temp = [{ tsMs: 5 * 60_000, valueC: 33.5 }]
    const met: { tsMs: number; value: number }[] = [] // no met data at all
    const hr = [{ tsMs: 5 * 60_000, bpm: 58 }]
    expect(buildDaytimeStressSeriesFromModel(temp, met, hr, model, b, 0, H)).toEqual([])
  })
})

describe('dhrvFeatures — Preprocessor assembly', () => {
  it('positional hr min/median/max + baseline ratios', () => {
    const b: DhrvBaselines = { dhrvBaseline: 45, hrBaseline: 60, tempBaseline: 33.5 }
    const f = dhrvFeatures([33.5, 33.5], [1.05, 1.05], [58, 60, 62], b)
    expect(f[0]).toBeCloseTo(60 / 60, 5) // hr_median = median/hrBaseline
    expect(f[1]).toBeCloseTo(58 / 60, 5) // hr_min
    expect(f[2]).toBeCloseTo(62 / 60, 5) // hr_max
    expect(f[8]).toBe(45) // dhrv_baseline raw
    expect(f[9]).toBe(60) // hr_baseline raw
  })
})

import { summarizeStressDay, STRESS_HIGH_LEVEL, STRESS_HIGH_DAY_THRESHOLD_MIN, type StressPoint } from '../daytime-stress'

describe('summarizeStressDay — day-level aggregation of the stress series', () => {
  const pt = (t: number, stressLevel: number): StressPoint => ({ t, dhrv: 40, stressLevel })

  it('returns null on an empty series (no signal → nothing persisted)', () => {
    expect(summarizeStressDay([])).toBeNull()
  })

  it('aggregates mean level and high/recovery minutes from 30-min buckets', () => {
    const series = [pt(0, -0.8), pt(1, -0.6), pt(2, 0.1), pt(3, 0.7)]
    const s = summarizeStressDay(series)
    expect(s).not.toBeNull()
    expect(s!.daytimeStressScaled).toBeCloseTo(-0.15, 2)
    expect(s!.stressHighMinutes).toBe(60)
    expect(s!.recoveryHighMinutes).toBe(30)
  })

  it('boundary buckets count (level exactly at the threshold is "high")', () => {
    const s = summarizeStressDay([pt(0, STRESS_HIGH_LEVEL)])
    expect(s!.stressHighMinutes).toBe(30)
  })

  it('respects a custom bucket size', () => {
    const s = summarizeStressDay([pt(0, -0.9)], 15 * 60_000)
    expect(s!.stressHighMinutes).toBe(15)
  })

  it('exports a sane deload-override day threshold', () => {
    expect(STRESS_HIGH_DAY_THRESHOLD_MIN).toBe(120)
  })
})
