import { describe, it, expect } from 'vitest'
import { computeObservedHr } from '@trainingai/shared/health/observed-hr'
import { computeHrRecoveryProfile } from '../compute-hr-recovery-profile'
import type { WorkoutRepository, SetHrStatsRow } from '@/lib/data/repository'
import type { HrReading } from '@trainingai/shared/workout/hr-analysis'

function setRow(over: Partial<SetHrStatsRow>): SetHrStatsRow {
  return {
    setLogId: 'x', workoutSessionId: 'w', exerciseLogId: 'e', exerciseId: null, exerciseName: 'Bench',
    phaseType: null, setNumber: 1, intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date('2026-05-10T00:00:00Z'),
    peakBpm: 130, avgBpm: 120, bpmAtEnd: 128, drop30s: 10, drop60s: 20, drop90s: 28, drop120s: 34,
    troughBpm: 120, secToPreset: 50, recoveredPreset: true, secToResting: null, recoveredResting: null,
    pctHrrAtRestEnd: 60, secToHrr50: 25, hrr1Bpm: null, restAdequate: true, readingsCount: 40, coverageOk: true,
    plannedReps: null, source: null, computedAt: new Date(), ...over,
  }
}

function stubRepo(over: Partial<WorkoutRepository>): WorkoutRepository {
  return {
    getSetHrStatsSince: async () => [],
    getOuraWorkouts: async () => [],
    getUserById: async () => null,
    listBodyMetrics: async () => [],
    getHrForWindow: async () => [],
    getObservedHrProfile: async () => computeObservedHr([]),
    ...over,
  } as unknown as WorkoutRepository
}

describe('computeHrRecoveryProfile', () => {
  it('merges set_hr_stats episodes into the profile and trend', async () => {
    const repo = stubRepo({
      getSetHrStatsSince: async () => [setRow({}), setRow({ peakBpm: 140, drop120s: 44 })],
    })
    const { profile, trend } = await computeHrRecoveryProfile(repo, 'u1', 'Australia/Brisbane', 180)
    expect(profile.totalEpisodes).toBe(2)
    expect(profile.bands.find(b => b.label === '120–149')?.n).toBe(2)
    expect(trend.find(t => t.label === '120–149')?.points.length).toBeGreaterThan(0)
  })

  it('detects and merges workout-cooldown episodes alongside set episodes', async () => {
    const workoutStart = new Date('2026-05-15T06:00:00Z')
    const workoutEnd = new Date('2026-05-15T06:30:00Z')
    const readings: HrReading[] = [
      { timestamp: new Date(workoutStart.getTime()), bpm: 90 },
      { timestamp: new Date(workoutStart.getTime() + 10 * 60_000), bpm: 150 },
      { timestamp: new Date(workoutEnd.getTime()), bpm: 172 },
      { timestamp: new Date(workoutEnd.getTime() + 30_000), bpm: 155 },
      { timestamp: new Date(workoutEnd.getTime() + 60_000), bpm: 140 },
    ]
    const repo = stubRepo({
      getSetHrStatsSince: async () => [setRow({})],
      getOuraWorkouts: async () => [{
        id: 'wk1', day: '2026-05-15', activity: 'running',
        startDatetime: workoutStart, endDatetime: workoutEnd,
        calories: null, distanceM: null, intensity: null, source: 'oura', reviewed: false,
      }],
      getHrForWindow: async () => readings,
      getUserById: async () => ({ dateOfBirth: null } as never),
    })
    const { profile } = await computeHrRecoveryProfile(repo, 'u1', 'Australia/Brisbane', 180)
    const b170 = profile.bands.find(b => b.label === '150+')!
    expect(b170.bySource.run_cooldown).toBe(1)
  })

  it('no data anywhere -> empty profile and trend, no throw', async () => {
    const repo = stubRepo({})
    const { profile, trend } = await computeHrRecoveryProfile(repo, 'u1', 'Australia/Brisbane', 180)
    expect(profile.totalEpisodes).toBe(0)
    expect(trend).toEqual([])
  })
})

// The window starts at the user's local midnight `days` days ago, for sets and workouts alike. It used
// to be `now − days × 24 h` for sets, which dropped a set logged early on the first day.
describe('computeHrRecoveryProfile window (local midnight)', () => {
  it('asks for sets from local midnight and workouts from the same day', async () => {
    const tz = 'Australia/Brisbane'
    let setsSince: Date | null = null
    let workoutRange: { from: string; to: string } | null = null
    const repo = stubRepo({
      getSetHrStatsSince: async (_u: string, since: Date) => { setsSince = since; return [] },
      getOuraWorkouts: async (_u: string, range: { from: string; to: string }) => { workoutRange = range; return [] },
    } as Partial<WorkoutRepository>)
    await computeHrRecoveryProfile(repo, 'u1', tz, 30)
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    const fromDay = shiftDateStr(todayInTz(tz), -30)
    expect(workoutRange).toEqual({ from: fromDay, to: todayInTz(tz) })
    // Midnight of that day in Brisbane is 14:00 UTC the day before.
    expect(setsSince!.toISOString()).toBe(`${shiftDateStr(fromDay, -1)}T14:00:00.000Z`)
  })
})
