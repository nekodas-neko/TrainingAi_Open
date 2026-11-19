// #3872: a day's readiness is scored when its night arrives or is revised, not only when the app
// reads readiness that day after the night has landed.
//
// One test per row of the issue's table (a night after the day's last read, a night after local
// midnight, no read that day, a revised night with no read after it), plus the finished day that
// keeps its score. Driven through `withNightRescore` against an in-memory repository. The two
// scorers are stubbed: `scoreTodayReadiness` stands in for the readiness read and applies its rule
// (it stores readiness only when today's night exists, `readiness-payload.ts`), and
// `scoreFinishedDayReadiness` stands in for the backfill's per-day scorer. Fixtures are built from
// today's local date, each night 22:30 → 06:30 local.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailyDerivedPatch, OuraDailyDerivedRow } from '@/lib/data/repository'
import { withNightRescore, rescoreChangedNights, watchNights, type NightRescoreRepo } from '@/lib/health/rescore-nights'
import { scoreTodayReadiness, scoreFinishedDayReadiness } from '@/lib/health/night-readiness'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
const READ_SCORE = 71
const PAST_SCORE = 64

// The world the stubbed scorers see: set by `makeRepo`.
let world: { sessions: () => SleepSession[]; derived: Map<string, Partial<OuraDailyDerivedRow>> }

vi.mock('@/lib/health/night-readiness', () => ({
  // The readiness read's rule: only today's night writes today's readiness.
  scoreTodayReadiness: vi.fn(async (_u: string, tz: string) => {
    const today = todayInTz(tz)
    if (!world.sessions().some(s => s.date === today)) return
    world.derived.set(today, { ...world.derived.get(today), readinessScore: READ_SCORE })
  }),
  scoreFinishedDayReadiness: vi.fn(async (_u: string, day: string) => {
    if (!world.sessions().some(s => s.date === day)) return false
    world.derived.set(day, { ...world.derived.get(day), readinessScore: PAST_SCORE })
    return true
  }),
}))

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

/** Twenty nights up to today, less the dates in `omit`; derived rows carry readiness on `scored`. */
function makeRepo(today: string, opts: { omit?: string[]; scored?: string[] } = {}) {
  let sessions = Array.from({ length: 20 }, (_, i) => night(shiftDateStr(today, -19 + i)))
    .filter(n => !opts.omit?.includes(n.date))
  const derived = new Map<string, Partial<OuraDailyDerivedRow>>()
  for (const d of opts.scored ?? []) derived.set(d, { readinessScore: 60, readinessSource: 'generic-derived' })
  world = { sessions: () => sessions, derived }
  const upserts: { day: string; patch: OuraDailyDerivedPatch }[] = []
  const repo = {
    getUserById: vi.fn(async () => ({ timezone: TZ })),
    listSleepSessions: vi.fn(async (_u: string, from: string, to: string) => sessions.filter(s => s.date >= from && s.date <= to)),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      [...derived.entries()].filter(([d]) => d >= from && d <= to).map(([day, r]) => ({ day, ...r }))),
    upsertOuraDailyDerived: vi.fn(async (_u: string, day: string, patch: OuraDailyDerivedPatch) => { upserts.push({ day, patch }) }),
    clearNightDerivedScores: vi.fn(async (_u: string, day: string, pillars: { sleep: boolean; readiness: boolean }) => {
      const row = derived.get(day)
      if (!row || !pillars.readiness || row.readinessScore == null) return false
      derived.set(day, { ...row, readinessScore: null, readinessSource: null })
      return true
    }),
    listDeletedOuraCloudSleepDates: vi.fn(async () => []),
    withOuraSleepWriteLock: vi.fn(async <T,>(_u: string, run: () => Promise<T>) => run()),
    releaseBodyBatteryAnchor: vi.fn(async () => false),
  }
  return {
    repo: repo as unknown as NightRescoreRepo & typeof repo,
    derived, upserts,
    setSessions: (f: (s: SleepSession[]) => SleepSession[]) => { sessions = f(sessions) },
  }
}

/** What the readiness read would find stored for `day` afterwards. */
const storedReadiness = (derived: Map<string, Partial<OuraDailyDerivedRow>>, day: string) => derived.get(day)?.readinessScore ?? null

