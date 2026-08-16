import { describe, it, expect } from 'vitest'
import { computeVolumeAcwr, computeMonotonyStrain, acwrBand, acwrBandByKey, type AcwrSession } from '@trainingai/shared/ai-periodization/acwr'

// AEST midnight for 2026-07-01 as a UTC instant (GMT+10)
const todayMid = new Date('2026-06-30T14:00:00.000Z')
const daysAgo = (d: number, plusHours = 2) =>
  new Date(todayMid.getTime() - d * 86_400_000 + plusHours * 3_600_000)
const s = (startedAt: Date, volumeKg = 1000): AcwrSession => ({ startedAt, volumeKg })

describe('computeVolumeAcwr', () => {
  it('divides chronic load by the REAL data span, not a flat 4 weeks', () => {
    // 6 × 1000kg sessions spanning 21 days: earliest 21d ago → dataSpanWeeks = 3
    // chronic = 6000 / 3 = 2000 kg/wk; acute (last 7d) = sessions at 6d and 2d ago = 2000 kg
    // acwr = 2000 / 2000 = 1.0  (the old flat ÷4 rule would report 6000/4=1500 → 1.33)
    const sessions = [21, 18, 14, 10, 6, 2].map(d => s(daysAgo(d)))
    const r = computeVolumeAcwr(sessions, todayMid)
    expect(r.dataSpanWeeks).toBeCloseTo(3, 1)
    expect(r.chronicWeeklyAvgKg).toBeCloseTo(2000, 0)
    expect(r.acuteLoadKg).toBe(2000)
    expect(r.acwr).toBeCloseTo(1.0, 5)
  })

  it('returns a null ratio (but real loads) below 21 days of span or 6 sessions', () => {
    const young = [14, 10, 6, 2, 1, 0.5].map(d => s(daysAgo(d)))   // span 14d < 21d
    expect(computeVolumeAcwr(young, todayMid).acwr).toBeNull()
    const few = [21, 14, 7, 3, 1].map(d => s(daysAgo(d)))          // only 5 sessions
    expect(computeVolumeAcwr(few, todayMid).acwr).toBeNull()
    expect(computeVolumeAcwr(few, todayMid).acuteLoadKg).toBeGreaterThan(0)
  })

  it('returns null with a trivial chronic load (< 100 kg/wk) and with no sessions', () => {
    const tiny = [21, 18, 14, 10, 6, 2].map(d => s(daysAgo(d), 10)) // 60kg over 3wk = 20 kg/wk
    expect(computeVolumeAcwr(tiny, todayMid).acwr).toBeNull()
    expect(computeVolumeAcwr([], todayMid).acwr).toBeNull()
  })

  it('todayVolumeKg only counts sessions on or after local midnight (C10 date-window)', () => {
    const sessions: AcwrSession[] = [
      s(new Date('2026-06-30T13:59:00.000Z'), 500),  // 11:59pm June 30 AEST → yesterday, excluded
      s(new Date('2026-06-30T23:00:00.000Z'), 800),  // 9am July 1 AEST → today, included
      ...[21, 18, 14, 10, 6].map(d => s(daysAgo(d))),
    ]
    expect(computeVolumeAcwr(sessions, todayMid).todayVolumeKg).toBe(800)
  })

  it('typicalSessionVolumeKg is the median session volume', () => {
    const sessions = [s(daysAgo(10), 500), s(daysAgo(6), 1000), s(daysAgo(2), 3000)]
    expect(computeVolumeAcwr(sessions, todayMid).typicalSessionVolumeKg).toBe(1000)
  })
})

describe('acwrBand', () => {
  it('bands at the agreed thresholds — the single set consumed everywhere', () => {
    expect(acwrBand(0.5).key).toBe('low')
    expect(acwrBand(0.79).key).toBe('low')
    expect(acwrBand(0.8).key).toBe('optimal')
    expect(acwrBand(1.0).key).toBe('optimal')
    expect(acwrBand(1.3).key).toBe('optimal')
    expect(acwrBand(1.31).key).toBe('high')
    expect(acwrBand(1.5).key).toBe('high')
    expect(acwrBand(1.51).key).toBe('very_high')
  })

  it('acwrBandByKey returns a representative band for each server-reported key', () => {
    expect(acwrBandByKey('low').label).toBe('Undertraining')
    expect(acwrBandByKey('optimal').label).toBe('Optimal')
    expect(acwrBandByKey('high').label).toBe('High')
    expect(acwrBandByKey('very_high').label).toBe('Very High')
  })
})

describe('computeMonotonyStrain', () => {
  it('computes mean/SD monotony and weeklyLoad × monotony strain', () => {
    // 3 training days (1000kg) + 4 rest days (0kg) over a week
    const r = computeMonotonyStrain([0, 1000, 0, 1000, 0, 1000, 0])
    expect(r.weeklyLoadKg).toBe(3000)
    expect(r.monotony).toBeCloseTo(0.866, 2)
    expect(r.strain).toBeCloseTo(2598, 0)
  })

  it('returns null monotony/strain (but a real weeklyLoadKg) when load is identical every day', () => {
    // SD = 0 → mean/SD is undefined, not "infinite monotony"
    const r = computeMonotonyStrain([500, 500, 500, 500, 500, 500, 500])
    expect(r.monotony).toBeNull()
    expect(r.strain).toBeNull()
    expect(r.weeklyLoadKg).toBe(3500)
  })

  it('returns all-null/zero for an empty window', () => {
    expect(computeMonotonyStrain([])).toEqual({ monotony: null, strain: null, weeklyLoadKg: 0 })
  })
})
