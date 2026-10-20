// #3087: the server read behind Oura workouts in the energy budget. It widens Oura's own day key a
// day each side, keeps only the asked range by local day, and never fails the budget it feeds.
import { describe, it, expect, vi } from 'vitest'
import { ouraBudgetActivities } from '../oura-budget-activities'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const day = shiftDateStr(todayInTz(TZ), -2)
// Anchored to local midday; the edge cases sit just inside and outside the day on purpose.
const at = (d: string, hour: number, min = 0) => new Date(dateStrMidnightInTz(d, TZ).getTime() + (hour * 60 + min) * 60_000)
const row = (from: Date, to: Date) => ({
  id: String(from.getTime()), day, activity: 'cycling', startDatetime: from, endDatetime: to,
  calories: null, distanceM: null, intensity: null, source: 'confirmed', reviewed: false,
})
const none = { activityLogs: [], sessions: [] }
const noLogs = async () => []

describe('ouraBudgetActivities (#3087)', () => {
  it('reads a day either side of the range, then keeps the range by local day', async () => {
    const getOuraWorkouts = vi.fn(async () => [
      row(at(day, 12), at(day, 12, 45)),
      row(at(day, -1), at(day, -0.5)),        // 23:00 the night before: another local day
      row(at(day, 23, 30), at(day, 23, 55)),
    ])
    const out = await ouraBudgetActivities({ getOuraWorkouts, listActivityLogs: noLogs }, 'u1', day, day, TZ, none)
    expect(getOuraWorkouts).toHaveBeenCalledWith('u1', { from: shiftDateStr(day, -1), to: shiftDateStr(day, 1) })
    expect(out.map(a => a.date)).toEqual([day, day])
  })

  it('degrades to nothing when the read fails, and when it throws outright', async () => {
    expect(await ouraBudgetActivities({ getOuraWorkouts: async () => { throw new Error('db down') }, listActivityLogs: noLogs }, 'u1', day, day, TZ, none)).toEqual([])
    const throwsSync = { getOuraWorkouts: (() => { throw new TypeError('not a function') }) as never, listActivityLogs: noLogs }
    expect(await ouraBudgetActivities(throwsSync, 'u1', day, day, TZ, none)).toEqual([])
  })

  // A log that crosses midnight is dated the evening before the range, so the caller never loaded
  // it; its Oura copy starts after midnight, on the range's first day.
  it('matches a 23:30-00:30 log from the evening before the range', async () => {
    const getOuraWorkouts = async () => [row(at(day, 0, 5), at(day, 0, 25))]
    const listActivityLogs = vi.fn(async () => [{ date: shiftDateStr(day, -1), startTime: '23:30:00', endTime: '00:30:00', durationMin: 60 }])
    expect(await ouraBudgetActivities({ getOuraWorkouts, listActivityLogs } as never, 'u1', day, day, TZ, none)).toEqual([])
    expect(listActivityLogs).toHaveBeenCalledWith('u1', shiftDateStr(day, -1), shiftDateStr(day, -1))
    // Without that log the same workout counts.
    expect(await ouraBudgetActivities({ getOuraWorkouts, listActivityLogs: noLogs }, 'u1', day, day, TZ, none)).toHaveLength(1)
  })

  it('still counts the workout when that read fails, and skips it when there is no workout', async () => {
    const failing = vi.fn(async () => { throw new Error('db down') })
    expect(await ouraBudgetActivities({ getOuraWorkouts: async () => [row(at(day, 12), at(day, 12, 40))], listActivityLogs: failing }, 'u1', day, day, TZ, none)).toHaveLength(1)
    failing.mockClear()
    expect(await ouraBudgetActivities({ getOuraWorkouts: async () => [], listActivityLogs: failing }, 'u1', day, day, TZ, none)).toEqual([])
    expect(failing).not.toHaveBeenCalled()
  })
})
