// #3079: a night Oura revises or deletes re-scores the day it belongs to, and nothing else.
//
// Driven through `withNightRescore` against an in-memory repository: the sleep rows change between
// the before and after reads exactly as an Oura write would change them, and the derived rows the
// re-score touches are asserted. Fixtures are built from today's local date (dates rule), each night
// 22:30 → 06:30 local, and the scored values compared with the readiness read's own scorer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailyDerivedPatch, OuraDailyDerivedRow } from '@/lib/data/repository'
import { writeOuraCloudData, type OuraCloudWriter } from '@/lib/oura/cloud/ingest'
import type { OuraCloudWrites } from '@/lib/oura/cloud/documents'
import {
  withNightRescore, changedNightDates, scoreNightForDate, RESCORE_WINDOW_DAYS, type NightRescoreRepo,
} from '@/lib/health/rescore-nights'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

function night(date: string, over: Partial<SleepSession> = {}): SleepSession {
  const mid = dateStrMidnightInTz(date, TZ).getTime()
  return {
    id: `id-${date}`, userId: 'u1', date, ouraId: `cloud-${date}`, createdAt: new Date(mid),
    sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
    durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
    efficiency: 90, averageHrvMs: 50, lowestHeartRate: 52, respiratoryRate: 14.5,
    ...over,
  }
}

function makeRepo(today: string, opts: { omit?: string } = {}) {
  let sessions: SleepSession[] = Array.from({ length: 20 }, (_, i) => night(shiftDateStr(today, -19 + i)))
    .filter(n => n.date !== opts.omit)
  // Days on which a write removed an Oura row: the tombstones `listDeletedOuraCloudSleepDates` finds.
  const deletedDates = new Set<string>()
  const derived = new Map<string, Partial<OuraDailyDerivedRow>>()
  const battery = new Map<string, string>()
  const calls = { upserts: [] as { day: string; patch: OuraDailyDerivedPatch }[], cleared: [] as { day: string; pillars: object }[] }
  const repo = {
    getUserById: vi.fn(async () => ({ timezone: TZ })),
    listSleepSessions: vi.fn(async (_u: string, from: string, to: string) => sessions.filter(s => s.date >= from && s.date <= to)),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      [...derived.entries()].filter(([d]) => d >= from && d <= to).map(([day, r]) => ({ day, ...r }))),
    upsertOuraDailyDerived: vi.fn(async (_u: string, day: string, patch: OuraDailyDerivedPatch) => { calls.upserts.push({ day, patch }) }),
    clearNightDerivedScores: vi.fn(async (_u: string, day: string, pillars: { sleep: boolean; readiness: boolean }) => {
      calls.cleared.push({ day, pillars })
      const row = derived.get(day)
      const had = row != null && ((pillars.sleep && row.sleepScore != null) || (pillars.readiness && row.readinessScore != null))
      if (row && pillars.sleep) row.sleepScore = null
      if (row && pillars.readiness) row.readinessScore = null
      return had
    }),
    listDeletedOuraCloudSleepDates: vi.fn(async (_u: string, from: string, to: string) => [...deletedDates].filter(d => d >= from && d <= to)),
    withOuraSleepWriteLock: vi.fn(async <T,>(_u: string, run: () => Promise<T>) => run()),
    releaseBodyBatteryAnchor: vi.fn(async (_u: string, day: string) => {
      if (battery.get(day) !== 'readiness') return false
      battery.set(day, 'default')
      return true
    }),
  }
  return {
    repo: repo as unknown as NightRescoreRepo & typeof repo,
    calls, derived, battery,
    setSessions: (f: (s: SleepSession[]) => SleepSession[]) => {
      const before = sessions
      sessions = f(sessions)
      for (const n of before) if (!sessions.some(x => x.id === n.id)) deletedDates.add(n.date)
    },
  }
}

