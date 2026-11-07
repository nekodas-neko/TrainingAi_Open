// #3661 — Week in review's sleep reads the nights the Sleep score grades, and the score the day stored.
//
// Hours: a nap is not a night. The week's hours and each day's bar come from one night per date
// (`canonicalNightForDate(nightSessions(...))`), as the score and the sleep card pick it.
// Score: the week's Sleep score is the stored daily score (`oura_daily_derived.sleep_score`). It used
// to re-score each night over the 14 days this route fetches, against the stored score's 28, so a
// recap night could read differently from the day the owner saw.
//
// Synthetic fixtures only; the clock is fixed. No model is called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { scoreSleepForDate } from '@trainingai/shared/health/sleep-score-for-date'
import type { SleepSession } from '@trainingai/shared/types/body'

let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

import { computeWeeklyDigestMetrics } from '@/app/api/weekly-digest/metrics'

const TZ = 'Australia/Brisbane'
// Wednesday local noon. Recap week Mon 6 – Sun 12 July; prior week 29 June – 5 July.
const NOW = new Date('2026-07-15T02:00:00Z')
const RECAP = Array.from({ length: 7 }, (_, i) => shiftDateStr('2026-07-06', i))
const H = 3_600_000

/** A wake date's local clock time, `h` hours after its midnight (negative = the evening before). */
const local = (date: string, h: number) => new Date(dateStrMidnightInTz(date, TZ).getTime() + h * H)

function session(date: string, id: string, startH: number, hours: number, extra: Partial<SleepSession> = {}): SleepSession {
  return {
    id, userId: 'u1', date, sleepStart: local(date, startH), sleepEnd: local(date, startH + hours),
    durationHours: hours, createdAt: local(date, 12), ...extra,
  }
}

/** Deterministic variety, so baselines over 14 and 28 days differ. */
const wobble = (i: number, span: number) => ((i * 37) % 11) / 10 * span

function nights(count: number, endDate: string): SleepSession[] {
  return Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k
    const date = shiftDateStr(endDate, -i)
    const hours = 6.4 + wobble(i, 1.4)
    // One fragmented recap night: half of it awake.
    const awake = date === '2026-07-11' ? 3.5 : 0.3 + wobble(i + 3, 0.4)
    return session(date, `n${date}`, -1.5, hours, {
      efficiency: date === '2026-07-11' ? 55 : 86 + Math.round(wobble(i, 8)),
      deepSleepHours: hours * 0.18, remSleepHours: hours * 0.22, lightSleepHours: hours * 0.55, awakHours: awake,
      onsetLatencySec: 600 + Math.round(wobble(i + 1, 900)),
      averageHrvMs: 45 + Math.round(wobble(i + 2, 25)), avgHeartRate: 54 + Math.round(wobble(i + 4, 8)),
      lowestHeartRate: 47 + Math.round(wobble(i + 5, 6)), restlessPeriods: 10 + Math.round(wobble(i, 10)),
      respiratoryRate: 14.5,
    })
  })
}

function stubRepo(sleep: SleepSession[], derived: { day: string; sleepScore: number | null }[]) {
  return {
    getWorkoutSessionsFrom: async () => [],
    listBodyMetrics: async () => [],
    listSleepSessions: async (_u: string, from: string, to: string) => sleep.filter(s => s.date >= from && s.date <= to),
    listRecentPersonalRecords: async () => [],
    listExerciseLibrary: async () => [],
    getFriendIds: async () => [],
    getOuraDaily: async () => [],
    getOuraDailyDerived: async (_u: string, from: string, to: string) =>
      derived.filter(d => d.day >= from && d.day <= to).map(d => ({ ...d, readinessScore: null, readinessSource: null })),
    getOuraCloudSwitchDay: async () => null,
    listActivityLogs: async () => [],
  }
}

describe('Week in review reads nights, and the stored Sleep score (#3661)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('a week with afternoon naps reads the night hours, on the week and on each bar', async () => {
    const all: SleepSession[] = []
    for (let i = 0; i < 14; i++) all.push(session(shiftDateStr('2026-06-29', i), `n${i}`, -1.5, 7.1))
    // A 36-minute nap at 14:00 on three recap days.
    for (const d of [RECAP[0], RECAP[3], RECAP[6]]) all.push(session(d, `nap${d}`, 14, 0.6))
    repo = stubRepo(all, [])
    const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
    expect(metrics.weekStart).toBe(RECAP[0])
    expect(metrics.sleepHours.week).toBeCloseTo(7.1, 5)
    expect(metrics.sleepHours.priorWeek).toBeCloseTo(7.1, 5)
    for (const p of metrics.sleepHours.byDay) expect(p.value).toBeCloseTo(7.1, 5)
  })

  it('a split night counts once, joined, not as two short nights', async () => {
    const all: SleepSession[] = []
    for (let i = 0; i < 14; i++) {
      const d = shiftDateStr('2026-06-29', i)
      if (d === RECAP[2]) {
        all.push(session(d, 'a', -1.5, 3.5), session(d, 'b', 3.5, 3.75))
      } else all.push(session(d, `n${i}`, -1.5, 7.25))
    }
    repo = stubRepo(all, [])
    const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
    expect(metrics.sleepHours.byDay[2].value).toBeCloseTo(7.25, 5)
  })

  it("each recap day's Sleep score is the score the day stored", async () => {
    const all = nights(45, '2026-07-14')
    // The daily score as the readiness read and the re-score persist it: over the full history.
    const stored = all.map(s => ({ day: s.date, sleepScore: scoreSleepForDate(all, s.date, TZ)?.result.score ?? null }))
    repo = stubRepo(all, stored)
    const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
    const byDate = new Map(stored.map(s => [s.day, s.sleepScore]))
    for (const p of metrics.sleepScore.byDay) expect(p.value).toBe(byDate.get(p.date))
    const recapStored = RECAP.map(d => byDate.get(d)!)
    expect(metrics.sleepScore.week).toBe(Math.round(recapStored.reduce((a, b) => a + b, 0) / recapStored.length))
  })

  it('a day with no stored score has none in the digest', async () => {
    const all = nights(45, '2026-07-14')
    repo = stubRepo(all, [])
    const { metrics } = await computeWeeklyDigestMetrics('u1', TZ)
    expect(metrics.sleepScore.week).toBeNull()
    for (const p of metrics.sleepScore.byDay) expect(p.value).toBeNull()
  })
})
