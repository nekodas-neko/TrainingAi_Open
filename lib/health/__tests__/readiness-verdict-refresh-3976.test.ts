// #3976 — an unanswered readiness verdict follows the day's re-scored readiness; an answered or
// dismissed one never changes; a day with no row gets none; a fault never fails the readiness write.
//
// In-memory repository for the helper and the two write paths that call it (the night re-score and
// a finished day's score). The adapter's conditional UPDATE is proved against a real database in
// `readiness-verdict-refresh-db-3976.test.ts`. Fixtures are built from today's local date at midday.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import type { ReadinessVerdictRecord } from '@trainingai/shared/types'
import type { OuraDailyDerivedRow } from '@/lib/data/repository'
import { refreshUnansweredReadinessVerdict, buildReadinessVerdictRecord } from '@/lib/health/readiness-verdict-refresh'

const TZ = 'Australia/Brisbane'
const V = 'v18:test'
const USER = 'u1'
const HOUR = 3_600_000

type Derived = Pick<OuraDailyDerivedRow, 'day' | 'readinessScore' | 'readinessContributors' | 'modelVersions'>

/** 28 ordinary days (60–66) before `day`, and `day` itself at `score`. */
function history(day: string, score: number): Derived[] {
  const rows: Derived[] = []
  for (let i = 28; i >= 1; i--) {
    const s = 60 + ((i - 1) % 7)
    rows.push({ day: shiftDateStr(day, -i), readinessScore: s, readinessContributors: { hrvBalance: { score: s } }, modelVersions: { readiness: V } })
  }
  rows.push({ day, readinessScore: score, readinessContributors: { hrvBalance: { score } }, modelVersions: { readiness: V } })
  return rows
}

function makeRepo(day: string, score: number) {
  const derived = new Map(history(day, score).map(r => [r.day, r]))
  const verdicts = new Map<string, ReadinessVerdictRecord>()
  const repo = {
    derived, verdicts,
    getReadinessVerdict: vi.fn(async (_u: string, d: string) => {
      const v = verdicts.get(d)
      return v ? structuredClone(v) : null
    }),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      [...derived.values()].filter(r => r.day >= from && r.day <= to).sort((a, b) => (a.day < b.day ? -1 : 1)) as OuraDailyDerivedRow[]),
    refreshUnansweredReadinessVerdict: vi.fn(async (_u: string, rec: Omit<ReadinessVerdictRecord, 'responseState'>) => {
      const v = verdicts.get(rec.date)
      if (!v || v.responseState !== 'none') return false
      verdicts.set(rec.date, { ...rec, responseState: 'none' })
      return true
    }),
  }
  /** What the verdict's first read would freeze now. */
  const freeze = (state: ReadinessVerdictRecord['responseState'] = 'none') => {
    const built = buildReadinessVerdictRecord(day, [...derived.values()])
    if (built.kind !== 'record') throw new Error('fixture below floor')
    verdicts.set(day, { ...built.record, responseState: state })
  }
  const rescore = (s: number) => derived.set(day, { ...derived.get(day)!, readinessScore: s, readinessContributors: { hrvBalance: { score: s } } })
  return { repo, freeze, rescore }
}

let today: string
beforeEach(() => { today = todayInTz(TZ) })

