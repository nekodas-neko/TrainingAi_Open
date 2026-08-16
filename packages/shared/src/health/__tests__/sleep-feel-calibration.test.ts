import { describe, it, expect } from 'vitest'
import {
  buildSleepFeelCalibration,
  sleepFeelAsScore,
  sleepFeelLabel,
  MIN_PAIRED_FOR_CORRELATION,
} from '../sleep-feel-calibration'

const build = (pairs: [string, number | null, number | null][]) =>
  buildSleepFeelCalibration({
    from: pairs[0][0],
    to: pairs[pairs.length - 1][0],
    scoresByDate: new Map(pairs.map(([d, s]) => [d, s])),
    feelByDate: new Map(pairs.map(([d, , f]) => [d, f])),
  })

/** n days from 2026-07-01, with the given (score, feel) pairs. */
const days = (xs: [number | null, number | null][]): [string, number | null, number | null][] =>
  xs.map(([s, f], i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, s, f])

describe('the stored scale runs 1 = great … 5 = terrible', () => {
  it('labels each stored value the way the check-in does', () => {
    expect([1, 2, 3, 4, 5].map(sleepFeelLabel)).toEqual(['Great', 'Good', 'OK', 'Poor', 'Terrible'])
  })

  it('maps the stored rating onto the model\'s higher-is-better axis', () => {
    // Getting this backwards would invert every correlation reported by the view.
    expect(sleepFeelAsScore(1)).toBe(100)
    expect(sleepFeelAsScore(3)).toBe(50)
    expect(sleepFeelAsScore(5)).toBe(0)
  })
})

describe('agreement direction', () => {
  it('reports +1 when the model orders nights exactly as the owner does', () => {
    // Model score rises as the stored rating improves (5 = terrible … 1 = great).
    const c = build(days([[60, 5], [70, 4], [75, 4], [80, 3], [85, 3], [90, 2], [95, 2], [98, 1], [99, 1]]))
    expect(c.paired).toBe(9)
    expect(c.spearman).toBeGreaterThan(0.95)
  })

  it('reports a strong NEGATIVE correlation when the model is inverted', () => {
    const c = build(days([[99, 5], [95, 4], [90, 4], [85, 3], [80, 3], [75, 2], [70, 2], [65, 1], [60, 1]]))
    expect(c.spearman).toBeLessThan(-0.95)
    expect(c.notes.join(' ')).toContain('OPPOSITE')
  })

  it('withholds a correlation below the paired-night floor', () => {
    const c = build(days(Array.from({ length: MIN_PAIRED_FOR_CORRELATION - 1 }, (_, i) => [80 + i, 3])))
    expect(c.spearman).toBeNull()
    expect(c.notes.join(' ')).toContain('are needed before a correlation means anything')
  })

  it('returns null rather than 0 when one side never varies', () => {
    // A constant series has no rank order — the correlation is undefined, and calling it 0 would
    // read as "no relationship" when the truth is "not measurable".
    const c = build(days(Array.from({ length: 10 }, (_, i) => [80 + i, 3])))
    expect(c.paired).toBe(10)
    expect(c.spearman).toBeNull()
    expect(c.notes.join(' ')).toContain('constant')
  })
})

describe('buckets', () => {
  it('always returns all five ratings, with unused ones empty', () => {
    const c = build(days([[90, 2], [80, 3], [85, 2]]))
    expect(c.buckets.map(b => b.feel)).toEqual([1, 2, 3, 4, 5])
    expect(c.buckets.find(b => b.feel === 2)).toMatchObject({ nights: 2, meanModelScore: 87.5, minModelScore: 85, maxModelScore: 90 })
    expect(c.buckets.find(b => b.feel === 4)).toMatchObject({ nights: 0, meanModelScore: null })
  })

  it('flags a bucket that scores higher than a better-rated one', () => {
    // "OK" nights averaging above "Good" nights is out of order — no rescaling fixes it, which is
    // why it gets its own note.
    const c = build(days([
      [80, 2], [82, 2], [95, 3], [97, 3],
      [70, 5], [72, 5], [75, 4], [77, 4], [60, 1], [62, 1],
    ]))
    expect(c.notes.join(' ')).toContain('Out of order')
    expect(c.notes.join(' ')).toContain('"OK"')
  })

  it('does not flag out-of-order from a single-night bucket', () => {
    // Every multi-night bucket is in order (96 > 89 > 76 > 71); only the single "OK" night at 99
    // sits out of place, and one night is not evidence of a systematic problem.
    const c = build(days([
      [95, 1], [97, 1], [88, 2], [90, 2], [99, 3], [75, 4], [77, 4], [70, 5], [72, 5],
    ]))
    expect(c.buckets.find(b => b.feel === 3)).toMatchObject({ nights: 1, meanModelScore: 99 })
    expect(c.notes.join(' ')).not.toContain('Out of order')
  })
})

describe('compression', () => {
  it('calls out a model that uses far less range than the owner', () => {
    // The real production shape: every night scores 81–98 while the rating spans its whole range.
    const c = build(days([[90, 1], [92, 1], [93, 2], [95, 2], [88, 3], [89, 3], [92, 4], [76, 5], [91, 2]]))
    expect(c.modelRange!.spread).toBeLessThan(c.feelRange!.spread / 2)
    expect(c.notes.join(' ')).toContain('Compression')
  })

  it('says nothing about compression when the ranges are comparable', () => {
    const c = build(days([[10, 5], [30, 4], [50, 3], [70, 2], [95, 1], [20, 5], [40, 4], [60, 3], [80, 2]]))
    expect(c.notes.join(' ')).not.toContain('Compression')
  })
})

describe('rows and disagreements', () => {
  it('keeps unpaired nights but leaves their gap null', () => {
    const c = build([
      ['2026-07-01', 90, null],   // scored, never rated
      ['2026-07-02', null, 3],    // rated, unscorable night
    ])
    expect(c.rows).toHaveLength(2)
    expect(c.paired).toBe(0)
    expect(c.rows.every(r => r.rankGapPct === null)).toBe(true)
    expect(c.worstDisagreements).toHaveLength(0)
  })

  it('ranks the night the two most disagree about first', () => {
    // 07-07 is the model's best night and the owner's worst — it must top the list.
    const c = build(days([[60, 5], [70, 4], [75, 4], [80, 3], [85, 3], [90, 2], [99, 5], [95, 1], [97, 1]]))
    expect(c.worstDisagreements[0].date).toBe('2026-07-07')
    expect(c.worstDisagreements[0].rankGapPct).toBeGreaterThan(80)
  })

  it('excludes dates outside the requested window', () => {
    const c = buildSleepFeelCalibration({
      from: '2026-07-02',
      to: '2026-07-03',
      scoresByDate: new Map([['2026-07-01', 90], ['2026-07-02', 91], ['2026-07-03', 92], ['2026-07-04', 93]]),
      feelByDate: new Map([['2026-07-02', 2], ['2026-07-03', 3]]),
    })
    expect(c.rows.map(r => r.date)).toEqual(['2026-07-02', '2026-07-03'])
  })
})
