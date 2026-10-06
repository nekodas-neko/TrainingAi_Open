import { describe, it, expect } from 'vitest'
import {
  updateBaseline, seedOrUpdateBaseline, baselineMean, baselineDeviation, baselineZ, DEV_WARMUP_NIGHTS,
  type Baseline,
} from '../personal-baseline'

describe('updateBaseline', () => {
  // Ported verbatim from open_oura's baseline.rs `warm_up_then_settle` test —
  // ground-truth against the pinned decompile source.
  it('warms up fast then settles to the mature target within the fixed-point deadband', () => {
    let b: Baseline | null = null
    b = updateBaseline(b, 100, 0) // delta 800 -> +400
    expect(b.meanX8).toBe(400)
    b = updateBaseline(b, 100, 0) // delta 400 -> +200
    expect(b.meanX8).toBe(600)
    for (let i = 0; i < 400; i++) {
      b = updateBaseline(b, 100, 30) // mature: slow convergence toward 800 (=100*8)
    }
    expect(Math.abs(baselineMean(b) - 100)).toBeLessThan(2.5)
  })

  it('has no z-score until deviation has accumulated', () => {
    // A first-ever sample already makes dev_x8 nonzero (absd = |800 - 400| = 400 != 0)
    // — z is only null while dev_x8 stays exactly 0 (a perfectly repeated identical
    // sample from a zero baseline).
    expect(baselineZ({ meanX8: 0, devX8: 0 }, 100)).toBeNull()
  })

  it('reports a positive z-score for a sample above a settled baseline', () => {
    let b: Baseline | null = null
    for (let i = 0; i < 50; i++) b = updateBaseline(b, 100, 30)
    const z = baselineZ(b!, 110)
    expect(z).not.toBeNull()
    expect(z!).toBeGreaterThan(0)
  })

  it('mean/deviation accessors divide the ×8 fixed-point state', () => {
    const b: Baseline = { meanX8: 800, devX8: 40 }
    expect(baselineMean(b)).toBe(100)
    expect(baselineDeviation(b)).toBe(5)
  })
})

/** Deterministic normal samples, so the statistical cases below cannot flake. */
function normalSeries(seed: number, n: number, mean: number, sd: number): number[] {
  let s = seed >>> 0
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
  return Array.from({ length: n }, () => {
    const z = Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u())
    return Math.round(mean + sd * z)
  })
}

/** The fold as it stood before #2159: mean seeded, dev handed to the vendor update at zero. */
const meanOnlySeed = (b: Baseline | null, sample: number, age: number): Baseline =>
  b == null ? { meanX8: sample << 3, devX8: 0 } : updateBaseline(b, sample, age)

/** Mean |z| of night `n` against the baseline folded from nights 1..n-1, over many series. A
 *  baseline whose dev has settled scores ~1.0 here (the dev settles near the mean absolute
 *  deviation, so |z| ≈ E|x−μ| / dev). */
function meanAbsZAt(
  n: number,
  fold: (b: Baseline | null, s: number, age: number) => Baseline,
  scale: { mean: number; sd: number },
): number {
  let total = 0
  const runs = 300
  for (let r = 0; r < runs; r++) {
    const xs = normalSeries(r * 7919 + 13, n, scale.mean, scale.sd)
    let b: Baseline | null = null
    for (let i = 0; i < n - 1; i++) b = fold(b, xs[i], i)
    total += Math.abs(baselineZ(b!, xs[n - 1]) ?? 0)
  }
  return total / runs
}

