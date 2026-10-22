// #3079: the daily reconciliation re-reads the last three days for every connected user through the
// connect backfill's code, with the night re-score attached, and one user's failure never stops the
// next. Oura and the repository are fakes; nothing reaches Oura or a database.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { OuraBackfillResult, backfillOuraCloud } from '../backfill'
import { NO_WRITES } from '../ingest'
import { reconcileOuraCloud, startOuraReconcile, RECONCILE_DAYS } from '../reconcile'
import { resetOuraCloudReportThrottle } from '../report'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

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
      // #3087, #3153: and tombstones a workout or session gone from Oura's list for a day it re-read.
      expect(opts).toEqual({ from: shiftDateStr(to, -(RECONCILE_DAYS - 1)), to, dryRun: false, heartRate: true, tz, tombstoneAbsent: true })
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
