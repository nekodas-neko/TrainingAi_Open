// lib/health/__tests__/hr-window-merge.test.ts
import { describe, it, expect } from 'vitest'
import {
  preferStrapBuckets, mergeHrSources, yieldAggregatorToDevice, isAggregatorHrSource, AGGREGATOR_HR_SOURCES,
} from '@trainingai/shared/health/hr-window-merge'

const t = (s: number) => new Date(2026, 6, 16, 10, 0, s)
const row = (sec: number, bpm: number, source: string | null) => ({ timestamp: t(sec), bpm, source })

describe('preferStrapBuckets', () => {
  it('keeps all rows when sources do not overlap in time', () => {
    const rows = [row(0, 80, 'ble'), row(60, 90, 'chest_strap')]
    expect(preferStrapBuckets(rows)).toEqual(rows)
  })

  it('drops ring rows in buckets a strap row covers', () => {
    const rows = [row(0, 80, 'ble'), row(3, 132, 'chest_strap'), row(5, 82, 'ble')]
    expect(preferStrapBuckets(rows)).toEqual([row(3, 132, 'chest_strap')])
  })

  it('keeps every strap row within a bucket (no thinning of the dense stream)', () => {
    const rows = [row(0, 130, 'chest_strap'), row(1, 131, 'chest_strap'), row(2, 78, 'ble')]
    expect(preferStrapBuckets(rows)).toEqual([row(0, 130, 'chest_strap'), row(1, 131, 'chest_strap')])
  })

  it('returns rows sorted by timestamp', () => {
    const rows = [row(0, 80, 'ble'), row(11, 133, 'chest_strap'), row(15, 82, 'ble')]
    const out = preferStrapBuckets(rows)
    expect(out.map(r => r.timestamp.getTime())).toEqual([...out.map(r => r.timestamp.getTime())].sort((a, b) => a - b))
  })
})

// #2168 — Health Connect's HR series shares this table. Ingest architecture D2: rank decides which
// source a score reads per interval, and the loser is kept. These cover the read half.
describe('yieldAggregatorToDevice / mergeHrSources', () => {
  const min = (m: number) => m * 60

  it('takes the aggregator tier from the source ladder, not a second list', () => {
    expect([...AGGREGATOR_HR_SOURCES].sort()).toEqual(['apple_health', 'health_connect'])
    expect(isAggregatorHrSource('health_connect')).toBe(true)
    expect(isAggregatorHrSource('apple_health')).toBe(true)
    for (const device of ['ble', 'chest_strap', 'awake', null]) expect(isAggregatorHrSource(device)).toBe(false)
  })

  it('passes an aggregator series through untouched when no device row is in the window', () => {
    const rows = [row(0, 70, 'health_connect'), row(min(10), 90, 'health_connect')]
    expect(mergeHrSources(rows)).toEqual(rows)
  })

  it('drops an aggregator row within five minutes of a device row, either side, inclusive', () => {
    const ringAt = min(30)
    const rows = [
      row(ringAt - min(5) - 1, 101, 'health_connect'), // just outside, before: kept
      row(ringAt - min(5), 102, 'health_connect'),     // exactly on the edge: dropped
      row(ringAt - 1, 103, 'health_connect'),
      row(ringAt, 60, 'ble'),
      row(ringAt + min(5), 104, 'health_connect'),     // exactly on the edge: dropped
      row(ringAt + min(5) + 1, 105, 'health_connect'), // just outside, after: kept
    ]
    expect(mergeHrSources(rows).map(r => r.bpm)).toEqual([101, 60, 105])
  })

  it('never drops a device row, whatever aggregator rows sit beside it', () => {
    const rows = [row(0, 150, 'health_connect'), row(1, 61, 'ble'), row(2, 120, 'chest_strap'), row(3, 62, null)]
    const out = yieldAggregatorToDevice(rows)
    expect(out).toEqual([row(1, 61, 'ble'), row(2, 120, 'chest_strap'), row(3, 62, null)])
  })

  it('treats Apple Health like Health Connect and a NULL-source row like a device', () => {
    const rows = [row(0, 64, null), row(30, 140, 'apple_health')]
    expect(yieldAggregatorToDevice(rows)).toEqual([row(0, 64, null)])
  })

  it('still lets the strap win its bucket over the ring after the aggregator rule', () => {
    const rows = [row(0, 80, 'ble'), row(3, 132, 'chest_strap'), row(4, 150, 'health_connect')]
    expect(mergeHrSources(rows)).toEqual([row(3, 132, 'chest_strap')])
  })

  it('reads a day the ring covers from the ring alone', () => {
    // The owner's shape: 5-minute ring bins for 16 hours, with a dense and very different Health
    // Connect series laid over the same hours. Whatever the aggregator says, the merge is the ring.
    const ring = Array.from({ length: 12 * 16 }, (_, i) => row(min(5 * i), 60 + (i % 40) * 2, 'ble'))
    const hc = Array.from({ length: 60 * 16 }, (_, i) => row(min(i) + 17, 175, 'health_connect'))
    expect(mergeHrSources([...hc, ...ring])).toEqual(preferStrapBuckets(ring))
  })

  it('lets an aggregator fill a gap the ring left, and only the gap', () => {
    // Ring rows at 0 and 30 min. The aggregator is read only where no device row is within five
    // minutes: 6, 15 and 24 are in; 2 and 28 are not.
    const rows = [
      row(0, 60, 'ble'),
      ...[2, 6, 15, 24, 28].map(m => row(min(m), 110, 'health_connect')),
      row(min(30), 62, 'ble'),
    ]
    expect(mergeHrSources(rows).map(r => (r.timestamp.getTime() - t(0).getTime()) / 60_000)).toEqual([0, 6, 15, 24, 30])
  })
})
