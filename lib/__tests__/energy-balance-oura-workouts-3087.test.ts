// #3087: the energy-balance service counts Oura's own workouts, except the ones a saved log covers.
import { describe, it, expect } from 'vitest'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = shiftDateStr(todayInTz(TZ), -1)
// The workout sits at local midday, so no zone edge moves it to another day.
const at = (hour: number, min = 0) => new Date(dateStrMidnightInTz(DATE, TZ).getTime() + (hour * 60 + min) * 60_000)
const ouraWalk = {
  id: 'w1', day: DATE, activity: 'walking', startDatetime: at(12), endDatetime: at(12, 40),
  calories: null, distanceM: null, intensity: null, source: 'confirmed', reviewed: false,
}

function repo(opts: { oura: unknown[]; logs?: unknown[] }) {
  return {
    listBodyMetrics: async () => [{ date: DATE, weightKg: 80, steps: 9000 }],
    listFoodLogsSummary: async () => [],
    listActivityLogs: async () => opts.logs ?? [],
    getWorkoutSessionsFrom: async () => [],
    getOuraWorkouts: async () => opts.oura,
    getNutritionTargets: async () => null,
    getUserGoals: async () => null,
    getUserById: async () => ({ heightCm: 180, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'maintain' }),
    listDayCheckins: async () => [],
    getBodyFatCalibration: async () => null,
    getLatestMeasuredRmr: async () => null,
    getAvgBpmBySession: async () => new Map<string, number>(),
    listDoseHistory: async () => ({ logs: [], courses: [] }),
  } as unknown as Parameters<typeof computeEnergyBalance>[0]
}

const activity = async (r: ReturnType<typeof repo>) => (await computeEnergyBalance(r, 'u-1', TZ, DATE)).activeBreakdown

describe('energy balance with Oura workouts (#3087)', () => {
  it('costs an Oura walk nobody logged', async () => {
    expect((await activity(repo({ oura: [] }))).activityKcal).toBe(0)
    expect((await activity(repo({ oura: [ouraWalk] }))).activityKcal).toBeGreaterThan(0)
  })

  it('does not cost it again when a saved log covers the same walk', async () => {
    const logs = [{ id: 'l1', date: DATE, activityType: 'walk', startTime: '12:05:00', endTime: '12:45:00', durationMin: 40 }]
    const withLog = await activity(repo({ oura: [ouraWalk], logs }))
    const logOnly = await activity(repo({ oura: [], logs }))
    expect(withLog.activityKcal).toBe(logOnly.activityKcal)
  })
})