describe("readiness is scored when a day's night arrives (#3872)", () => {
  let today: string
  let yesterday: string
  beforeEach(() => {
    vi.mocked(scoreTodayReadiness).mockClear()
    vi.mocked(scoreFinishedDayReadiness).mockClear()
    today = todayInTz(TZ)
    yesterday = shiftDateStr(today, -1)
  })

  it("a night that arrives after the day's last read is scored when it lands", async () => {
    const { repo, derived, setSessions } = makeRepo(today, { omit: [today] })
    // The day's last read came before the night: the read's rule stores nothing.
    await scoreTodayReadiness('u1', TZ)
    expect(storedReadiness(derived, today)).toBeNull()

    // The night lands that evening and no read follows.
    await withNightRescore(repo, 'u1', async () => { setSessions(s => [...s, night(today)]) })

    expect(scoreTodayReadiness).toHaveBeenCalledTimes(2)
    expect(storedReadiness(derived, today)).toBe(READ_SCORE)
    expect(scoreFinishedDayReadiness).not.toHaveBeenCalled()
  })

  it('a night that arrives after local midnight scores the day it belongs to, which has ended', async () => {
    // Yesterday ended with no night and no score; its night arrives today.
    const { repo, derived, setSessions } = makeRepo(today, { omit: [yesterday] })

    await withNightRescore(repo, 'u1', async () => { setSessions(s => [...s, night(yesterday)]) })

    expect(scoreFinishedDayReadiness).toHaveBeenCalledWith('u1', yesterday, TZ)
    expect(storedReadiness(derived, yesterday)).toBe(PAST_SCORE)
    // Today's night did not change, so today is not re-scored by this write.
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
  })

  it('a day the app is never opened still gets its score from the night arriving', async () => {
    const { repo, derived, setSessions } = makeRepo(today, { omit: [today] })

    const outcome = await (async () => {
      const watch = await watchNights(repo, 'u1')
      setSessions(s => [...s, night(today)])
      return rescoreChangedNights(repo, watch)
    })()

    expect(outcome.readinessScored).toEqual([today])
    expect(storedReadiness(derived, today)).toBe(READ_SCORE)
  })

  it("a revised night today with no read after it rewrites today's readiness rather than leaving it cleared", async () => {
    const { repo, derived, setSessions } = makeRepo(today, { scored: [today] })

    const watch = await watchNights(repo, 'u1')
    setSessions(s => s.map(n => (n.date === today ? { ...n, averageHrvMs: 44, durationHours: 6.9 } : n)))
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.readinessCleared).toEqual([today])
    expect(outcome.readinessScored).toEqual([today])
    expect(storedReadiness(derived, today)).toBe(READ_SCORE)
  })

  it("a night that goes away leaves today's readiness cleared and runs no scorer", async () => {
    const { repo, derived, setSessions } = makeRepo(today, { scored: [today] })

    const watch = await watchNights(repo, 'u1')
    setSessions(s => s.filter(n => n.date !== today))
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.readinessCleared).toEqual([today])
    expect(outcome.readinessScored).toEqual([])
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, today)).toBeNull()
  })

  it('a finished day that already has a score keeps it and is only marked', async () => {
    const { repo, derived, upserts, setSessions } = makeRepo(today, { scored: [yesterday] })

    const watch = await watchNights(repo, 'u1')
    setSessions(s => s.map(n => (n.date === yesterday ? { ...n, averageHrvMs: 44 } : n)))
    const outcome = await rescoreChangedNights(repo, watch, new Date('2026-11-19T10:00:00Z'))

    expect(outcome.readinessMarked).toEqual([yesterday])
    expect(outcome.readinessScored).toEqual([])
    expect(scoreFinishedDayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, yesterday)).toBe(60)
    expect(upserts.filter(u => u.day === yesterday).map(u => u.patch.modelVersions))
      .toContainEqual({ readinessNightRevisedAt: '2026-11-19T10:00:00.000Z' })
    expect(upserts.some(u => u.patch.readinessScore != null)).toBe(false)
  })

  it('a scorer that fails is logged and the rest of the re-score still runs', async () => {
    const { repo, setSessions } = makeRepo(today, { omit: [yesterday, today] })
    vi.mocked(scoreFinishedDayReadiness).mockRejectedValueOnce(new Error('pool exhausted'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const watch = await watchNights(repo, 'u1')
    setSessions(s => [...s, night(yesterday), night(today)])
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.sleepRescored).toEqual([yesterday, today])
    expect(outcome.readinessScored).toEqual([today])
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`scoring readiness for ${yesterday} failed`), expect.any(Error))
    log.mockRestore()
  })
})

describe('the patch a recomputed readiness is stored with (#3872)', () => {
  it('is the served score with its illness fields, source and model stamp, as the backfill wrote it', async () => {
    const { readinessPatchFromAudit } = await vi.importActual<typeof import('@/lib/health/night-readiness')>('@/lib/health/night-readiness')
    const { READINESS_MODEL_VERSION } = await import('@trainingai/shared/health/readiness-composite')
    expect(readinessPatchFromAudit({
      score: 64, contributors: { hrv: 1 }, illnessFlag: 'clear', illnessScore: 10, illnessBiomarkers: null, readinessSource: 'generic-derived',
    })).toEqual({
      readinessScore: 64, readinessContributors: { hrv: 1 }, illnessFlag: 'clear', illnessScore: 10, illnessBiomarkers: null,
      readinessSource: 'generic-derived', modelVersions: { readiness: READINESS_MODEL_VERSION },
    })
    expect(readinessPatchFromAudit({ score: 64, contributors: null }).readinessSource).toBe('ble-derived')
  })
})
