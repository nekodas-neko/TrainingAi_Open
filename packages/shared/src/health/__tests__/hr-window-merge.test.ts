// lib/health/__tests__/hr-window-merge.test.ts
import { describe, it, expect } from 'vitest'
import { preferStrapBuckets } from '@trainingai/shared/health/hr-window-merge'

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
