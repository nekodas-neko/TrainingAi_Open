import { describe, it, expect } from 'vitest'
import { alignSeries, pairSummary, allPairSummaries, coverage } from '@/lib/health/device-comparison'

const S = (device: string, pts: [string, number][]) => ({ device, points: pts.map(([bucketStart, value]) => ({ bucketStart, value })) })

describe('alignSeries', () => {
  it('merges devices onto the union of buckets, sorted, with null for a gap', () => {
    const rows = alignSeries([
      S('oura',  [['2026-08-26T10:01:00Z', 60], ['2026-08-26T10:00:00Z', 58]]),
      S('colmi', [['2026-08-26T10:00:00Z', 62]]),
    ])
    expect(rows.map(r => r.bucketStart)).toEqual(['2026-08-26T10:00:00Z', '2026-08-26T10:01:00Z'])
    expect(rows[0].values).toEqual({ oura: 58, colmi: 62 })
    expect(rows[1].values).toEqual({ oura: 60, colmi: null })
  })

  it('gives every device a key even when it reported nothing at all', () => {
    const rows = alignSeries([S('oura', [['t1', 50]]), S('strap', [])])
    expect(rows[0].values).toEqual({ oura: 50, strap: null })
  })

  it('handles no series and no points', () => {
    expect(alignSeries([])).toEqual([])
    expect(alignSeries([S('oura', [])])).toEqual([])
  })
})

describe('pairSummary', () => {
  it('scores only the buckets where both devices reported', () => {
    const rows = alignSeries([
      S('a', [['t1', 60], ['t2', 70], ['t3', 80]]),
      S('b', [['t1', 62], ['t2', 68]]),
    ])
    const s = pairSummary(rows, 'a', 'b')
    expect(s.overlap).toBe(2)               // t3 has no b, so it is excluded entirely
    expect(s.meanAbsDelta).toBe(2)          // |60-62| = 2, |70-68| = 2
    expect(s.maxAbsDelta).toBe(2)
    expect(s.meanBias).toBe(0)              // -2 and +2 cancel
  })

  it('separates bias from absolute error — the case they differ', () => {
    // A device reading consistently 5 high, versus one alternating +5/-5. Same mean ABS error;
    // completely different problems, and a single number would hide that.
    const biased = alignSeries([S('a', [['t1', 65], ['t2', 75]]), S('b', [['t1', 60], ['t2', 70]])])
    const noisy  = alignSeries([S('a', [['t1', 65], ['t2', 65]]), S('b', [['t1', 60], ['t2', 70]])])
    expect(pairSummary(biased, 'a', 'b').meanAbsDelta).toBe(5)
    expect(pairSummary(noisy, 'a', 'b').meanAbsDelta).toBe(5)
    expect(pairSummary(biased, 'a', 'b').meanBias).toBe(5)
    expect(pairSummary(noisy, 'a', 'b').meanBias).toBe(0)
  })

  it('reports nulls rather than zero when the two never overlap', () => {
    const rows = alignSeries([S('a', [['t1', 60]]), S('b', [['t2', 60]])])
    const s = pairSummary(rows, 'a', 'b')
    expect(s.overlap).toBe(0)
    // Zero would read as "perfect agreement", which is the opposite of what no overlap means.
    expect(s.meanAbsDelta).toBeNull()
    expect(s.maxAbsDelta).toBeNull()
    expect(s.meanBias).toBeNull()
  })
})

describe('allPairSummaries and coverage', () => {
  it('produces every unordered pair of three devices', () => {
    const rows = alignSeries([S('oura', [['t1', 60]]), S('strap', [['t1', 61]]), S('colmi', [['t1', 63]])])
    const pairs = allPairSummaries(rows, ['oura', 'strap', 'colmi'])
    expect(pairs.map(p => `${p.a}/${p.b}`)).toEqual(['oura/strap', 'oura/colmi', 'strap/colmi'])
    expect(pairs.find(p => p.b === 'colmi' && p.a === 'strap')!.meanAbsDelta).toBe(2)
  })

  it('counts each device\'s buckets — the denominator behind every other number', () => {
    const rows = alignSeries([S('oura', [['t1', 60], ['t2', 61]]), S('colmi', [['t1', 62]])])
    expect(coverage(rows, ['oura', 'colmi'])).toEqual({ oura: 2, colmi: 1 })
  })
})
