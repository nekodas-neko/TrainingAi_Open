import { describe, it, expect } from 'vitest'
import { bucketHrToMinuteMeans, bucketRrToRmssd } from '@/lib/oura-comparison-harness-adapters'
import { daytimeHrvEstimatesPerBucket, type DaytimeHrvModel } from '@trainingai/shared/health/daytime-hrv-model'

describe('bucketHrToMinuteMeans', () => {
  it('averages multiple samples in the same minute', () => {
    const rows = [
      { timestamp: new Date('2026-07-27T00:00:10Z'), bpm: 100 },
      { timestamp: new Date('2026-07-27T00:00:40Z'), bpm: 110 },
    ]
    expect(bucketHrToMinuteMeans(rows)).toEqual([
      { bucketStart: '2026-07-27T00:00:00.000Z', value: 105 },
    ])
  })

  it('splits samples across separate minute buckets', () => {
    const rows = [
      { timestamp: new Date('2026-07-27T00:00:10Z'), bpm: 100 },
      { timestamp: new Date('2026-07-27T00:01:10Z'), bpm: 120 },
    ]
    expect(bucketHrToMinuteMeans(rows)).toEqual([
      { bucketStart: '2026-07-27T00:00:00.000Z', value: 100 },
      { bucketStart: '2026-07-27T00:01:00.000Z', value: 120 },
    ])
  })

  it('returns an empty array for no rows', () => {
    expect(bucketHrToMinuteMeans([])).toEqual([])
  })
})

describe('bucketRrToRmssd', () => {
  it('computes rMSSD for a 5-minute bucket with enough beats', () => {
    // ~1 beat/sec for 5 min = 300 beats, well above rmssdFromRr's MIN_BEATS floor.
    const rows = Array.from({ length: 300 }, (_, i) => ({
      at: new Date(new Date('2026-07-27T00:00:00Z').getTime() + i * 1000),
      rrMs: 800 + (i % 2 === 0 ? 10 : -10),
    }))
    const out = bucketRrToRmssd(rows)
    expect(out).toHaveLength(1)
    expect(out[0].bucketStart).toBe('2026-07-27T00:00:00.000Z')
    expect(out[0].value).toBeGreaterThan(0)
  })

  it('drops a bucket with too few beats', () => {
    const rows = [{ at: new Date('2026-07-27T00:00:00Z'), rrMs: 800 }, { at: new Date('2026-07-27T00:00:10Z'), rrMs: 810 }]
    expect(bucketRrToRmssd(rows)).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(bucketRrToRmssd([])).toEqual([])
  })
})

describe('D6 dHRV adapter bucket-grid alignment', () => {
  it('daytimeHrvEstimatesPerBucket and bucketRrToRmssd land on the same absolute grid', () => {
    // A window NOT aligned to a 5-min boundary (starts at :02) — the two sides must still merge.
    const fromMs = new Date('2026-07-27T00:02:17Z').getTime()
    const toMs = fromMs + 15 * 60_000
    const model: DaytimeHrvModel = { intercept: 4.5, hrCoef: -0.01, tempCoef: 0, residualStd: 0.1, nSamples: 100 }
    const hr = [{ tsMs: fromMs + 60_000, bpm: 60 }]
    const temp = [{ tsMs: fromMs + 60_000, valueC: 33.5 }]
    const met = [{ tsMs: fromMs + 60_000, value: 1.0 }]
    const estimates = daytimeHrvEstimatesPerBucket(model, temp, met, hr, fromMs, toMs, 5 * 60_000)
    expect(estimates).toHaveLength(1)
    const oursBucketStart = new Date(estimates[0].t - 2.5 * 60_000).toISOString()

    const rrRows = Array.from({ length: 300 }, (_, i) => ({ at: new Date(fromMs + 60_000 + i * 100), rrMs: 800 }))
    const reference = bucketRrToRmssd(rrRows)
    expect(reference.map(r => r.bucketStart)).toContain(oursBucketStart)
  })
})
