import { describe, it, expect } from 'vitest'
import { bucketize, computeBaselines, pctFromBaseline, correlationInsight, buildExercise1rmBaseline, sessionMean1RmPct, pearson, spearman, averageRanks, pValueForR, partialCorrelation, type BucketDef } from '@trainingai/shared/health/correlation'

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

// `averageRanks` moved here from model-report-calibration.ts when PS-15 needed a second caller —
// the device-comparison endpoint, where Oura stress is normalised −1..+1 and the Colmi's is raw
// 0..100 and rank agreement is the only statistic that survives. It arrived with its tie handling
// untested in either home, which is the shape of thing that survives a move unnoticed.
describe('averageRanks', () => {
  it('ranks from 1, in value order rather than input order', () => {
    expect(averageRanks([30, 10, 20])).toEqual([3, 1, 2])
  })

  it('gives tied values the MEAN of the positions they span', () => {
    // Two values tied across positions 2 and 3 both take 2.5 — not 2, and not 3. Handing both the
    // first position shifts every rank above them and quietly biases the correlation.
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
  })

  it('collapses an all-tied series onto one shared rank', () => {
    expect(averageRanks([7, 7, 7])).toEqual([2, 2, 2])
  })
})

describe('spearman', () => {
  it('is 1 for any monotonic relationship, however curved', () => {
    // The reason to reach for it at all: Pearson sees the curve, Spearman sees the order.
    const pts = [1, 2, 3, 4, 5].map(x => ({ x, y: x ** 3 }))
    expect(spearman(pts)).toBeCloseTo(1, 10)
    expect(pearson(pts)!).toBeLessThan(1)
  })

  it('is -1 when the order is exactly reversed', () => {
    expect(spearman([{ x: 1, y: 9 }, { x: 2, y: 5 }, { x: 3, y: 1 }])).toBeCloseTo(-1, 10)
  })

  it('is unchanged by rescaling either axis — the property PS-15 depends on', () => {
    // Oura's stress is −1..+1 and the Colmi's 0..100; a statistic that moved under that rescale
    // would be no more usable across them than a mean bias in mixed units.
    const pts = [{ x: -0.4, y: 33 }, { x: 0.05, y: 40 }, { x: 0.3, y: 55 }, { x: 0.6, y: 65 }]
    const rescaled = pts.map(p => ({ x: p.x * 50 + 50, y: p.y / 100 }))
    expect(spearman(rescaled)).toBeCloseTo(spearman(pts)!, 12)
  })

  it('refuses two points rather than reporting the ±1 they always give', () => {
    // Pearson over two points is ±1 by construction. Reporting that as rank agreement would be
    // a certainty invented from nothing.
    expect(spearman([{ x: 1, y: 2 }, { x: 2, y: 1 }])).toBeNull()
    expect(spearman([{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 9 }])).not.toBeNull()
  })

  it('is null when one series is constant, same as pearson', () => {
    expect(spearman([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }])).toBeNull()
  })
})

/**
 * PS-29 — a correlation fed one point per EXERCISE counts 4 days × 5 lifts as n = 20, clears
 * `DEFAULT_MIN_N`, computes its p-value at 20, and renders "20 paired days" for four. The points
 * from one day all carry the SAME x, so they are not independent observations of anything, and the
 * inflation runs in the direction that manufactures significance.
 *
 * `sessionMean1RmPct` is what makes an observation an observation; these pin the aggregate and the
 * count it produces.
 */
