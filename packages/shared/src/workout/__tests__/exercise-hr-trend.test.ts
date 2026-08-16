import { describe, it, expect } from 'vitest'
import { aggregateExerciseHrTrend } from '../exercise-hr-trend'
import type { SetHrStatsRow } from '@/lib/data/repository'

function row(over: Partial<SetHrStatsRow>): SetHrStatsRow {
  return {
    setLogId: 'x', workoutSessionId: 'w', exerciseLogId: 'e', exerciseId: 'exid', exerciseName: 'Bench',
    phaseType: 'peak', setNumber: 1, intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date('2026-07-10T00:00:00Z'),
    peakBpm: 170, avgBpm: 150, bpmAtEnd: 165, drop30s: 20, drop60s: 30, drop90s: 40, drop120s: 45,
    troughBpm: 120, secToPreset: 50, recoveredPreset: true, secToResting: null, recoveredResting: false,
    pctHrrAtRestEnd: 60, secToHrr50: 25, restAdequate: true, readingsCount: 40, coverageOk: true,
    computedAt: new Date(), ...over,
  }
}

describe('aggregateExerciseHrTrend', () => {
  it('rolls per-set rows up to one point per session, oldest-first', () => {
    const rows = [
      row({ workoutSessionId: 'w1', loggedAt: new Date('2026-07-10T00:00:00Z'), peakBpm: 160, drop60s: 25 }),
      row({ workoutSessionId: 'w1', loggedAt: new Date('2026-07-10T00:05:00Z'), peakBpm: 170, drop60s: 35 }),
      row({ workoutSessionId: 'w2', loggedAt: new Date('2026-07-17T00:00:00Z'), peakBpm: 175, drop60s: 40 }),
    ]
    const out = aggregateExerciseHrTrend(rows)
    expect(out.sessions.map(s => s.date)).toEqual(['2026-07-10', '2026-07-17'])
    const [s1, s2] = out.sessions
    expect(s1.setCount).toBe(2)
    expect(s1.avgPeakBpm).toBe(165)   // mean(160,170)
    expect(s1.maxPeakBpm).toBe(170)
    expect(s1.avgDrop60).toBe(30)     // mean(25,35)
    expect(s1.bestDrop60).toBe(35)
    expect(s1.avgDrop30).toBe(20)     // recovery-curve points (row() defaults)
    expect(s1.avgDrop90).toBe(40)
    expect(s1.avgDrop120).toBe(45)
    expect(s2.avgPeakBpm).toBe(175)
  })

  it('excludes non-covered sets from metric means but counts them', () => {
    const rows = [
      row({ workoutSessionId: 'w1', peakBpm: 170, coverageOk: true }),
      row({ workoutSessionId: 'w1', peakBpm: 999, coverageOk: false }), // sparse — ignored in means
    ]
    const [s1] = aggregateExerciseHrTrend(rows).sessions
    expect(s1.setCount).toBe(2)
    expect(s1.coveredSets).toBe(1)
    expect(s1.avgPeakBpm).toBe(170) // 999 excluded
  })

  it('breaks down by intensity band', () => {
    const rows = [
      row({ intensityPct: 72, drop60s: 40, peakBpm: 150 }),
      row({ intensityPct: 90, drop60s: 22, peakBpm: 175 }),
      row({ intensityPct: 92, drop60s: 24, peakBpm: 178 }),
    ]
    const buckets = aggregateExerciseHrTrend(rows).byIntensity
    const b70 = buckets.find(b => b.label === '70–79')!
    const b90 = buckets.find(b => b.label === '90+')!
    expect(b70.n).toBe(1)
    expect(b70.avgDrop60).toBe(40)
    expect(b90.n).toBe(2)
    expect(b90.avgDrop60).toBe(23) // mean(22,24)
    expect(buckets.some(b => b.label === '80–89')).toBe(false) // empty bands dropped
  })
})