describe('refreshUnansweredReadinessVerdict (#3976)', () => {
  it('an unanswered row follows a re-score: score, direction and band', async () => {
    const { repo, freeze, rescore } = makeRepo(today, 63)
    freeze()
    expect(repo.verdicts.get(today)).toMatchObject({ score: 63, verdict: 'normal' })
    rescore(41)
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('updated')
    const row = repo.verdicts.get(today)!
    expect(row).toMatchObject({ score: 41, verdict: 'poor', responseState: 'none' })
    // The band is the one the first read would build now, from the same function.
    const fresh = buildReadinessVerdictRecord(today, [...repo.derived.values()])
    expect(fresh.kind === 'record' && fresh.record.band).toEqual(row.band)
    rescore(90)
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('updated')
    expect(repo.verdicts.get(today)).toMatchObject({ score: 90, verdict: 'good' })
  })

  it('a row whose recompute matches is left as it is, with no write', async () => {
    const { repo, freeze } = makeRepo(today, 63)
    freeze()
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('kept')
    expect(repo.refreshUnansweredReadinessVerdict).not.toHaveBeenCalled()
  })

  it.each(['rated', 'dismissed'] as const)('a %s row never changes', async (state) => {
    const { repo, freeze, rescore } = makeRepo(today, 41)
    freeze(state)
    const before = structuredClone(repo.verdicts.get(today))
    rescore(70)
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('answered')
    expect(repo.verdicts.get(today)).toEqual(before)
    expect(repo.refreshUnansweredReadinessVerdict).not.toHaveBeenCalled()
  })

  it('an answer landing between the read and the write keeps its row', async () => {
    const { repo, freeze, rescore } = makeRepo(today, 63)
    freeze()
    rescore(41)
    repo.getReadinessVerdict.mockImplementationOnce(async (_u, d) => {
      const v = structuredClone(repo.verdicts.get(d)!)
      repo.verdicts.set(d, { ...repo.verdicts.get(d)!, responseState: 'rated' })
      return v
    })
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('answered')
    expect(repo.verdicts.get(today)).toMatchObject({ score: 63, responseState: 'rated' })
  })

  it('a re-score with no row creates none', async () => {
    const { repo, rescore } = makeRepo(today, 63)
    rescore(41)
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('no-row')
    expect(repo.verdicts.size).toBe(0)
    expect(repo.refreshUnansweredReadinessVerdict).not.toHaveBeenCalled()
  })

  it('a cleared score leaves the asked row as it was', async () => {
    const { repo, freeze } = makeRepo(today, 41)
    freeze()
    repo.derived.set(today, { ...repo.derived.get(today)!, readinessScore: null })
    expect(await refreshUnansweredReadinessVerdict(repo, USER, today)).toBe('kept')
    expect(repo.verdicts.get(today)).toMatchObject({ score: 41, verdict: 'poor' })
  })

  it('a database fault is logged and reported, never thrown', async () => {
    const { repo, freeze, rescore } = makeRepo(today, 63)
    freeze()
    rescore(41)
    repo.refreshUnansweredReadinessVerdict.mockRejectedValueOnce(new Error('connection reset'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(refreshUnansweredReadinessVerdict(repo, USER, today)).resolves.toBe('failed')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[readiness-verdict]'), expect.any(Error))
    err.mockRestore()
  })
})

// The write paths: a finished day scored on its night's arrival, and today's re-score through the
// injected readiness read. `scoreFinishedDayReadiness` is stubbed to write the new score, as the
// per-day scorer would.
vi.mock('@/lib/health/night-readiness', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/health/night-readiness')>()),
  scoreFinishedDayReadiness: vi.fn(async () => { stubScore(); return true }),
}))
let stubScore: () => void = () => {}

describe('the re-score paths refresh the unanswered verdict (#3976)', () => {
  async function run(day: string, wire: (r: ReturnType<typeof makeRepo>) => void, faultyVerdicts = false) {
    const { scoreReadinessForDays } = await import('@/lib/health/rescore-nights')
    const r = makeRepo(day, 63)
    r.freeze()
    wire(r)
    if (faultyVerdicts) r.repo.getReadinessVerdict.mockRejectedValue(new Error('verdict table down'))
    // The day's night, 22:30 → 06:30 local, so the scorer has a night of its own to score.
    const mid = dateStrMidnightInTz(day, TZ).getTime()
    const night = {
      id: `id-${day}`, userId: USER, date: day, ouraId: `cloud-${day}`, createdAt: new Date(mid),
      sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
      durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
      efficiency: 90, averageHrvMs: 50, lowestHeartRate: 52, respiratoryRate: 14.5,
    }
    const repo = { ...r.repo, listSleepSessions: vi.fn(async () => [night]) }
    return { r, scoreReadinessForDays, repo }
  }

  it('today, re-scored by the injected read: the unanswered row follows', async () => {
    const { r, scoreReadinessForDays, repo } = await run(today, () => {})
    const out = await scoreReadinessForDays(repo as never, USER, TZ, [today], {
      scoreToday: async () => { r.rescore(41) },
    })
    expect(out.scored).toEqual([today])
    expect(r.repo.verdicts.get(today)).toMatchObject({ score: 41, verdict: 'poor', responseState: 'none' })
  })

  it('a finished day scored on arrival: the unanswered row follows, an answered one stays', async () => {
    const day = shiftDateStr(today, -1)
    const { r, scoreReadinessForDays, repo } = await run(day, (rr) => {
      rr.repo.derived.set(day, { ...rr.repo.derived.get(day)!, modelVersions: { readiness: V, readinessFilledOnArrival: 'x' } })
      stubScore = () => rr.rescore(90)
    })
    const out = await scoreReadinessForDays(repo as never, USER, TZ, [day])
    expect(out.scored).toEqual([day])
    expect(r.repo.verdicts.get(day)).toMatchObject({ score: 90, verdict: 'good' })
  })

  it('a database fault in the recompute does not fail the readiness write', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { r, scoreReadinessForDays, repo } = await run(today, () => {}, true)
    const out = await scoreReadinessForDays(repo as never, USER, TZ, [today], {
      scoreToday: async () => { r.rescore(41) },
    })
    expect(out.scored).toEqual([today])
    expect(r.repo.derived.get(today)?.readinessScore).toBe(41)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[readiness-verdict]'), expect.any(Error))
    err.mockRestore()
  })
})
