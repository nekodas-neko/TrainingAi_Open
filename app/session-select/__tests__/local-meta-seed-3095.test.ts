// #3095: Home's local seed painted today's steps without the treadmill session's while its own week
// tile included them, so on a treadmill day today's figure jumped when `/api/body-metadata` answered.
// The seed now builds both through the route's shared step builder.
import { describe, it, expect } from 'vitest'
import { localMetaSeed } from '../local-meta-seed'
import type { LocalActivityLog, LocalBodyMetric } from '@/lib/local-store/types'
import { shiftDateStr, startOfWeekInTz, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
// From the clock, never hardcoded: "today" and the week start are the user's, as Home computes them.
const today = todayInTz(TZ)
const weekStart = startOfWeekInTz(TZ)

const metric = (date: string, steps: number | null): LocalBodyMetric => ({
  date, steps, weightKg: null, bodyFatPct: null, calories: 2000, proteinG: null, carbsG: null, fatG: null,
  waterMl: 1500, restingHeartRate: null, hrvMs: null, spo2Pct: null, distanceKm: null, waistCm: null,
  chestCm: null, armCm: null, thighCm: null, hipCm: null, neckCm: null, skeletalMusclePct: null,
  fatFreeMassKg: null, subcutaneousFatPct: null, visceralFatIndex: null, bodyWaterPct: null,
  muscleMassKg: null, boneMassKg: null, proteinPct: null, bmrKcal: null, metabolicAge: null,
  updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'synced',
})

// Sessions start at local midday, so no window edge can move them to another day.
const activity = (date: string, activityType: string, steps: number | null): LocalActivityLog => ({
  id: `${activityType}-${date}`, date, activityType, title: activityType, durationMin: 40, distanceKm: 3,
  steps, avgHr: null, maxHr: null, caloriesBurned: null, startTime: '12:00', endTime: '12:40', notes: null,
  routePolyline: null, splits: null, bestEfforts: null, paceSeries: null, avgPaceSecPerKm: null,
  elevationGainM: null, elevationLossM: null, elevationProfile: null, cadenceSpm: null, cadenceSeries: null,
  cadenceSource: null, segments: null, updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'synced',
} as LocalActivityLog)

describe('Home local seed (#3095)', () => {
  it('folds a treadmill session into today, as the route does, and keeps the device count apart', () => {
    const seed = localMetaSeed([metric(today, 9_000)], [activity(today, 'treadmill', 3_500)], today, weekStart)
    expect(seed.today?.steps).toBe(12_500)
    expect(seed.today?.deviceSteps).toBe(9_000)
  })

  it('leaves a GPS walk out of today and the week, and sets no deviceSteps', () => {
    const seed = localMetaSeed([metric(today, 9_000)], [activity(today, 'walk', 4_100)], today, weekStart)
    expect(seed.today?.steps).toBe(9_000)
    expect(seed.today?.deviceSteps).toBeUndefined()
    expect(seed.weekToDate.steps).toBe(9_000)
  })

  it('makes today and the week agree on a treadmill day', () => {
    const seed = localMetaSeed([metric(today, 9_000)], [activity(today, 'treadmill', 3_500)], today, weekStart)
    expect(seed.weekToDate.steps).toBe(seed.today?.steps)
  })

  it('counts the week from the given week start only', () => {
    const before = shiftDateStr(weekStart, -1)
    const seed = localMetaSeed(
      [metric(before, 7_000), metric(today, 9_000)],
      [activity(before, 'treadmill', 2_000), activity(today, 'treadmill', 3_500)],
      today, weekStart,
    )
    expect(seed.weekToDate.steps).toBe(12_500)
    expect(seed.recent.map(r => r.date)).toEqual([before, today])
  })

  it('has no today row when the store holds none', () => {
    const seed = localMetaSeed([metric(shiftDateStr(today, -1), 7_000)], [], today, weekStart)
    expect(seed.today).toBeNull()
  })
})
