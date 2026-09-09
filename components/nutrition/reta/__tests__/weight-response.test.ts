import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { weightResponse, formatRange, DEFAULT_BAND_PCT_PER_WEEK } from '../weight-response'

/**
 * OR-102b ④. The property under test is not the arithmetic — that is LB-67's `computeWeightRateFit`
 * and has its own tests — but the **refusal to commit** when the interval does not.
 */

/** A series losing `kgPerWeek` from `start`, one weigh-in a day, with an optional wobble. */
function series(days: number, start: number, kgPerWeek: number, wobble: (i: number) => number = () => 0) {
  return Array.from({ length: days }, (_, i) => ({
    // `shiftDateStr`, not a UTC slice: the repo's own day arithmetic, and the banned pattern is
    // banned in fixtures too.
    date: shiftDateStr('2026-01-01', i),
    weightKg: start - (kgPerWeek / 7) * i + wobble(i),
  }))
}

// A deterministic wobble, so a test that depends on noise is not a test that depends on the day.
const jitter = (amp: number) => (i: number) => amp * Math.sin(i * 2.399963)

describe('weightResponse — it refuses to commit when the interval does not', () => {
  it('is null below three weigh-ins, because there is no interval to report', () => {
    expect(weightResponse({ points: series(2, 100, 0.7) })).toBeNull()
  })

  it('withholds the verdict on a short series, however clean the line is', () => {
    // Four days on a perfect line. The naive reading is "−0.70 kg/wk exactly"; with one degree of
    // freedom and a residual SD floored at the measured 1.203 kg, the honest answer is that this
    // says nothing yet.
    const r = weightResponse({ points: series(4, 100, 0.7) })
    expect(r).not.toBeNull()
    expect(r!.verdict).toBeNull()
    expect(r!.hiKgPerWeek - r!.loKgPerWeek).toBeGreaterThan(1)
  })

  it('does not divide by a residual of zero on a perfectly straight series', () => {
    // Measured at 1.2e-13 on exactly this fixture, which passes a `> 0` guard and then makes every
    // difference look significant.
    const r = weightResponse({ points: series(30, 100, 0.7) })
    expect(r).not.toBeNull()
    expect(Number.isFinite(r!.loKgPerWeek)).toBe(true)
    expect(r!.hiKgPerWeek - r!.loKgPerWeek).toBeGreaterThan(0.01)
  })

  it('calls a clearly excessive loss too_fast once the whole interval clears the band', () => {
    // 2.5 kg/wk on a 100 kg body against a 0.5–1.0 kg band: far outside, over 8 weeks.
    const r = weightResponse({ points: series(56, 100, 2.5, jitter(0.4)) })
    expect(r!.verdict).toBe('too_fast')
    expect(r!.loKgPerWeek).toBeGreaterThan(r!.bandHiKgPerWeek)
  })

  it('calls a flat series too_slow rather than in_band', () => {
    const r = weightResponse({ points: series(56, 100, 0, jitter(0.3)) })
    expect(r!.verdict).toBe('too_slow')
  })

  it('separates gaining from merely too slow', () => {
    const r = weightResponse({ points: series(56, 100, -1.2, jitter(0.3)) })
    expect(r!.verdict).toBe('gaining')
  })

  it('says in_band only when the whole interval sits inside it', () => {
    const r = weightResponse({ points: series(90, 100, 0.75, jitter(0.05)) })
    expect(r!.verdict).toBe('in_band')
    expect(r!.loKgPerWeek).toBeGreaterThanOrEqual(r!.bandLoKgPerWeek)
    expect(r!.hiKgPerWeek).toBeLessThanOrEqual(r!.bandHiKgPerWeek)
  })

  it('withholds rather than rounding an interval that straddles a boundary to the nearer side', () => {
    // Sitting on the fast edge with real noise: the point estimate is over the band, the interval
    // is not entirely over it.
    const r = weightResponse({ points: series(21, 100, 1.05, jitter(0.9)) })
    expect(r!.lossKgPerWeek).toBeGreaterThan(r!.bandHiKgPerWeek)
    expect(r!.loKgPerWeek).toBeLessThan(r!.bandHiKgPerWeek)
    expect(r!.verdict).toBeNull()
  })
})

