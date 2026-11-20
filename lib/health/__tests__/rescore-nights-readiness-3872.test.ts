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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailyDerivedPatch, OuraDailyDerivedRow } from '@/lib/data/repository'
import { withNightRescore, rescoreChangedNights, watchNights, type NightRescoreRepo } from '@/lib/health/rescore-nights'
import { scoreTodayReadiness, scoreFinishedDayReadiness } from '@/lib/health/night-readiness'
import { writeOuraCloudData } from '@/lib/oura/cloud/ingest'
import type { OuraCloudWrites } from '@/lib/oura/cloud/documents'
import { resolveAnchor } from '@/lib/health/body-battery-anchor'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
const READ_SCORE = 71
const PAST_SCORE = 64

// What a score loses with today's temperature input at neutral (no `daily_readiness` document yet).
const NO_TEMPERATURE_BONUS = 5

// The world the stubbed scorers see: set by `makeRepo`. `temperature` holds the days a
// `daily_readiness` document has fed (`oura_daily.temperature_deviation`).
let world: { sessions: () => SleepSession[]; derived: Map<string, Partial<OuraDailyDerivedRow>>; temperature: Set<string> }

vi.mock('@/lib/health/night-readiness', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/health/night-readiness')>()),
  // The readiness read's rule: only today's night writes today's readiness. Without the day's
  // temperature the score differs, as the composite's temperature input sits at neutral.
  scoreTodayReadiness: vi.fn(async (_u: string, tz: string) => {
    const today = todayInTz(tz)
    if (!world.sessions().some(s => s.date === today)) return
    const score = READ_SCORE + (world.temperature.has(today) ? 0 : NO_TEMPERATURE_BONUS)
    world.derived.set(today, { ...world.derived.get(today), readinessScore: score })
  }),
  scoreFinishedDayReadiness: vi.fn(async (_r: unknown, _u: string, day: string, _tz: string, now: Date) => {
    if (!world.sessions().some(s => s.date === day)) return false
    const score = PAST_SCORE + (world.temperature.has(day) ? 0 : NO_TEMPERATURE_BONUS)
    const row = world.derived.get(day)
    world.derived.set(day, {
      ...row, readinessScore: score,
      modelVersions: { ...(row?.modelVersions as object), readinessFilledOnArrival: now.toISOString() },
    })
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
  // Every past day already has its readiness document; today's lands when a test says so.
  const temperature = new Set(Array.from({ length: 19 }, (_, i) => shiftDateStr(today, -19 + i)))
  world = { sessions: () => sessions, derived, temperature }
  // Body Battery's frozen anchor for today, as `body_battery_daily` holds it.
  const battery: { anchor: number | null } = { anchor: null }
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
    releaseBodyBatteryAnchor: vi.fn(async () => {
      const had = battery.anchor != null
      battery.anchor = null
      return had
    }),
  }
  return {
    repo: repo as unknown as NightRescoreRepo & typeof repo,
    derived, upserts, temperature, battery,
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
    expect(storedReadiness(derived, today)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
    expect(scoreFinishedDayReadiness).not.toHaveBeenCalled()
  })

  it('a night that arrives after local midnight scores the day it belongs to, which has ended', async () => {
    // Yesterday ended with no night and no score; its night arrives today.
    const { repo, derived, setSessions } = makeRepo(today, { omit: [yesterday] })

    await withNightRescore(repo, 'u1', async () => { setSessions(s => [...s, night(yesterday)]) })

    expect(scoreFinishedDayReadiness).toHaveBeenCalledWith(repo, 'u1', yesterday, TZ, expect.any(Date))
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
    expect(storedReadiness(derived, today)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
  })

  it("a revised night today with no read after it rewrites today's readiness rather than leaving it cleared", async () => {
    const { repo, derived, setSessions } = makeRepo(today, { scored: [today] })

    const watch = await watchNights(repo, 'u1')
    setSessions(s => s.map(n => (n.date === today ? { ...n, averageHrvMs: 44, durationHours: 6.9 } : n)))
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.readinessCleared).toEqual([today])
    expect(outcome.readinessScored).toEqual([today])
    expect(storedReadiness(derived, today)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
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

/** The repository as both the Oura writer and the re-score target, as production passes it. */
function makeIngestFor(today: string, opts: { omit?: string[]; scored?: string[]; deferred?: boolean } = {}) {
  const ctx = makeRepo(today, opts)
  // `deferred`: the webhook's target (`rescoreReadinessAfterAnswer`), its jobs queued here to run when a test says.
  const jobs: (() => Promise<void>)[] = []
  const target = opts.deferred ? { repo: ctx.repo, deferReadiness: (job: () => Promise<void>) => { jobs.push(job) } } : ctx.repo
  const runJobs = async () => { for (const job of jobs.splice(0)) await job() }
  const daily = new Map<string, { date: string; temperatureDeviation?: number | null }>()
  for (const d of ctx.temperature) daily.set(d, { date: d, temperatureDeviation: 0.1 })
  Object.assign(ctx.repo, {
    getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => [...daily.values()].filter(r => r.date >= from && r.date <= to)),
    upsertOuraDaily: vi.fn(async (_u: string, rows: { date: string; temperatureDeviation?: number | null }[]) => {
      for (const r of rows) {
        daily.set(r.date, { ...daily.get(r.date), ...r })
        if (r.temperatureDeviation != null) ctx.temperature.add(r.date)
      }
    }),
    upsertBodyMetrics: vi.fn(async () => {}),
    upsertOuraCloudSleepPeriods: vi.fn(async () => 0),
    upsertOuraCloudSleep: vi.fn(async (_u: string, rows: { date: string }[]) => {
      ctx.setSessions(s => [...s.filter(n => !rows.some(r => r.date === n.date)), ...rows.map(r => night(r.date))])
      return { written: rows.length, skippedOverlap: 0 }
    }),
    tombstoneOuraCloudSleep: vi.fn(async () => 0),
    syncOuraMainSleepBodyMetrics: vi.fn(async () => {}),
    upsertOuraWorkouts: vi.fn(async () => 0),
    upsertOuraCloudDaily: vi.fn(async () => 0),
    upsertOuraSessions: vi.fn(async () => 0),
  })
  const empty: OuraCloudWrites = { daily: [], body: [], sleep: [], deletedSleepIds: [], retypedSleepIds: [], workouts: [], sleepPeriods: [], cloudDaily: [], sessions: [] } as unknown as OuraCloudWrites
  const write = (w: Partial<OuraCloudWrites>) =>
    writeOuraCloudData(ctx.repo as unknown as Parameters<typeof writeOuraCloudData>[0], 'u1', { ...empty, ...w }, target)
  const sleepDoc = (date: string) => write({ sleep: [{ date } as unknown as OuraCloudWrites['sleep'][number]] })
  const readinessDoc = (date: string, temperatureDeviation = 0.2) =>
    write({ daily: [{ date, readinessScore: 80, temperatureDeviation, temperatureTrendDeviation: 0.1 }] })
  /** A Body Battery read of today: anchors on stored readiness and freezes it (`resolveAnchor`). */
  const readBattery = () => {
    const r = resolveAnchor({
      persisted: ctx.battery.anchor != null ? { anchor: ctx.battery.anchor, anchorSource: 'readiness' } : null,
      derivedReadiness: storedReadiness(ctx.derived, today),
      ownSleepScore: null,
    })
    if (r.anchorSource === 'readiness') ctx.battery.anchor = r.anchor
    return r.anchor
  }
  return { ...ctx, sleepDoc, readinessDoc, readBattery, jobs, runJobs }
}

// #3872 review: today's temperature input, and the illness radar's, come only from the
// `daily_readiness` document, which is not a sleep write. The stored score must not depend on which
// of the two documents Oura sends first, and Body Battery must anchor on the score the card shows.
describe('the stored readiness does not depend on which Oura document lands first (#3872 review)', () => {
  let today: string
  let yesterday: string
  beforeEach(() => {
    vi.mocked(scoreTodayReadiness).mockClear()
    vi.mocked(scoreFinishedDayReadiness).mockClear()
    today = todayInTz(TZ)
    yesterday = shiftDateStr(today, -1)
  })

  const makeIngest = (opts: { omit?: string[]; scored?: string[] } = {}) => makeIngestFor(today, opts)

  it('sleep first then the readiness document, or the reverse: one stored score, and Body Battery anchors on it', async () => {
    // Sleep first, with a Body Battery read between the two documents that freezes its anchor.
    const a = makeIngest({ omit: [today] })
    a.readBattery()
    await a.sleepDoc(today)
    a.readBattery()
    await a.readinessDoc(today)
    const anchorA = a.readBattery()
    const storedA = storedReadiness(a.derived, today)

    // The readiness document first: no night yet, so nothing is scored until the night lands.
    const b = makeIngest({ omit: [today] })
    await b.readinessDoc(today)
    b.readBattery()
    await b.sleepDoc(today)
    const anchorB = b.readBattery()
    const storedB = storedReadiness(b.derived, today)

    expect(storedA).toBe(READ_SCORE)
    expect(storedB).toBe(READ_SCORE)
    expect(anchorA).toBe(storedA)
    expect(anchorB).toBe(storedB)
  })

  it('a readiness document for a day with no night scores nothing', async () => {
    const { derived, readinessDoc } = makeIngest({ omit: [today] })
    await readinessDoc(today)
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, today)).toBeNull()
  })

  it('a finished day this path filled is scored again when its readiness document lands', async () => {
    // Yesterday's night arrived after midnight, before its readiness document.
    const { derived, temperature, sleepDoc, readinessDoc } = makeIngest({ omit: [yesterday] })
    temperature.delete(yesterday)
    await sleepDoc(yesterday)
    expect(storedReadiness(derived, yesterday)).toBe(PAST_SCORE + NO_TEMPERATURE_BONUS)

    await readinessDoc(yesterday)
    expect(scoreFinishedDayReadiness).toHaveBeenCalledTimes(2)
    expect(storedReadiness(derived, yesterday)).toBe(PAST_SCORE)
  })

  it('a finished day whose score a read stored keeps it when its readiness document lands late', async () => {
    const { derived, upserts, readinessDoc } = makeIngest({ scored: [yesterday] })
    await readinessDoc(yesterday)
    expect(scoreFinishedDayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, yesterday)).toBe(60)
    // Not a night revision, so not marked for the re-derive either.
    expect(upserts).toEqual([])
  })
})

// #3872 review: the watch's "today" and the readiness read's own `todayInTz` differ when a write
// straddles local midnight. The watched day has ended: it is not cleared for a read that will score
// the next day instead.
describe('a re-score that runs after local midnight (#3872 review)', () => {
  const DAY = '2026-11-18'
  beforeEach(() => {
    vi.mocked(scoreTodayReadiness).mockClear()
    vi.mocked(scoreFinishedDayReadiness).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(dateStrMidnightInTz(DAY, TZ).getTime() + 24 * HOUR - 30_000))
  })
  afterEach(() => { vi.useRealTimers() })
  const pastMidnight = () => vi.setSystemTime(new Date(dateStrMidnightInTz(DAY, TZ).getTime() + 24 * HOUR + 10_000))

  it('keeps and marks a score the day already had, rather than clearing it', async () => {
    const { repo, derived, setSessions } = makeRepo(DAY, { scored: [DAY] })
    const watch = await watchNights(repo, 'u1')
    expect(watch.today).toBe(DAY)
    setSessions(s => s.map(n => (n.date === DAY ? { ...n, averageHrvMs: 44 } : n)))
    pastMidnight()
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.readinessCleared).toEqual([])
    expect(outcome.readinessMarked).toEqual([DAY])
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, DAY)).toBe(60)
  })

  it('scores a day with no score through the finished-day path', async () => {
    const { repo, derived, setSessions } = makeRepo(DAY, { omit: [DAY] })
    const watch = await watchNights(repo, 'u1')
    setSessions(s => [...s, night(DAY)])
    pastMidnight()
    const outcome = await rescoreChangedNights(repo, watch)

    expect(outcome.readinessScored).toEqual([DAY])
    expect(scoreFinishedDayReadiness).toHaveBeenCalledWith(repo, 'u1', DAY, TZ, expect.any(Date))
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, DAY)).not.toBeNull()
  })
})

