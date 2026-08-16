import { describe, it, expect } from 'vitest'
import { bucketZoneMinutesByWeek, buildEfficiencyCurve, buildCadenceTrend } from '../cardio-trends'

describe('bucketZoneMinutesByWeek', () => {
  it('sums same-week days into one bucket', () => {
    const days = [
      { day: '2026-07-20', seconds: [60, 120, 0, 0, 0] as [number, number, number, number, number] },
      { day: '2026-07-21', seconds: [0, 60, 60, 0, 0] as [number, number, number, number, number] },
    ]
    const result = bucketZoneMinutesByWeek(days)
    expect(result).toEqual([{ weekStart: '2026-07-20', seconds: [60, 180, 60, 0, 0] }])
  })

  it('splits days across a week boundary into separate buckets, sorted ascending', () => {
    const days = [
      { day: '2026-07-26', seconds: [0, 100, 0, 0, 0] as [number, number, number, number, number] }, // Sun, week of 07-20
      { day: '2026-07-27', seconds: [0, 50, 0, 0, 0] as [number, number, number, number, number] },  // Mon, week of 07-27
    ]
    const result = bucketZoneMinutesByWeek(days)
    expect(result).toEqual([
      { weekStart: '2026-07-20', seconds: [0, 100, 0, 0, 0] },
      { weekStart: '2026-07-27', seconds: [0, 50, 0, 0, 0] },
    ])
  })

  it('returns an empty array for no days', () => {
    expect(bucketZoneMinutesByWeek([])).toEqual([])
  })
})

describe('buildEfficiencyCurve', () => {
  it('includes only runs with both avgHr and avgPaceSecPerKm, sorted oldest first', () => {
    const logs = [
      { date: '2026-07-20', avgHr: 150, avgPaceSecPerKm: 330 },
      { date: '2026-07-15', avgHr: undefined, avgPaceSecPerKm: 300 },
      { date: '2026-07-10', avgHr: 145, avgPaceSecPerKm: 340 },
    ]
    expect(buildEfficiencyCurve(logs)).toEqual([
      { date: '2026-07-10', avgHr: 145, avgPaceSecPerKm: 340 },
      { date: '2026-07-20', avgHr: 150, avgPaceSecPerKm: 330 },
    ])
  })
})

describe('buildCadenceTrend', () => {
  it('includes only runs with a cadenceSpm value, sorted oldest first', () => {
    const logs = [
      { date: '2026-07-20', cadenceSpm: 168 },
      { date: '2026-07-10', cadenceSpm: undefined },
      { date: '2026-07-05', cadenceSpm: 172 },
    ]
    expect(buildCadenceTrend(logs)).toEqual([
      { date: '2026-07-05', cadenceSpm: 172 },
      { date: '2026-07-20', cadenceSpm: 168 },
    ])
  })
})
