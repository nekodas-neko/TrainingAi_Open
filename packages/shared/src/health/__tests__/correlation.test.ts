import { describe, it, expect } from 'vitest'
import { bucketize, computeBaselines, pctFromBaseline, correlationInsight, pearson, pValueForR, partialCorrelation, type BucketDef } from '@trainingai/shared/health/correlation'

const DEFS: BucketDef[] = [
  { label: '<6h', min: 0, max: 6 },
  { label: '6–7h', min: 6, max: 7 },
]

describe('bucketize', () => {
  it('averages y per x-bucket and drops empty buckets', () => {
    // '<6h': (2 + -4)/2 = -1.0 (count 2); '6–7h': 3.0 (count 1); x=9 falls in no bucket
    expect(bucketize([
      { x: 5.5, y: 2 }, { x: 5.0, y: -4 }, { x: 6.5, y: 3 }, { x: 9, y: 100 },
    ], DEFS)).toEqual([
      { label: '<6h', avg: -1, count: 2 },
      { label: '6–7h', avg: 3, count: 1 },
    ])
  })
  it('rounds averages to one decimal', () => {
    // (1 + 2)/3 … use 1,2,2 → 5/3 = 1.666… → 1.7
    expect(bucketize([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 2 }],
      [{ label: 'a', min: 0, max: 2 }])).toEqual([{ label: 'a', avg: 1.7, count: 3 }])
  })
})

describe('computeBaselines', () => {
  it('returns the mean per key, only for keys with enough samples', () => {
    const out = computeBaselines(new Map([
      ['Bench', [100, 102, 98]],   // mean 100, 3 samples → kept
      ['Squat', [140, 150]],       // 2 samples → dropped
    ]), 3)
    expect(out.get('Bench')).toBe(100)
    expect(out.has('Squat')).toBe(false)
  })
})

describe('pctFromBaseline', () => {
  it('computes percentage deviation', () => {
    expect(pctFromBaseline(105, 100)).toBe(5)
    expect(pctFromBaseline(95, 100)).toBe(-5)
  })
})

describe('correlationInsight', () => {
  it('reports insufficient data with fewer than 2 eligible buckets', () => {
    const out = correlationInsight([{ label: 'a', avg: 1, count: 5 }], (b, w) => `${b.label} vs ${w.label}`)
    expect(out.hasSufficientData).toBe(false)
  })
  it('renders the best/worst sentence when eligible', () => {
    const out = correlationInsight(
      [{ label: 'a', avg: 1, count: 5 }, { label: 'b', avg: 10, count: 5 }],
      (best, worst) => `${best.label} beats ${worst.label}`,
    )
    expect(out.hasSufficientData).toBe(true)
    expect(out.insight).toBe('b beats a')
  })
  it('accepts custom fallback texts for callers preserving legacy wording', () => {
    const out = correlationInsight([], () => '', 3, { insufficient: 'Not enough paired sleep + workout data yet.' })
    expect(out.insight).toBe('Not enough paired sleep + workout data yet.')
  })
})

// ── Q-75: the significance gate ─────────────────────────────────────────────────────────────────
// Before 2026-08-05 the engine rendered a confident sentence whenever two buckets differed by more
// than one raw unit, with no test at all. Five strong-looking production correlations were checked
// and every one failed a control the engine did not apply.