describe("the webhook's readiness scoring runs after its answer (#3872 review)", () => {
  it('hands the scoring to a job, which takes the lock and scores on the state it finds', async () => {
    vi.mocked(scoreTodayReadiness).mockClear()
    const today = todayInTz(TZ)
    const { repo, derived, setSessions } = makeRepo(today, { omit: [today] })
    const jobs: (() => Promise<void>)[] = []

    await withNightRescore({ repo, deferReadiness: job => { jobs.push(job) } }, 'u1', async () => { setSessions(s => [...s, night(today)]) })
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(derived, today)).toBeNull()
    expect(jobs).toHaveLength(1)

    await jobs[0]()
    expect(repo.withOuraSleepWriteLock).toHaveBeenCalledTimes(2)
    expect(storedReadiness(derived, today)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
  })
})

// #3872 second review: the `daily_readiness` document's job as the webhook runs it, deferred past the
// answer and under the per-user lock.
describe("the readiness document's deferred job (#3872 second review)", () => {
  let today: string
  beforeEach(() => {
    vi.mocked(scoreTodayReadiness).mockClear()
    vi.mocked(scoreFinishedDayReadiness).mockClear()
    today = todayInTz(TZ)
  })

  it('scores nothing before the answer, then scores on the lock when the job runs', async () => {
    const c = makeIngestFor(today, { deferred: true })
    vi.mocked(c.repo.withOuraSleepWriteLock).mockClear()
    await c.readinessDoc(today)
    expect(scoreTodayReadiness).not.toHaveBeenCalled()
    expect(c.jobs).toHaveLength(1)

    await c.runJobs()
    expect(c.repo.withOuraSleepWriteLock).toHaveBeenCalledTimes(1)
    expect(scoreTodayReadiness).toHaveBeenCalledTimes(1)
    expect(storedReadiness(c.derived, today)).toBe(READ_SCORE)
  })

  it('releases an anchor frozen on the old score even when a read stored the new one before the job ran', async () => {
    const c = makeIngestFor(today, { omit: [today], deferred: true })
    // The sleep webhook lands with today's temperature still neutral, and its job scores the day.
    await c.sleepDoc(today)
    await c.runJobs()
    expect(storedReadiness(c.derived, today)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
    // The app opens: Body Battery freezes its anchor on that score.
    expect(c.readBattery()).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)

    // The `daily_readiness` document writes the temperature; a readiness read stores the new score
    // before the document's job gets the lock.
    await c.readinessDoc(today)
    await scoreTodayReadiness('u1', TZ)
    expect(storedReadiness(c.derived, today)).toBe(READ_SCORE)
    await c.runJobs()

    expect(c.repo.releaseBodyBatteryAnchor).toHaveBeenCalledWith('u1', today)
    expect(c.readBattery()).toBe(READ_SCORE)
  })

  it('a duplicate readiness document starts no job; a changed one does', async () => {
    const c = makeIngestFor(today, { deferred: true })
    await c.readinessDoc(today)
    await c.runJobs()
    vi.mocked(scoreTodayReadiness).mockClear()

    await c.readinessDoc(today)
    expect(c.jobs).toHaveLength(0)

    await c.readinessDoc(today, 0.3)
    expect(c.jobs).toHaveLength(1)
    await c.runJobs()
    expect(scoreTodayReadiness).toHaveBeenCalledTimes(1)
  })

  it('the daily reconcile, which scores inline, re-scores an identical document: the backstop for a lost job', async () => {
    const c = makeIngestFor(today)
    await c.readinessDoc(today)
    await c.readinessDoc(today)
    expect(scoreTodayReadiness).toHaveBeenCalledTimes(2)
  })
})

