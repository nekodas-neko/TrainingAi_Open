// #3079: the daily reconciliation re-reads the last three days for every connected user through the
// connect backfill's code, with the night re-score attached, and one user's failure never stops the
// next. Oura and the repository are fakes; nothing reaches Oura or a database.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { OuraBackfillResult, backfillOuraCloud } from '../backfill'
import { NO_WRITES } from '../ingest'
import { reconcileDaysFor, reconcileOuraCloud, reportReconcileGaps, startOuraReconcile, RECONCILE_DAYS, RECONCILE_WEEKLY_DAYS, RECONCILE_WEEKLY_WEEKDAY } from '../reconcile'
import { OURA_DAILY_REPORT_INTERVAL_MS, reportOuraCloudIssue, resetOuraCloudReportThrottle } from '../report'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const CONFIG = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'https://x/api/oura/callback' }
// Local midday in Brisbane, so "today" is unambiguous whatever the machine's clock (dates rule).
const NOW = new Date('2026-10-19T02:00:00.000Z')

function okResult(stoppedEarly: string | null = null): OuraBackfillResult {
  return {
    ok: true,
    report: {
      dryRun: false, from: '', to: '', documents: {}, dropped: 0, counts: NO_WRITES, workoutsTombstoned: 0, sessionsTombstoned: 0,
      forbidden: [], notShared: [], refusedDespiteGrant: [], stoppedEarly,
    },
  }
}

function fakeRepo(users: { id: string; timezone: string }[]) {
  return {
    listOuraCloudConnectedUserIds: vi.fn(async () => users.map(u => u.id)),
    getUserById: vi.fn(async (id: string) => users.find(u => u.id === id) ?? null),
  } as unknown as WorkoutRepository
}

afterEach(() => resetOuraCloudReportThrottle())