describe('pearson', () => {
  it('returns 1 for a perfect positive line and -1 for a perfect negative one', () => {
    const up = [1, 2, 3, 4, 5].map(x => ({ x, y: 2 * x + 1 }))
    const down = [1, 2, 3, 4, 5].map(x => ({ x, y: -3 * x }))
    expect(pearson(up)).toBeCloseTo(1, 10)
    expect(pearson(down)).toBeCloseTo(-1, 10)
  })

  it('returns null rather than 0 for a constant series', () => {
    // 0 would read as "measured, no relationship". Null is "cannot be measured" — a different
    // claim, and the gate treats them differently.
    expect(pearson([1, 2, 3, 4].map(x => ({ x, y: 7 })))).toBeNull()
  })

  it('returns null below three pairs', () => {
    expect(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull()
  })
})

describe('pValueForR', () => {
  it('gives no evidence for a weak r on a small sample', () => {
    expect(pValueForR(0.15, 20)).toBeGreaterThan(0.05)
  })

  it('gives strong evidence for a strong r on a decent sample', () => {
    expect(pValueForR(0.8, 40)).toBeLessThan(0.001)
  })

  it('is sample-size sensitive — the same r passes at n=100 and fails at n=10', () => {
    expect(pValueForR(0.35, 10)).toBeGreaterThan(0.05)
    expect(pValueForR(0.35, 100)).toBeLessThan(0.05)
  })

  it('refuses to claim anything below four pairs', () => {
    expect(pValueForR(0.99, 3)).toBe(1)
  })
})

describe('partialCorrelation', () => {
  it('collapses a correlation that exists only because both series track the calendar', () => {
    // x and y each rise with the day index and are otherwise unrelated — exactly the shape that
    // made overnight HRV correlate with everything (r = 0.79 with date in production).
    const pts = Array.from({ length: 30 }, (_, i) => ({
      x: i + (i % 3) - 1,
      y: i * 2 + (i % 5) - 2,
      c: i,
    }))
    expect(pearson(pts)!).toBeGreaterThan(0.9)
    expect(Math.abs(partialCorrelation(pts)!)).toBeLessThan(0.5)
  })

  it('leaves a genuine relationship standing', () => {
    // y depends on x, and neither depends on the control.
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: (i * 7) % 11, y: ((i * 7) % 11) * 3, c: i }))
    expect(Math.abs(partialCorrelation(pts)!)).toBeGreaterThan(0.9)
  })
})

describe('correlationInsight — gating', () => {
  const buckets = [{ label: 'low', avg: 1, count: 15 }, { label: 'high', avg: 20, count: 15 }]
  const render = (b: { label: string }, w: { label: string }) => `${b.label} beats ${w.label}`

  it('withholds on sample size, and says so rather than reusing the no-difference text', () => {
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: i, y: i }))
    const out = correlationInsight(buckets, render, undefined, undefined, { points: pts })
    expect(out.withheld).toBe('sample')
    expect(out.insight).toContain('8 paired days')
    expect(out.insight).not.toContain('No meaningful difference')
  })

  it('withholds when the relationship is not significant', () => {
    // Deterministic zig-zag: no monotone relationship, plenty of points.
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: (i % 2) * 10 }))
    const out = correlationInsight(buckets, render, undefined, undefined, { points: pts })
    expect(out.withheld).toBe('significance')
    expect(out.stats!.n).toBe(40)
  })

  it('withholds when the effect is only the shared calendar drift', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i + (i % 3), y: i * 2 + (i % 5) }))
    const out = correlationInsight(buckets, render, undefined, undefined, {
      points: pts,
      control: pts.map((_, i) => i),
    })
    expect(out.withheld).toBe('confounded')
    expect(out.insight).toContain('calendar trend')
  })

  it('renders the claim, with its sample size, when it survives every check', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: (i * 13) % 17, y: ((i * 13) % 17) * 4 }))
    const out = correlationInsight(buckets, render, undefined, undefined, {
      points: pts,
      control: pts.map((_, i) => i),
    })
    expect(out.withheld).toBeUndefined()
    expect(out.insight).toBe('high beats low (40 paired days)')
    expect(out.stats!.r).toBeGreaterThan(0.9)
  })

  it('keeps the old untested behaviour when no points are supplied', () => {
    // The escape hatch exists so an un-migrated caller still compiles; it must not silently
    // start claiming significance it never computed.
    const out = correlationInsight(buckets, render)
    expect(out.insight).toBe('high beats low')
    expect(out.stats).toBeUndefined()
  })

  it('needs five in a bucket now, not three', () => {
    const thin = [{ label: 'low', avg: 1, count: 4 }, { label: 'high', avg: 20, count: 4 }]
    expect(correlationInsight(thin, render).hasSufficientData).toBe(false)
  })
})
