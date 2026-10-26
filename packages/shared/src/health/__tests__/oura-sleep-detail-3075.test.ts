import { describe, it, expect } from 'vitest'
import { overnightHrvFromSeries } from '../oura-sleep-detail'
import { hrvMsFromSamples } from '../night-vitals'

// #3075 stage 1: the night's HRV is the median of Oura's 5-minute HRV series, the ring-era definition.
const series = (items: (number | null)[], interval = 300) => ({ interval, items, timestamp: '2026-10-17T22:30:00+10:00' })

describe('overnightHrvFromSeries', () => {
  it('is the median of the measured samples, not their mean', () => {
    // Mean 57.6, median 49: one high stretch moves Oura's average and not the median.
    expect(overnightHrvFromSeries(series([45, 47, 49, 51, 96]))).toBe(49)
  })

  it('takes the middle two of an even count and rounds to 0.1, as the ring-era headline does', () => {
    expect(overnightHrvFromSeries(series([48, 61]))).toBe(54.5)
    expect(overnightHrvFromSeries(series([41.23, 42.31, 50]))).toBe(42.3)
    expect(overnightHrvFromSeries(series([40, 41, 42, 43.333]))).toBe(41.5)
  })

  it('agrees with the ring-era function on the same samples', () => {
    const items = [52, 61, 38, 44, 70, 49, 55]
    const samples = items.map((value, i) => ({ ds: i * 3000, value }))
    expect(overnightHrvFromSeries(series(items))).toBe(hrvMsFromSamples(samples, []))
  })

  it('leaves out a slot Oura did not measure, and anything that is not a positive number', () => {
    expect(overnightHrvFromSeries(series([null, 50, null, 0, -3, Number.NaN, 60]))).toBe(55)
  })

  it('is null with no series or no measured sample, never zero', () => {
    expect(overnightHrvFromSeries(null)).toBeNull()
    expect(overnightHrvFromSeries(undefined)).toBeNull()
    expect(overnightHrvFromSeries(series([]))).toBeNull()
    expect(overnightHrvFromSeries(series([null, null]))).toBeNull()
    expect(overnightHrvFromSeries({ interval: 300, items: 'x' as unknown as number[] })).toBeNull()
  })

  it('does not depend on the interval', () => {
    expect(overnightHrvFromSeries(series([50, 60, 70], 0))).toBe(60)
    expect(overnightHrvFromSeries(series([50, 60, 70], 600))).toBe(60)
  })
})