describe('reconcileOuraCloud', () => {
  it("reads each user's last three local days, with heart rate, and re-scores through the repository", async () => {
    const repo = fakeRepo([{ id: 'u1', timezone: 'Australia/Brisbane' }, { id: 'u2', timezone: 'America/New_York' }])
    const backfill = vi.fn(async () => okResult()) as unknown as typeof backfillOuraCloud
    const out = await reconcileOuraCloud({ repo, config: CONFIG, backfill, now: () => NOW })

    const calls = (backfill as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    for (const [i, tz] of ['Australia/Brisbane', 'America/New_York'].entries()) {
      const [deps, userId, opts] = calls[i]
      const to = toAestDay(NOW, tz)
      expect(userId).toBe(`u${i + 1}`)
      // #2861: and a re-read is not new data from the ring, so it never stamps last_data_at.
      // #3087, #3153: and tombstones a workout or session gone from Oura's list for a day it re-read.
      expect(opts).toEqual({ from: shiftDateStr(to, -(RECONCILE_DAYS - 1)), to, dryRun: false, heartRate: true, tz, tombstoneAbsent: true, stampData: false })
      expect(deps.rescore).toBe(repo)
      // #3078: the reconciliation's heart rate re-attributes the workouts it changed.
      expect(deps.workoutHr).toBeTypeOf('function')
    }
    // The two users' "today" differ: the window is each user's own local days.
    expect(out.map(o => o.to)).toEqual(['2026-10-19', '2026-10-18'])
    expect(out.every(o => o.result === 'ok')).toBe(true)
  })

  it("one user's failure is reported and the next user still runs", async () => {
    const repo = fakeRepo([{ id: 'u1', timezone: 'Australia/Brisbane' }, { id: 'u2', timezone: 'Australia/Brisbane' }, { id: 'u3', timezone: 'Australia/Brisbane' }])
    const results: (() => Promise<OuraBackfillResult>)[] = [
      async () => { throw new Error('boom') },
      async () => ({ ok: false, error: 'reauth' }),
      async () => okResult('Oura unavailable'),
    ]
    const backfill = vi.fn(async () => results.shift()!()) as unknown as typeof backfillOuraCloud
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await reconcileOuraCloud({ repo, config: CONFIG, backfill, now: () => NOW })
    expect(out.map(o => o.result)).toEqual(['error', 'reauth', 'stopped_early'])
  })
})

describe('startOuraReconcile', () => {
  it('never starts outside production or without Oura configured', () => {
    expect(startOuraReconcile({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false)
    expect(startOuraReconcile({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

// #3795 item 4: once a week the same pass reaches back two weeks.
describe('the weekly long read (#3795)', () => {
  // Local midday on a Wednesday, and the day after, in Brisbane.
  const WEDNESDAY = new Date('2026-10-21T02:00:00.000Z')
  const THURSDAY = new Date('2026-10-22T02:00:00.000Z')

  it('reaches back 14 days on the user\'s local weekly weekday, covering the night 13 days back, and 3 on any other day', async () => {
    expect(new Date('2026-10-21T12:00:00Z').getUTCDay()).toBe(RECONCILE_WEEKLY_WEEKDAY)
    const repo = fakeRepo([{ id: 'u1', timezone: 'Australia/Brisbane' }])
    const backfill = vi.fn(async () => okResult()) as unknown as typeof backfillOuraCloud
    const [weekly] = await reconcileOuraCloud({ repo, config: CONFIG, backfill, now: () => WEDNESDAY })
    const to = toAestDay(WEDNESDAY, 'Australia/Brisbane')
    expect(weekly.from).toBe(shiftDateStr(to, -(RECONCILE_WEEKLY_DAYS - 1)))
    // Day 13 back is inside the range; day 14 is not.
    expect(weekly.from <= shiftDateStr(to, -13)).toBe(true)
    expect(weekly.from > shiftDateStr(to, -14)).toBe(true)

    const [daily] = await reconcileOuraCloud({ repo, config: CONFIG, backfill, now: () => THURSDAY })
    expect(daily.from).toBe(shiftDateStr(toAestDay(THURSDAY, 'Australia/Brisbane'), -(RECONCILE_DAYS - 1)))
    expect(daily.from > shiftDateStr(daily.to, -13)).toBe(true)
  })

  it('takes the weekday from the user\'s own local day', () => {
    // 21 Oct 02:00 UTC is Wednesday in Brisbane and still Tuesday in New York.
    expect(reconcileDaysFor(toAestDay(WEDNESDAY, 'Australia/Brisbane'))).toBe(RECONCILE_WEEKLY_DAYS)
    expect(reconcileDaysFor(toAestDay(WEDNESDAY, 'America/New_York'))).toBe(RECONCILE_DAYS)
  })
})

// #3795 item 2: what a pass read but did not store is reported, not only a stop.
describe('the reconcile reports what it did not store (#3795)', () => {
  const messages = () => reportServerError.mock.calls.map(c => (c[0] as Error).message)
  const gaps = (over: Partial<Extract<OuraBackfillResult, { ok: true }>['report']>) => ({ ...(okResult() as Extract<OuraBackfillResult, { ok: true }>).report, ...over })

  it('reports non-zero dropped, forbidden and refused-despite-grant counts from a pass', async () => {
    reportServerError.mockClear()
    const repo = fakeRepo([{ id: 'u1', timezone: 'Australia/Brisbane' }])
    const backfill = vi.fn(async () => ({ ok: true, report: gaps({ dropped: 2, forbidden: ['workout'], refusedDespiteGrant: ['daily_stress'] }) })) as unknown as typeof backfillOuraCloud
    const [out] = await reconcileOuraCloud({ repo, config: CONFIG, backfill, now: () => NOW })
    expect(out.result).toBe('ok')
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(3))
    expect(messages()).toEqual(expect.arrayContaining([
      expect.stringContaining('reconcile:dropped: 2 documents'),
      expect.stringContaining('reconcile:forbidden: Oura refused workout'),
      expect.stringContaining('reconcile:refused-despite-grant: Oura refused daily_stress'),
    ]))
  })

  it('reports nothing for a clean pass', async () => {
    reportServerError.mockClear()
    reportReconcileGaps('u1', '2026-10-17', '2026-10-19', gaps({}))
    await new Promise(r => setTimeout(r, 0))
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('reports the expected daily_resilience refusal at most once a day, apart from a new type', async () => {
    reportServerError.mockClear()
    const t0 = Date.parse('2026-10-19T02:00:00Z')
    const expected = (now: number) => reportOuraCloudIssue('reconcile:refused-despite-grant-expected', 'x', { intervalMs: OURA_DAILY_REPORT_INTERVAL_MS }, now)
    expect(expected(t0)).toBe(true)
    expect(expected(t0 + 3 * 60 * 60 * 1000)).toBe(false)
    expect(expected(t0 + OURA_DAILY_REPORT_INTERVAL_MS)).toBe(true)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(2))

    resetOuraCloudReportThrottle()
    reportServerError.mockClear()
    reportReconcileGaps('u1', '2026-10-17', '2026-10-19', gaps({ refusedDespiteGrant: ['daily_resilience'] }))
    reportReconcileGaps('u1', '2026-10-17', '2026-10-19', gaps({ refusedDespiteGrant: ['daily_resilience', 'daily_stress'] }))
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(2))
    expect(messages()).toEqual([
      expect.stringContaining('reconcile:refused-despite-grant-expected: Oura refused daily_resilience'),
      expect.stringContaining('reconcile:refused-despite-grant: Oura refused daily_stress'),
    ])
  })
})