describe('seedOrUpdateBaseline', () => {
  it('seeds the mean on the first sample with no spread yet', () => {
    const b = seedOrUpdateBaseline(null, 100, 0)
    expect(b).toEqual({ meanX8: 800, devX8: 0 })
    expect(baselineZ(b, 110)).toBeNull()
  })

  it('takes the first spread as the dev, then averages the spreads (hand-computed)', () => {
    let b = seedOrUpdateBaseline(null, 100, 0)
    // Spread is measured against the mean the night is judged against: |880 − 800| = 80. The mean
    // is the vendor's: delta 80 at age 1 moves it by (80 + 1) >> 1 = 40.
    b = seedOrUpdateBaseline(b, 110, 1)
    expect(b).toEqual({ meanX8: 840, devX8: 80 })
    // |720 − 840| = 120, running mean of {80, 120} = 100. Mean: (−121 + 1) >> 1 = −60.
    b = seedOrUpdateBaseline(b, 90, 2)
    expect(b).toEqual({ meanX8: 780, devX8: 100 })
  })

  it('keeps the dev an integer, like the vendor state and the stored *_dev_x8 columns', () => {
    let b: Baseline | null = null
    for (const [i, x] of normalSeries(5, 40, 3586, 13).entries()) {
      b = seedOrUpdateBaseline(b, x, i)
      expect(Number.isInteger(b.devX8)).toBe(true)
    }
  })

  it('leaves the mean to the vendor update at every age', () => {
    let b: Baseline | null = null
    for (const [i, x] of normalSeries(9, 100, 56, 12).entries()) {
      const next = seedOrUpdateBaseline(b, x, i)
      if (b != null) expect(next.meanX8).toBe(updateBaseline(b, x, i).meanX8)
      b = next
    }
  })

  it('hands over to the vendor update untouched from DEV_WARMUP_NIGHTS on', () => {
    const b: Baseline = { meanX8: 28688, devX8: 80 }
    expect(seedOrUpdateBaseline(b, 3600, DEV_WARMUP_NIGHTS)).toEqual(updateBaseline(b, 3600, DEV_WARMUP_NIGHTS))
    expect(seedOrUpdateBaseline(b, 3570, 200)).toEqual(updateBaseline(b, 3570, 200))
  })

  it('does not anchor a late-joining metric to zero through a large shared age', () => {
    // Breathing joined the fold after the other metrics had history, so its second sample arrives
    // at a large `ageDays`. A running mean keyed on that age alone would give this first spread a
    // weight of 1/31 against the seed's zero.
    let b = seedOrUpdateBaseline(null, 94, 30)
    b = seedOrUpdateBaseline(b, 100, 31)
    expect(b.devX8).toBe(48) // |800 − 752|, the whole first spread
  })

  it('keeps a perfectly steady series spread-free, so it reports no z', () => {
    let b: Baseline | null = null
    for (let i = 0; i < 10; i++) b = seedOrUpdateBaseline(b, 50, i)
    expect(b!.devX8).toBe(0)
    expect(baselineZ(b!, 51)).toBeNull()
  })

  // #2159. Seeding only the mean left the dev climbing from zero under the vendor's collapsing gain,
  // so a young baseline's z ran hot. Each scale is a metric's nightly mean and spread in the sample
  // units of its call site in `daily-summary.ts` (temperature centi-°C, HRV ms, resting HR bpm,
  // sleep minutes, MET ×10, breathing rpm×10), at the sizes BF-13 and TN-47 measured on the owner's
  // history.
  const scales = {
    temperature: { mean: 3586, sd: 12.8 },
    hrv: { mean: 56, sd: 12 },
    restingHr: { mean: 54, sd: 4 },
    sleep: { mean: 480, sd: 65 },
    breathing: { mean: 94, sd: 7.6 },
  }
  for (const [metric, scale] of Object.entries(scales)) {
    it(`gives a calibrated z from the night scoring starts reading it — ${metric}`, () => {
      for (const n of [15, 31]) {
        expect(meanAbsZAt(n, seedOrUpdateBaseline, scale)).toBeGreaterThan(0.85)
        expect(meanAbsZAt(n, seedOrUpdateBaseline, scale)).toBeLessThan(1.15)
      }
      // The defect, measured the same way: a mean-only seed runs ~2× hot at night 15, ~1.6× at 31.
      expect(meanAbsZAt(15, meanOnlySeed, scale)).toBeGreaterThan(1.7)
      expect(meanAbsZAt(31, meanOnlySeed, scale)).toBeGreaterThan(1.4)
    })
  }

  it('gives MET a z no longer hot, within the limits of its coarse sample unit', () => {
    // MET ×10 spreads ~1.1 sample units a night, so one integer step is ~0.9σ and both the mean and
    // the dev move in steps as large as the spread itself. Its z lands a little cool rather than at
    // ~1.0. The mean-only seed is worse here than anywhere, because the vendor's deadband barely lets
    // a dev that starts at zero move at all.
    const met = { mean: 14, sd: 1.1 }
    for (const n of [15, 31]) {
      expect(meanAbsZAt(n, seedOrUpdateBaseline, met)).toBeGreaterThan(0.7)
      expect(meanAbsZAt(n, seedOrUpdateBaseline, met)).toBeLessThan(1.15)
      expect(meanAbsZAt(n, meanOnlySeed, met)).toBeGreaterThan(1.6)
    }
  })
})
