// #3601 — the remaining per-device normals are keyed by (source, the source's algorithm version), the
// version read from the same night's sleep when the same source recorded it. With one version per
// source (production today) every reader gives exactly what it gave before; a second version splits
// the normal at the change. Synthetic values and generic source names only.
import { describe, it, expect } from 'vitest'
import { nightAlgorithmVersion, rowsOfDeviceInUse } from '../per-device-normal'
import { meanRestingHr } from '../resting-hr-mean'
import { restingHrBaseline } from '../activity-day'

const day = (i: number) => `2026-10-${String(i).padStart(2, '0')}`
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i)
const noWearGaps = new Map<string, { nonWearSec: number }>()

/** Body-metric rows from `source_a`, `bpm` and `hrv` per night. */
const metrics = (days: number[], bpm: number, hrv: number, source = 'source_a') =>
  days.map(d => ({ date: day(d), restingHeartRate: bpm, restingHeartRateSource: source, hrvMs: hrv, hrvSource: source }))
/** Sleep rows the version comes from. */
const sleep = (days: number[], version: string | null, source = 'source_a') =>
  days.map(d => ({ date: day(d), durationSource: source, sourceAlgorithmVersion: version }))

describe('nightAlgorithmVersion', () => {
  const versionOn = nightAlgorithmVersion([
    ...sleep([1], '1'),
    ...sleep([2], '2', 'source_b'),
    ...sleep([3], null),
  ])
  it('reads the version of the same source on the same date', () => {
    expect(versionOn(day(1), 'source_a')).toBe('1')
    expect(versionOn(day(2), 'source_b')).toBe('2')
  })
  it('gives none for another source, another date, or a night that sent none', () => {
    expect(versionOn(day(1), 'source_b')).toBeNull()
    expect(versionOn(day(2), 'source_a')).toBeNull()
    expect(versionOn(day(3), 'source_a')).toBeNull()
    expect(versionOn(day(9), 'source_a')).toBeNull()
  })
  it('finds the version among several windows of the date', () => {
    const v = nightAlgorithmVersion([...sleep([4], null, 'source_b'), ...sleep([4], '3')])
    expect(v(day(4), 'source_a')).toBe('3')
  })
})

describe('rowsOfDeviceInUse with a version accessor', () => {
  const rows = metrics(range(1, 20), 50, 40)
  const value = (r: typeof rows[number]) => r.hrvMs
  const src = (r: typeof rows[number]) => r.hrvSource
  it('one version: the same rows as without the accessor', () => {
    const versionOn = nightAlgorithmVersion(sleep(range(1, 20), '1'))
    expect(rowsOfDeviceInUse(rows, value, src, r => versionOn(r.date, r.hrvSource))).toEqual(rowsOfDeviceInUse(rows, value, src))
  })
  it('two versions: only the newest version’s rows', () => {
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 6), '2')])
    const out = rowsOfDeviceInUse(rows, value, src, r => versionOn(r.date, r.hrvSource))
    expect(out.map(r => r.date)).toEqual(range(15, 6).map(day))
  })
  it('a reading with no version joins the newest version its source has sent', () => {
    // Nights 1–14 under v1, 15–17 under v2, 18–20 with no version (and none of their sleep stored).
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 3), '2')])
    const out = rowsOfDeviceInUse(rows, value, src, r => versionOn(r.date, r.hrvSource))
    expect(out.map(r => r.date)).toEqual(range(15, 6).map(day))
  })
  it('is order-independent: the repository returns newest first', () => {
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 6), '2')])
    const out = rowsOfDeviceInUse([...rows].reverse(), value, src, r => versionOn(r.date, r.hrvSource))
    expect(out.map(r => r.date).sort()).toEqual(range(15, 6).map(day))
  })
  it('a history with no versions at all is the per-source result', () => {
    const versionOn = nightAlgorithmVersion([])
    expect(rowsOfDeviceInUse(rows, value, src, r => versionOn(r.date, r.hrvSource))).toEqual(rowsOfDeviceInUse(rows, value, src))
  })
})

describe('meanRestingHr keyed by version (Body Battery’s resting HR)', () => {
  const rows = [...metrics(range(1, 14), 52, 40), ...metrics(range(15, 14), 58, 40)]
  it('one version: the same mean as before', () => {
    const versionOn = nightAlgorithmVersion(sleep(range(1, 28), '1'))
    expect(meanRestingHr(rows, versionOn)).toBe(meanRestingHr(rows))
    expect(meanRestingHr(rows, versionOn)).toBe(55)
  })
  it('two versions: the new version’s own mean once it has the nights', () => {
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 14), '2')])
    expect(meanRestingHr(rows, versionOn)).toBe(58)          // pooled: 55
  })
  it('two versions, the new one still warming: the previous version’s mean carries over', () => {
    const young = [...metrics(range(1, 14), 52, 40), ...metrics(range(15, 4), 58, 40)]
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 4), '2')])
    expect(meanRestingHr(young, versionOn)).toBe(52)
  })
})

describe('restingHrBaseline keyed by version (the readiness payload’s resting-HR baseline)', () => {
  const rows = [...metrics(range(1, 14), 52, 40), ...metrics(range(15, 6), 60, 40)]
  it('one version: the same baseline as before', () => {
    const versionOn = nightAlgorithmVersion(sleep(range(1, 20), '1'))
    expect(restingHrBaseline(rows, noWearGaps, versionOn)).toBe(restingHrBaseline(rows, noWearGaps))
  })
  it('two versions: the new version’s own baseline, never pooled', () => {
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 6), '2')])
    expect(restingHrBaseline(rows, noWearGaps, versionOn)).toBe(60)
  })
  it('two versions, the new one under 5 days: not yet known', () => {
    const versionOn = nightAlgorithmVersion([...sleep(range(1, 14), '1'), ...sleep(range(15, 6), '2')])
    expect(restingHrBaseline(rows.slice(0, 18), noWearGaps, versionOn)).toBeNull()
  })
})
