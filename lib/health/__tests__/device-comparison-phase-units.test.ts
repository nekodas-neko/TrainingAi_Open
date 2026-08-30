// PS-15 — two devices that were never compared, reported as two devices that disagree.
//
// The module's header has said *"bucket to the COARSEST cadence among the devices being compared,
// not the finest"* since it was written, and nothing implemented it: the route hardcoded five
// minutes. Measured in production 2026-08-30, Oura's daytime-stress buckets land at **:15 and :45**
// (173 rows) and the Colmi's at **:00 and :30** (95 rows) — permanently fifteen minutes apart, so on
// a five-minute grid no pair can form at any point in history. `overlap: 0` for every bucket, which
// reads as total disagreement and means the two series were never placed on the same axis.
//
// The second half is units. Oura's stress is normalised **−1..+1**; the Colmi's is raw **0..100**
// (measured range 30–65). A mean bias between them is a number in mixed units — worse than no
// number, because it prints and looks like a measurement.
import { describe, it, expect } from 'vitest'
import { bucketSeries, alignSeries, pairSummary, coarsestCadenceMinutes, type NamedSeries } from '../device-comparison'

const OURA = 'oura_ring'
const COLMI = 'colmi_ring'

/** Samples every 30 minutes at `offsetMin` past the hour, for `n` half-hours from a fixed epoch. */
function halfHourly(offsetMin: number, values: number[]): { timestamp: Date; value: number }[] {
  const base = Date.UTC(2026, 7, 27, 12, 0, 0)
  return values.map((value, i) => ({
    timestamp: new Date(base + i * 30 * 60_000 + offsetMin * 60_000),
    value,
  }))
}

// The real phases, from production: Oura at :15/:45, Colmi at :00/:30.
const ouraRaw  = halfHourly(15, [0.10, 0.30, -0.20, 0.50, 0.05, -0.40, 0.25, 0.60])
const colmiRaw = halfHourly(0,  [  42,   55,    38,   61,   40,    33,   48,   65])

describe('a fifteen-minute phase offset (PS-15)', () => {
  it('produces no overlap at all on a five-minute grid — the shipped behaviour', () => {
    const rows = alignSeries([
      { device: OURA,  points: bucketSeries(ouraRaw, 5) },
      { device: COLMI, points: bucketSeries(colmiRaw, 5) },
    ])
    expect(pairSummary(rows, OURA, COLMI).overlap).toBe(0)
  })

  // The distinction the entry was filed for. Both devices reported all day; the grid was the problem.
  it('says out-of-phase, not disagreement, when both reported and never met', () => {
    const rows = alignSeries([
      { device: OURA,  points: bucketSeries(ouraRaw, 5) },
      { device: COLMI, points: bucketSeries(colmiRaw, 5) },
    ])
    expect(pairSummary(rows, OURA, COLMI).verdict).toBe('out-of-phase')
  })

  it('says no-data when one device is genuinely silent — a different finding', () => {
    const rows = alignSeries([
      { device: OURA,  points: bucketSeries(ouraRaw, 30) },
      { device: COLMI, points: [] },
    ])
    const s = pairSummary(rows, OURA, COLMI)
    expect(s.verdict).toBe('no-data')
    expect(s.overlap).toBe(0)
  })

  it('pairs every bucket once the width comes from the data', () => {
    const probe: NamedSeries[] = [
      { device: OURA,  points: bucketSeries(ouraRaw, 1) },
      { device: COLMI, points: bucketSeries(colmiRaw, 1) },
    ]
    const width = coarsestCadenceMinutes(probe)
    expect(width).toBe(30)

    const rows = alignSeries([
      { device: OURA,  points: bucketSeries(ouraRaw, width) },
      { device: COLMI, points: bucketSeries(colmiRaw, width) },
    ])
    const s = pairSummary(rows, OURA, COLMI)
    expect(s.verdict).toBe('compared')
    expect(s.overlap).toBe(8)   // all eight, which is what the hand comparison had
  })
})

describe('deriving the width', () => {
  it('takes the coarsest, not the finest — the whole point', () => {
    const oneHz = Array.from({ length: 120 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 7, 27, 12, 0, i)), value: 60 + (i % 5),
    }))
    const width = coarsestCadenceMinutes([
      { device: 'strap', points: bucketSeries(oneHz, 1) },
      { device: OURA,    points: bucketSeries(ouraRaw, 1) },
    ])
    expect(width).toBe(30)
  })

  // A median, not a mean: one overnight gap in an otherwise 5-minute series would drag a mean into
  // hours and bucket the whole day into one row.
  it('is not dragged by a single long gap', () => {
    const fiveMin = Array.from({ length: 20 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 7, 27, 12, 0) + i * 5 * 60_000), value: i,
    }))
    // …plus one sample eight hours later. A mean over these gaps is 26 minutes; the median is 5.
    fiveMin.push({ timestamp: new Date(Date.UTC(2026, 7, 27, 20, 0)), value: 99 })
    expect(coarsestCadenceMinutes([{ device: 'x', points: bucketSeries(fiveMin, 1) }])).toBe(5)
  })

  it('falls back when a series is too short to have a cadence', () => {
    expect(coarsestCadenceMinutes([{ device: 'x', points: [] }], 7)).toBe(7)
  })

  it('prefers a declared cadence over a guessed one', () => {
    expect(coarsestCadenceMinutes([
      { device: 'x', points: bucketSeries(ouraRaw, 1), cadenceMinutes: 60 },
    ])).toBe(60)
  })
})

describe('mismatched units (PS-15)', () => {
  const paired = () => alignSeries([
    { device: OURA,  points: bucketSeries(ouraRaw, 30) },
    { device: COLMI, points: bucketSeries(colmiRaw, 30) },
  ])

  // The reason this matters: a mean bias of "-45" between a −1..+1 scale and a 0..100 one is not a
  // weak measurement, it is not one — and it prints just as confidently as a real number.
  it('suppresses every magnitude statistic and says why', () => {
    const s = pairSummary(paired(), OURA, COLMI, {
      [OURA]: 'normalised_-1..1', [COLMI]: 'raw_0..100',
    })
    expect(s.verdict).toBe('compared')
    expect(s.meanBias).toBeNull()
    expect(s.meanAbsDelta).toBeNull()
    expect(s.maxAbsDelta).toBeNull()
    expect(s.unitsDiffer).toBe('normalised_-1..1 vs raw_0..100')
  })

  // Rank agreement is what the hand comparison behind this entry actually used.
  it('still reports rank agreement, which is what survives the mismatch', () => {
    const s = pairSummary(paired(), OURA, COLMI, {
      [OURA]: 'normalised_-1..1', [COLMI]: 'raw_0..100',
    })
    expect(s.spearman).not.toBeNull()
    expect(s.spearman!).toBeGreaterThan(0.5)
  })

  it('keeps the magnitudes when the units match', () => {
    const s = pairSummary(paired(), OURA, COLMI, { [OURA]: 'bpm', [COLMI]: 'bpm' })
    expect(s.meanBias).not.toBeNull()
    expect(s.maxAbsDelta).not.toBeNull()
    expect(s.unitsDiffer).toBeNull()
  })

  it('keeps them when no units were declared, so existing callers are unchanged', () => {
    const s = pairSummary(paired(), OURA, COLMI)
    expect(s.meanBias).not.toBeNull()
    expect(s.unitsDiffer).toBeNull()
  })
})