describe('weightResponse — the band is a percentage of bodyweight', () => {
  it('scales the band to the body it is about', () => {
    const light = weightResponse({ points: series(30, 60, 0.5, jitter(0.2)), bodyweightKg: 60 })
    const heavy = weightResponse({ points: series(30, 120, 0.5, jitter(0.2)), bodyweightKg: 120 })
    expect(light!.bandLoKgPerWeek).toBeCloseTo(0.30, 2)
    expect(heavy!.bandLoKgPerWeek).toBeCloseTo(0.60, 2)
    // Twice the body, twice the band — the whole reason it is a percentage.
    expect(heavy!.bandHiKgPerWeek / light!.bandHiKgPerWeek).toBeCloseTo(2, 5)
    expect(DEFAULT_BAND_PCT_PER_WEEK).toEqual({ lo: 0.5, hi: 1.0 })
  })

  it('takes the latest weigh-in as the bodyweight, not the first', () => {
    // Losing over the window, so the latest reading is the lightest — using the first would set the
    // band from a body the user no longer has. Six kilos of loss is a measurably narrower band.
    const points = series(30, 100, 1.4, jitter(0.2))
    const latest = points.at(-1)!.weightKg
    expect(latest).toBeLessThan(95)
    expect(weightResponse({ points })!.bandHiKgPerWeek).toBeCloseTo(latest / 100, 3)
  })

  it('honours an explicit bodyweight over the series', () => {
    const r = weightResponse({ points: series(30, 100, 0.5, jitter(0.2)), bodyweightKg: 80 })
    expect(r!.bandLoKgPerWeek).toBeCloseTo(0.40, 2)
  })

  it('honours a band the owner widened', () => {
    const points = series(56, 100, 1.4, jitter(0.3))
    const narrow = weightResponse({ points })
    const wide = weightResponse({ points, bandPctPerWeek: { lo: 0.5, hi: 2.0 } })
    // 1.4 kg/wk clears a 1 % ceiling and does not clear a 2 % one — same data, same interval, the
    // verdict turns on the band the owner set and on nothing else.
    expect(narrow!.verdict).toBe('too_fast')
    expect(wide!.bandHiKgPerWeek).toBeCloseTo(narrow!.bandHiKgPerWeek * 2, 5)
    expect(wide!.verdict).not.toBe('too_fast')
  })

  it('is null rather than dividing by a bodyweight of zero', () => {
    expect(weightResponse({ points: series(30, 100, 0.5), bodyweightKg: 0 })).toBeNull()
  })
})

describe('weightResponse — bad input', () => {
  it('is null when every reading falls on one day', () => {
    expect(weightResponse({
      points: [
        { date: '2026-01-01', weightKg: 100 },
        { date: '2026-01-01', weightKg: 100.2 },
        { date: '2026-01-01', weightKg: 99.8 },
      ],
    })).toBeNull()
  })

  it('ignores days with no weigh-in rather than treating them as zero', () => {
    const points = [
      ...series(30, 100, 0.7, jitter(0.2)),
      { date: '2026-02-10', weightKg: null },
    ]
    const r = weightResponse({ points })
    expect(r!.weighIns).toBe(30)
  })
})

describe('formatRange — signed as weight change, which is how it is read', () => {
  it('prints a loss as a negative change and flips the interval with it', () => {
    const r = weightResponse({ points: series(30, 100, 0.7, jitter(0.2)) })!
    const text = formatRange(r)
    expect(text).toMatch(/^−0\.\d\d kg\/wk \(95% CI −\d\.\d\d to [−+]\d\.\d\d, 29 days\)$/)
    // The low end of the LOSS is the high end of the CHANGE — printing them unflipped would give an
    // interval running backwards.
    const [, hiChange, loChange] = text.match(/CI ([−+][\d.]+) to ([−+][\d.]+)/)!
    const num = (s: string) => Number(s.replace('−', '-').replace('+', ''))
    expect(num(hiChange)).toBeLessThan(num(loChange))
  })
})