describe('re-scoring a night Oura changed (#3079)', () => {
  let today: string
  let yesterday: string
  beforeEach(() => {
    today = todayInTz(TZ)
    yesterday = shiftDateStr(today, -1)
  })

  it("a revised night today: re-scores sleep, clears today's readiness, keeps the battery anchor frozen", async () => {
    const { repo, calls, derived, battery, setSessions } = makeRepo(today)
    derived.set(today, { readinessScore: 71, sleepScore: 80 })
    battery.set(today, 'readiness')

    await withNightRescore(repo, 'u1', async () => {
      setSessions(s => s.map(n => (n.date === today ? { ...n, durationHours: 6.1, efficiency: 81, averageHrvMs: 41 } : n)))
    })

    const sleepWrite = calls.upserts.find(u => u.day === today && u.patch.sleepScore !== undefined)
    expect(sleepWrite?.patch.sleepScore).toBe(scoreNightForDate(await repo.listSleepSessions('u1', shiftDateStr(today, -40), today), today, TZ)?.score)
    expect(sleepWrite?.patch.modelVersions).toEqual({ sleep: expect.stringMatching(/^v\d+:/) })
    expect(derived.get(today)?.readinessScore).toBeNull()
    // The night was already there when the anchor froze: a revision must not shift the day's curve
    // (docs/domains/readiness/README.md, the anchor rule).
    expect(battery.get(today)).toBe('readiness')
    expect(repo.releaseBodyBatteryAnchor).not.toHaveBeenCalled()
    // Nothing else moved.
    expect(calls.upserts.every(u => u.day === today)).toBe(true)
  })

  it("a deleted night on a finished day: clears its sleep score, keeps and marks its readiness", async () => {
    const { repo, calls, derived, battery, setSessions } = makeRepo(today)
    derived.set(yesterday, { readinessScore: 64, sleepScore: 77 })
    battery.set(yesterday, 'readiness')

    await withNightRescore(repo, 'u1', async () => {
      setSessions(s => s.filter(n => n.date !== yesterday))
    })

    expect(derived.get(yesterday)?.sleepScore).toBeNull()
    // A finished day's readiness is what it said that morning: kept, marked for the re-derive.
    expect(derived.get(yesterday)?.readinessScore).toBe(64)
    const mark = calls.upserts.find(u => u.day === yesterday)
    expect(mark?.patch).toEqual({ modelVersions: { readinessNightRevisedAt: expect.any(String) } })
    // A finished day's battery is left to the re-derive.
    expect(battery.get(yesterday)).toBe('readiness')
    expect(repo.releaseBodyBatteryAnchor).not.toHaveBeenCalled()
  })

  it('a night that arrives late for today is scored at once, and releases an anchor frozen without it', async () => {
    const { repo, calls, battery, setSessions } = makeRepo(today, { omit: today })
    // A readiness from that morning's body metrics alone froze the anchor before the night existed.
    battery.set(today, 'readiness')

    await withNightRescore(repo, 'u1', async () => {
      setSessions(s => [...s, night(today)])
    })

    expect(calls.upserts.find(u => u.day === today)?.patch.sleepScore).toEqual(expect.any(Number))
    expect(battery.get(today)).toBe('default')
  })

  // #3099: two webhooks, a delete then a re-create, are a revision, not an arrival.
  it('a delete then a re-create of the night keeps an anchor frozen while it was there', async () => {
    const { repo, battery, setSessions } = makeRepo(today)
    battery.set(today, 'readiness')

    await withNightRescore(repo, 'u1', async () => { setSessions(s => s.filter(n => n.date !== today)) })
    await withNightRescore(repo, 'u1', async () => { setSessions(s => [...s, night(today)]) })

    expect(battery.get(today)).toBe('readiness')
    expect(repo.releaseBodyBatteryAnchor).not.toHaveBeenCalled()
  })

  // #3104 review: a live nap on the day is not a deleted night, so a late night still arrives.
  it('a late night after a nap on the same day is still an arrival, and releases the anchor', async () => {
    const { repo, battery, setSessions } = makeRepo(today, { omit: today })
    const mid = dateStrMidnightInTz(today, TZ).getTime()
    setSessions(s => [...s, night(today, { id: 'nap', ouraId: 'nap', sleepStart: new Date(mid - 10 * HOUR), sleepEnd: new Date(mid - 9.3 * HOUR), durationHours: 0.6 })])
    battery.set(today, 'readiness')

    await withNightRescore(repo, 'u1', async () => { setSessions(s => [...s, night(today)]) })

    expect(battery.get(today)).toBe('default')
  })

  it('an identical re-send writes nothing', async () => {
    const { repo, calls, setSessions } = makeRepo(today)
    await withNightRescore(repo, 'u1', async () => {
      // A new row object with the same values, a fresh write stamp, and Oura re-scoring its own score.
      setSessions(s => s.map(n => ({ ...n, createdAt: new Date(), sleepScore: 99 })))
    })
    expect(calls.upserts).toEqual([])
    expect(calls.cleared).toEqual([])
  })

  it('leaves a change older than the window alone', async () => {
    const { repo, calls, setSessions } = makeRepo(today)
    const old = shiftDateStr(today, -(RESCORE_WINDOW_DAYS + 3))
    await withNightRescore(repo, 'u1', async () => {
      setSessions(s => s.map(n => (n.date === old ? { ...n, durationHours: 5 } : n)))
    })
    expect(calls.upserts).toEqual([])
  })

  it('returns the write and never throws when the re-score fails', async () => {
    const { repo, setSessions } = makeRepo(today)
    repo.getOuraDailyDerived.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await withNightRescore(repo, 'u1', async () => {
      setSessions(s => s.filter(n => n.date !== today))
      return 3
    })
    expect(result).toBe(3)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('without a repository it only runs the write', async () => {
    await expect(withNightRescore(undefined, 'u1', async () => 'w')).resolves.toBe('w')
  })
})

describe('changedNightDates', () => {
  it('names nights that appeared, went or changed, oldest first', () => {
    const before = new Map([['2026-10-17', 'a'], ['2026-10-18', 'b'], ['2026-10-19', 'c']])
    const after = new Map([['2026-10-17', 'a'], ['2026-10-19', 'c2'], ['2026-10-16', 'z']])
    expect(changedNightDates(before, after)).toEqual(['2026-10-16', '2026-10-18', '2026-10-19'])
  })
})

describe('writeOuraCloudData brackets a sleep write with the re-score', () => {
  const writer = {
    upsertOuraDaily: async () => {}, upsertBodyMetrics: async () => {},
    upsertOuraCloudSleep: vi.fn(async () => ({ written: 1, skippedOverlap: 0 })),
    tombstoneOuraCloudSleep: vi.fn(async () => 0),
    upsertOuraWorkouts: async () => 0, upsertOuraCloudHeartrate: async () => 0,
    upsertOuraCloudSleepPeriods: async () => 0, upsertOuraCloudDaily: async () => 0, upsertOuraSessions: async () => 0,
  } as unknown as OuraCloudWriter
  const empty: OuraCloudWrites = { daily: [], body: [], sleep: [], deletedSleepIds: [], workouts: [], sleepPeriods: [], cloudDaily: [], sessions: [] }

  it('reads the nights before and after a sleep or delete write', async () => {
    const { repo } = makeRepo(todayInTz(TZ))
    await writeOuraCloudData(writer, 'u1', { ...empty, deletedSleepIds: ['x'] }, repo)
    expect(repo.listSleepSessions).toHaveBeenCalledTimes(2)
    expect(writer.tombstoneOuraCloudSleep).toHaveBeenCalledWith('u1', ['x'])
  })

  it('leaves the nights alone for a write with no sleep in it', async () => {
    const { repo } = makeRepo(todayInTz(TZ))
    await writeOuraCloudData(writer, 'u1', empty, repo)
    expect(repo.listSleepSessions).not.toHaveBeenCalled()
  })
})