describe('sessionMean1RmPct — one observation per session, not per lift', () => {
  const baseline = new Map([['Squat', 100], ['Bench', 50], ['Row', 80]])

  it('AVERAGES the session\'s lifts rather than summing them', () => {
    // +10% and +20% -> mean 15, sum 30. Deliberately asymmetric: a symmetric pair like +10/-10
    // averages AND sums to zero, so it cannot tell the two apart.
    const ws = { exercises: [
      { exerciseName: 'Squat', estimated1rm: 110 },
      { exerciseName: 'Bench', estimated1rm: 60 },
    ] }
    expect(sessionMean1RmPct(ws, baseline)).toBeCloseTo(15, 6)
  })

  it('does not grow with the number of lifts — three at +10% is still +10%', () => {
    const one   = { exercises: [{ exerciseName: 'Squat', estimated1rm: 110 }] }
    const three = { exercises: [
      { exerciseName: 'Squat', estimated1rm: 110 },
      { exerciseName: 'Bench', estimated1rm: 55 },
      { exerciseName: 'Row',   estimated1rm: 88 },
    ] }
    expect(sessionMean1RmPct(one, baseline)).toBeCloseTo(10, 6)
    expect(sessionMean1RmPct(three, baseline)).toBeCloseTo(10, 6)
  })

  it('ignores lifts with no baseline rather than treating them as zero deviation', () => {
    const ws = { exercises: [
      { exerciseName: 'Squat', estimated1rm: 110 },
      { exerciseName: 'Unknown Lift', estimated1rm: 999 },
    ] }
    expect(sessionMean1RmPct(ws, baseline)).toBeCloseTo(10, 6)
  })

  it('returns null when nothing in the session can be compared', () => {
    expect(sessionMean1RmPct({ exercises: [] }, baseline)).toBeNull()
    expect(sessionMean1RmPct({ exercises: [{ exerciseName: 'Unknown', estimated1rm: 100 }] }, baseline)).toBeNull()
    // A non-positive or absent estimate is not a data point.
    expect(sessionMean1RmPct({ exercises: [{ exerciseName: 'Squat', estimated1rm: 0 }] }, baseline)).toBeNull()
    expect(sessionMean1RmPct({ exercises: [{ exerciseName: 'Squat' }] }, baseline)).toBeNull()
  })
})

describe('buildExercise1rmBaseline', () => {
  const session = (...vals: [string, number][]) => ({
    exercises: vals.map(([exerciseName, estimated1rm]) => ({ exerciseName, estimated1rm })),
  })

  it('needs three sessions of a lift before it has a baseline for it', () => {
    const twice = [session(['Squat', 100]), session(['Squat', 110])]
    expect(buildExercise1rmBaseline(twice).has('Squat')).toBe(false)
    const thrice = [...twice, session(['Squat', 120])]
    expect(buildExercise1rmBaseline(thrice).get('Squat')).toBeCloseTo(110, 6)
  })

  it('skips absent and non-positive estimates when counting toward that floor', () => {
    const rows = [
      session(['Squat', 100]), session(['Squat', 110]), session(['Squat', 0]),
    ]
    expect(buildExercise1rmBaseline(rows).has('Squat')).toBe(false)
  })
})

/**
 * The count is the defect, so it is asserted through the helpers that report it — both of them.
 * `bucketize` counts points too, so per-exercise points inflated the per-bucket `minCount` gate as
 * well: a single day of five lifts satisfied the "≥5 observations" floor that was raised from 3 on
 * 2026-08-05 precisely because "three observations cannot support a claim about someone's body".
 */
describe('n and bucket counts are days, not lifts', () => {
  const baseline = new Map([['Squat', 100]])
  const LIFTS_PER_DAY = 5
  const dayPoint = (sleepHours: number, oneRm: number) => ({
    x: sleepHours,
    y: sessionMean1RmPct(
      { exercises: Array.from({ length: LIFTS_PER_DAY }, () => ({ exerciseName: 'Squat', estimated1rm: oneRm })) },
      baseline,
    )!,
  })

  it('four days of five lifts is n = 4 and withheld for sample size, not n = 20 and reported', () => {
    const points = [dayPoint(5.5, 95), dayPoint(6.5, 100), dayPoint(7.5, 105), dayPoint(8.5, 110)]
    expect(points).toHaveLength(4)

    const buckets = bucketize(points, DEFS)
    const r = correlationInsight(
      buckets, () => 'unused', 1, undefined, { points, control: points.map((_, i) => i) },
    )
    expect(r.stats?.n).toBe(4)
    expect(r.withheld).toBe('sample')
    expect(r.insight).toContain('Only 4 paired days')
  })

  it('one day cannot fill a bucket on its own, however many lifts it contained', () => {
    // All four days in the same bucket. Counted as days that is 4; counted as lifts it was 20, and
    // a single day would have cleared a floor of 5 by itself.
    const sameBucket = [dayPoint(6.1, 95), dayPoint(6.2, 100), dayPoint(6.3, 105), dayPoint(6.4, 110)]
    const counts = bucketize(sameBucket, DEFS).map(b => b.count)
    expect(counts.reduce((a, c) => a + c, 0)).toBe(4)
    expect(Math.max(...counts)).toBe(4)
  })
})