// #3872 second review: a night synced just before local midnight, its `daily_readiness` document just
// after. This encodes what the code does: the day keeps the score it was given at 23:58, without its
// temperature input, because that score was stored by the readiness read's own function and is not
// marked as an arrival fill. A known edge case, posted on #3872.
describe('a readiness document that lands after local midnight for the night before it (#3872 second review)', () => {
  const DAY = '2026-11-18'
  const at = (minutesAfterMidnight: number) =>
    vi.setSystemTime(new Date(dateStrMidnightInTz(DAY, TZ).getTime() + 24 * HOUR + minutesAfterMidnight * 60_000))
  beforeEach(() => {
    vi.mocked(scoreTodayReadiness).mockClear()
    vi.mocked(scoreFinishedDayReadiness).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => { vi.useRealTimers() })

  it('keeps the 23:58 score, and neither re-scores nor marks the finished day', async () => {
    at(-2)
    const c = makeIngestFor(DAY, { omit: [DAY], deferred: true })
    await c.sleepDoc(DAY)
    await c.runJobs()
    expect(storedReadiness(c.derived, DAY)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)

    at(1)
    const upsertsBefore = c.upserts.length
    await c.readinessDoc(DAY)
    expect(c.jobs).toHaveLength(1)
    await c.runJobs()

    expect(scoreTodayReadiness).toHaveBeenCalledTimes(1)
    expect(scoreFinishedDayReadiness).not.toHaveBeenCalled()
    expect(storedReadiness(c.derived, DAY)).toBe(READ_SCORE + NO_TEMPERATURE_BONUS)
    expect(c.upserts.slice(upsertsBefore)).toEqual([])
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
