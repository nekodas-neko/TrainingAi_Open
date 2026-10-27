// #2265: a night the owner marked partial leaves the shadow model's hour-based series and stays in
// its breathing series. The mark is read from the sessions, so unmarking returns the night exactly.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'
import { prepareShadowHistory, type ShadowRawHistory } from '../assemble'

const TZ = 'Australia/Brisbane'
const LAST = '2026-10-20'
const MARK = new Date('2026-10-20T01:00:00Z')

function night(date: string, over: Partial<SleepSession> = {}): SleepSession {
  const wake = new Date(`${date}T06:30:00+10:00`)
  return {
    id: `n-${date}`, userId: 'u1', date,
    sleepStart: new Date(wake.getTime() - 8 * 3_600_000), sleepEnd: wake, createdAt: wake,
    durationHours: 8, timeInBedHours: 8.6, efficiency: 92, onsetLatencySec: 600, restlessPeriods: 3,
    deepSleepHours: 1.4, remSleepHours: 1.8, lightSleepHours: 4.4, awakHours: 0.4,
    averageHrvMs: 50, avgHeartRate: 55, lowestHeartRate: 50, respiratoryRate: 14.5,
    ...over,
  }
}

function raw(sessions: SleepSession[]): ShadowRawHistory {
  return {
    tz: TZ, ageYears: 40, sleepSessions: sessions, bodyMetrics: [], dailySummaries: [], wear: [], derived: [],
    workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
  }
}

const days = Array.from({ length: 10 }, (_, i) => shiftDateStr(LAST, i - 9))
const dated = (series: { date: string }[] | undefined) => (series ?? []).map(o => o.date)

describe('shadow readiness series over a marked night', () => {
  const shortNight = { sleepStart: new Date(`${LAST}T04:40:00+10:00`), sleepEnd: new Date(`${LAST}T07:55:00+10:00`), durationHours: 3.25, efficiency: 84, onsetLatencySec: 1800 }
  const marked = prepareShadowHistory(raw(days.map(d => d === LAST ? night(d, { ...shortNight, partialNightAt: MARK }) : night(d)))).series
  const unmarked = prepareShadowHistory(raw(days.map(d => d === LAST ? night(d, shortNight) : night(d)))).series

  it('drops duration, efficiency, deep/REM share, latency and timing for the marked date', () => {
    for (const unit of ['sleep.duration', 'sleep.efficiency', 'sleep.deep_rem_share', 'sleep.latency', 'sleep.timing'] as const) {
      expect(dated(unmarked[unit]), `${unit} unmarked`).toContain(LAST)
      expect(dated(marked[unit]), `${unit} marked`).not.toContain(LAST)
      // every earlier night is still there
      expect(dated(marked[unit]).length, unit).toBe(dated(unmarked[unit]).length - 1)
    }
  })

  it('averages the week\'s balance over the other nights, so the short night does not pull it down', () => {
    expect(marked['sleep.balance']!.find(o => o.date === LAST)?.value).toBe(8)
    expect(unmarked['sleep.balance']!.find(o => o.date === LAST)!.value).toBeLessThan(8)
  })

  it('keeps the breathing of the marked night', () => {
    expect(dated(marked['body.breathing_rate'])).toContain(LAST)
    expect(marked['body.breathing_rate']!.find(o => o.date === LAST)?.value).toBe(14.5)
  })
})
