// Shadow model version 6 (#2826 item 4, owner 3 Nov): overnight settling 4.5 → 2 points, and last
// night's sleep duration counts 3 points in Activity as capacity to train.
import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'
import { scoreShadowReadiness, type ShadowScoreInput, type UnitObservation } from '../score'
import { prepareShadowHistory, assembleShadowInputs, type ShadowRawHistory } from '../assemble'
import { PILLAR_POINTS, SHADOW_MODEL_VERSION, UNIT_DEFS } from '../model'

const D = '2026-09-30'
const night = (value: number, source = 'ring'): UnitObservation => ({ date: D, value, source })
const run = (units: ShadowScoreInput['units']) => scoreShadowReadiness({ date: D, units })

describe('version 6: settling at 2 points, sleep duration in Activity', () => {
  it('is version 6', () => {
    expect(SHADOW_MODEL_VERSION).toBe(6)
  })

  it('overnight settling carries 2 points, and Heart is worth 21 (was 23.5)', () => {
    expect(UNIT_DEFS['heart.overnight_settling'].points).toBe(2)
    expect(PILLAR_POINTS.heart).toBeCloseTo(21, 10)
  })

  it('sleep capacity carries 3 points in Activity, which is worth 23 (was 20)', () => {
    const def = UNIT_DEFS['activity.sleep_capacity']
    expect(def).toMatchObject({ pillar: 'activity', points: 3, daytime: false })
    expect(def.band).toEqual(UNIT_DEFS['sleep.duration'].band)
    expect(PILLAR_POINTS.activity).toBeCloseTo(23, 10)
  })

  it('scores last night exactly as sleep duration does, from any source', () => {
    for (const source of ['oura_cloud', 'health_connect', 'manual']) {
      for (const hours of [5, 6.5, 8, 10]) {
        const r = run({
          'sleep.duration': { today: night(hours, source), history: [] },
          'activity.sleep_capacity': { today: night(hours, source), history: [] },
        })
        expect(r.units['activity.sleep_capacity'].score).toBe(r.units['sleep.duration'].score)
      }
    }
  })

  it('a short night lowers Activity, a night in the band does not', () => {
    const activity = (hours: number) => run({ 'activity.sleep_capacity': { today: night(hours), history: [] } }).pillars.activity
    expect(activity(8)).toBe(100)
    expect(activity(5)!).toBeLessThan(activity(8)!)
  })

  it("assembly reads the night keyed to the scored day, from the same series as sleep duration", () => {
    const TZ = 'Australia/Brisbane'
    const sessions: SleepSession[] = Array.from({ length: 5 }, (_, i) => {
      const date = shiftDateStr(D, i - 4)
      const wake = new Date(`${date}T06:30:00+10:00`)
      return {
        id: `n-${date}`, userId: 'u1', date, sleepStart: new Date(wake.getTime() - 7 * 3_600_000), sleepEnd: wake, createdAt: wake,
        durationHours: 6 + i * 0.25, efficiency: 90, durationSource: 'health_connect',
      } as SleepSession
    })
    const raw: ShadowRawHistory = {
      tz: TZ, ageYears: 40, sleepSessions: sessions, bodyMetrics: [], dailySummaries: [], wear: [], derived: [],
      workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
    }
    const prepared = prepareShadowHistory(raw)
    expect(prepared.series['activity.sleep_capacity']).toEqual(prepared.series['sleep.duration'])
    const input = assembleShadowInputs(prepared, D)
    expect(input.units['activity.sleep_capacity']!.today).toEqual(input.units['sleep.duration']!.today)
    expect(input.units['activity.sleep_capacity']!.today?.date).toBe(D)
  })
})
