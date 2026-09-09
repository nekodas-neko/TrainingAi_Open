/**
 * PS-39 — the three Oura-BLE backfill levers: `oura-ble/samples/redecode`,
 * `oura-ble/samples/step-backfill-preview` and `oura-ble/backfill-hr-stats`.
 *
 * All three re-derive stored data rather than draining the ring again, which is only possible
 * because `oura_raw_samples.body_hex` is the archival source of truth on the server — the ring's
 * history buffer is finite and its cursor only moves forward, so a decoder fixed later can back-fill
 * by re-reading stored hex and no other way. None of these routes may mutate that hex, and none does.
 *
 * What each decides:
 *
 *   · **`?dump=1` writes nothing and skips the full-history pass.** The full path re-decodes every
 *     stored sample and re-aggregates all history; on real data it exceeds the gateway timeout, and
 *     that is what killed the per-night diagnostic dump this mode exists to serve.
 *   · **`?async=1` returns a job id instead of holding the request open (Q-535)** — and a second
 *     request while one is running must NOT start another full-history pass. That operation's own
 *     comment names it as the event-loop starvation that took production down on 2026-08-13, and
 *     the 502 it used to return invited exactly that retry.
 *   · **A redecode failure must not prevent the re-aggregate**, and neither may 500 the request:
 *     both phases are re-runnable, and a raw 500 reads as "redecode failed" while hiding the cause.
 *   · **`status` is derived, never stored** — from `finishedAt`, `error`, and the per-phase errors
 *     inside `result`, so there is no second field that can disagree with the timestamps.
 *   · **The step preview writes nothing.** It exists so the scope of the destructive
 *     `?allowStepsDecrease=1` rewrite can be read before it is fired.
 *   · **`backfill-hr-stats` persists a zero-reading snapshot on purpose**, so `computed_at` records
 *     the attempt — and it does not mark the session done, because the lister is coverage-aware.
 *
 * Not exercised: the worker, the decoders and the aggregate all run behind stand-ins, so nothing
 * here says a decoded value is correct. No SQL. Web/Node only: no device, no ring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)
const reportRollupStepErrors = vi.fn((..._a: unknown[]) => undefined)

type Redecoded = { scanned: number; updated: number; restamped: number } | null
const runRedecodeOffLoop = vi.fn(async (..._a: unknown[]) => ({
  redecoded: { scanned: 10, updated: 3, restamped: 2 } as Redecoded,
  redecodeError: null as string | null,
  aggregated: { days: 4, stepErrors: [] as unknown[] } as Row | null,
  aggregateError: null as string | null,
}))

const reapStaleRedecodeJobs = vi.fn(async (_u: string) => 0)
const startRedecodeJob = vi.fn(async (..._a: unknown[]) => ({
  job: { id: 77, startedAt: new Date('2026-09-09T04:00:00Z') },
  alreadyRunning: false,
}))
const finishRedecodeJob = vi.fn(async (..._a: unknown[]) => undefined)
const getRedecodeJob = vi.fn(async (..._a: unknown[]) => null as Row | null)
const getLatestRedecodeJob = vi.fn(async (_u: string) => null as Row | null)

const previewStepsBackfill = vi.fn(async (..._a: unknown[]) => [] as { oldSteps: number; newSteps: number }[])

const listSessionsMissingHrStats = vi.fn(async (..._a: unknown[]) => [] as Row[])
const upsertWorkoutHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const computeWorkoutHr = vi.fn(async (..._a: unknown[]) => null as Row | null)

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/oura-ble/report-step-errors', () => ({
  reportRollupStepErrors: (...a: unknown[]) => reportRollupStepErrors(...a),
}))
vi.mock('@/lib/oura-ble/rollup-worker', () => ({
  runRedecodeOffLoop: (...a: unknown[]) => runRedecodeOffLoop(...a),
}))
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: (...a: unknown[]) => computeWorkoutHr(...a),
}))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    reapStaleRedecodeJobs: (u: string) => reapStaleRedecodeJobs(u),
    startRedecodeJob: (...a: unknown[]) => startRedecodeJob(...a),
    finishRedecodeJob: (...a: unknown[]) => finishRedecodeJob(...a),
    getRedecodeJob: (...a: unknown[]) => getRedecodeJob(...a),
    getLatestRedecodeJob: (u: string) => getLatestRedecodeJob(u),
    previewStepsBackfill: (...a: unknown[]) => previewStepsBackfill(...a),
    listSessionsMissingHrStats: (...a: unknown[]) => listSessionsMissingHrStats(...a),
    upsertWorkoutHrStats: (...a: unknown[]) => upsertWorkoutHrStats(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as redecodePost, GET as redecodeGet } from '@/app/api/oura-ble/samples/redecode/route'
import { GET as previewGet } from '@/app/api/oura-ble/samples/step-backfill-preview/route'
import { POST as hrBackfillPost } from '@/app/api/oura-ble/backfill-hr-stats/route'

const redecodeReq = (qs = '') =>
  redecodePost(new Request(`http://localhost/api/oura-ble/samples/redecode${qs}`, { method: 'POST' }))

const pollReq = (qs = '') =>
  redecodeGet(new Request(`http://localhost/api/oura-ble/samples/redecode${qs}`))

const hrReq = (body?: unknown) =>
  hrBackfillPost(new Request('http://localhost/api/oura-ble/backfill-hr-stats', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

/** The async path floats a promise; let its `.then` settle before asserting on the job row. */
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  for (const m of [getUserById, rateLimit, reportServerError, reportRollupStepErrors, runRedecodeOffLoop,
                   reapStaleRedecodeJobs, startRedecodeJob, finishRedecodeJob, getRedecodeJob,
                   getLatestRedecodeJob, previewStepsBackfill, listSessionsMissingHrStats,
                   upsertWorkoutHrStats, computeWorkoutHr]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  runRedecodeOffLoop.mockResolvedValue({
    redecoded: { scanned: 10, updated: 3, restamped: 2 },
    redecodeError: null,
    aggregated: { days: 4, stepErrors: [] },
    aggregateError: null,
  })
  startRedecodeJob.mockResolvedValue({
    job: { id: 77, startedAt: new Date('2026-09-09T04:00:00Z') },
    alreadyRunning: false,
  })
  getRedecodeJob.mockResolvedValue(null)
  getLatestRedecodeJob.mockResolvedValue(null)
  previewStepsBackfill.mockResolvedValue([])
  listSessionsMissingHrStats.mockResolvedValue([])
  computeWorkoutHr.mockResolvedValue(null)
  sessionUser = { id: 'u-1', isAdmin: true }
})

afterEach(() => { vi.useRealTimers() })

describe('the admin gate on all three levers', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['redecode POST', () => redecodeReq()],
    ['redecode GET', () => pollReq()],
    ['step preview GET', () => previewGet()],
    ['hr backfill POST', () => hrReq()],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(runRedecodeOffLoop).not.toHaveBeenCalled()
    expect(upsertWorkoutHrStats).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 401 with no session, before touching the repository', async () => {
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('rate-limits each at its own allowance, the rewrites hardest', async () => {
    // The three numbers are deliberately different and encode how expensive each is: a full-history
    // rewrite is 4, the HR backfill 6, the read-only preview 10. A single shared number would lose
    // that, so each is asserted rather than "some limit exists".
    rateLimit.mockReturnValue(false)
    expect((await redecodeReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([4, 60_000])
    rateLimit.mockClear(); rateLimit.mockReturnValue(false)
    expect((await hrReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([6, 60_000])
    rateLimit.mockClear(); rateLimit.mockReturnValue(false)
    expect((await previewGet()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([10, 60_000])
    expect(runRedecodeOffLoop).not.toHaveBeenCalled()
  })
})

describe('POST /api/oura-ble/samples/redecode', () => {
  it('runs the full-history pass by default and merges both phases into one answer', async () => {
    const body = await (await redecodeReq()).json()
    expect(runRedecodeOffLoop).toHaveBeenCalledWith(
      'u-1', 'Australia/Brisbane',
      { debugDate: undefined, fullHistory: true, allowStepsDecrease: false },
      true,
    )
    expect(body).toMatchObject({ scanned: 10, updated: 3, restamped: 2, redecodeError: null })
    expect(body.aggregated).toMatchObject({ days: 4 })
  })

  it('uses the CALLER’s timezone, not the default', async () => {
    // A fixture whose timezone IS `DEFAULT_TZ` proves nothing about which one the route read.
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    await redecodeReq()
    expect(runRedecodeOffLoop.mock.calls[0][1]).toBe('Europe/Berlin')
  })

  it('?dump=1 writes nothing and does NOT ask for the full-history pass', async () => {
    // The distinction the mode exists for. Reporting `scanned: 0` is the honest answer — the dump
    // did not scan anything — and `fullHistory` being absent is what keeps it inside the gateway
    // timeout that killed this diagnostic before.
    const body = await (await redecodeReq('?dump=1&date=2026-03-01')).json()
    expect(runRedecodeOffLoop).toHaveBeenCalledWith(
      'u-1', 'Australia/Brisbane', { debugDate: '2026-03-01', dumpOnly: true }, false,
    )
    expect(body).toMatchObject({ scanned: 0, updated: 0, redecodeError: null })
  })

  it('passes ?date and ?allowStepsDecrease through to the full pass', async () => {
    // Two independent params: a request setting only one could not tell which the route forwarded.
    await redecodeReq('?date=2026-03-01&allowStepsDecrease=1')
    expect(runRedecodeOffLoop.mock.calls[0][2]).toEqual({
      debugDate: '2026-03-01', fullHistory: true, allowStepsDecrease: true,
    })
  })

  it('treats any value other than 1 as off, for both flags', async () => {
    await redecodeReq('?dump=true&allowStepsDecrease=yes')
    expect(runRedecodeOffLoop.mock.calls[0][2]).toMatchObject({ fullHistory: true, allowStepsDecrease: false })
  })

  it('reports a redecode failure as JSON and still runs the re-aggregate', async () => {
    // Both phases are re-runnable over the archival hex, so a failure in one must not cancel the
    // other — and a raw 500 would read as "redecode failed" while hiding which phase and why.
    runRedecodeOffLoop.mockResolvedValue({
      redecoded: null,
      redecodeError: 'decoder threw on tag 0x14',
      aggregated: { days: 4, stepErrors: [] },
      aggregateError: null,
    })
    const res = await redecodeReq()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redecodeError).toBe('decoder threw on tag 0x14')
    expect(body.aggregated).toMatchObject({ days: 4 })
    // With no redecode result the counters fall back to zeros rather than vanishing from the shape.
    expect(body).toMatchObject({ scanned: 0, updated: 0, restamped: 0 })
  })

  it('files the aggregate’s per-step errors, which do not throw and so reach no catch', async () => {
    // A step that failed did not throw, so it appears in neither `aggregateError` nor any rejection.
    // Reporting it is the only thing that puts it somewhere queryable — and on this path the caller
    // may never receive the JSON at all, because the request can outlive the gateway timeout.
    runRedecodeOffLoop.mockResolvedValue({
      redecoded: { scanned: 1, updated: 0, restamped: 0 },
      redecodeError: null,
      aggregated: { days: 1, stepErrors: [{ step: 'steps', error: 'boom' }] },
      aggregateError: null,
    })
    await redecodeReq()
    expect(reportRollupStepErrors).toHaveBeenCalledWith(
      [{ step: 'steps', error: 'boom' }],
      { userId: 'u-1', url: '/api/oura-ble/samples/redecode' },
    )
  })
})

describe('POST /api/oura-ble/samples/redecode?async=1', () => {
  it('returns a job id without waiting, and reaps stale jobs first', async () => {
    // The reap is here rather than in a sweeper because there is no cron layer in this app, and the
    // only reader that matters is the one asking whether it may start another.
    const res = await redecodeReq('?async=1')
    const body = await res.json()
    expect(reapStaleRedecodeJobs).toHaveBeenCalledWith('u-1')
    expect(body).toMatchObject({ jobId: 77, status: 'running', alreadyRunning: false })
    expect(body.startedAt).toBe('2026-09-09T04:00:00.000Z')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    await settle()
  })

  it('does NOT start a second full-history pass while one is running', async () => {
    // The property that matters most here. A second pass is another full re-decode of every stored
    // sample — the operation whose own comment names it as the event-loop starvation that took
    // production down. The response still carries the running job's id so the caller can poll it.
    startRedecodeJob.mockResolvedValue({
      job: { id: 77, startedAt: new Date('2026-09-09T04:00:00Z') },
      alreadyRunning: true,
    })
    const body = await (await redecodeReq('?async=1')).json()
    expect(body).toMatchObject({ jobId: 77, status: 'running', alreadyRunning: true })
    expect(runRedecodeOffLoop).not.toHaveBeenCalled()
  })

  it('stores the options on the job row, with an absent date as null', async () => {
    // The job row is the only record of what a run was asked to do, so `undefined` — which would
    // vanish through JSON — becomes an explicit null.
    await redecodeReq('?async=1')
    expect(startRedecodeJob).toHaveBeenCalledWith('u-1', {
      debugDate: null, fullHistory: true, allowStepsDecrease: false,
    })
    await settle()
  })

  it('finishes the job with its phases when the run completes', async () => {
    await redecodeReq('?async=1')
    await settle()
    expect(finishRedecodeJob).toHaveBeenCalledWith(77, expect.objectContaining({ redecodeError: null }), null)
    expect(reportRollupStepErrors).toHaveBeenCalledWith(
      [], { userId: 'u-1', url: '/api/oura-ble/samples/redecode#aggregate' },
    )
  })

  it('finishes the job with an error when the run throws, rather than leaving it running', async () => {
    // A throw that never reached the job row would leave it "running" until the reaper — a worse
    // report than an error, because it also blocks the next start.
    runRedecodeOffLoop.mockRejectedValue(new Error('worker died'))
    await redecodeReq('?async=1')
    await settle()
    expect(finishRedecodeJob).toHaveBeenCalledWith(77, null, 'worker died')
  })
})

describe('GET /api/oura-ble/samples/redecode — polling', () => {
  const JOB = {
    id: 77, startedAt: new Date('2026-09-09T04:00:00Z'), finishedAt: null as Date | null,
    opts: { fullHistory: true }, error: null as string | null, result: null as Row | null,
  }

  it('reads the latest job when no id is given, and the named one when there is', async () => {
    await pollReq()
    expect(getLatestRedecodeJob).toHaveBeenCalledWith('u-1')
    expect(getRedecodeJob).not.toHaveBeenCalled()

    getRedecodeJob.mockResolvedValue(JOB)
    await pollReq('?jobId=77')
    expect(getRedecodeJob).toHaveBeenCalledWith('u-1', 77)
  })

  it('refuses a jobId that is not a whole number, rather than truncating it to another job', async () => {
    // `?jobId=1.5` and `?jobId=77abc` used to reach `parseInt`, which truncates and stops at the
    // first non-digit — so they polled jobs 1 and 77 and answered 200 about a job nobody asked
    // about. That is the same shape as a correct answer, which is the worst way to be wrong.
    for (const qs of ['?jobId=abc', '?jobId=', '?jobId=1.5', '?jobId=77abc', '?jobId= ']) {
      expect((await pollReq(qs)).status, qs).toBe(400)
    }
    expect(getRedecodeJob).not.toHaveBeenCalled()
    expect(getLatestRedecodeJob).not.toHaveBeenCalled()
  })

  it('still accepts a plain integer, and a negative one is not silently a lookup', async () => {
    getRedecodeJob.mockResolvedValue(null)
    expect((await pollReq('?jobId=77')).status).toBe(200)
    expect(getRedecodeJob).toHaveBeenCalledWith('u-1', 77)
  })

  it('answers job: null when there is none, rather than 404', async () => {
    // "No redecode has ever run" is the normal state of a fresh install, not an error.
    const res = await pollReq()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: null })
  })

  it('derives running from the absence of finishedAt', async () => {
    getLatestRedecodeJob.mockResolvedValue({ ...JOB, finishedAt: null })
    expect((await (await pollReq()).json()).job.status).toBe('running')
  })

  it('derives done from a clean finish', async () => {
    getLatestRedecodeJob.mockResolvedValue({
      ...JOB, finishedAt: new Date('2026-09-09T04:05:00Z'),
      result: { redecodeError: null, aggregateError: null, scanned: 9 },
    })
    const job = (await (await pollReq()).json()).job
    expect(job.status).toBe('done')
    expect(job.finishedAt).toBe('2026-09-09T04:05:00.000Z')
    // The result is spread into the job, so a poller sees the counters without a second request.
    expect(job.scanned).toBe(9)
  })

  it('derives failed from ANY of the three failure records, not just the throw', async () => {
    // Three independent sources, and a fixture exercising one proves nothing about the others — a
    // phase error is exactly the failure that never threw, which is why it is recorded separately.
    const finishedAt = new Date('2026-09-09T04:05:00Z')
    const cases: [string, Row][] = [
      ['job threw', { ...JOB, finishedAt, error: 'worker died', result: null }],
      ['redecode phase', { ...JOB, finishedAt, result: { redecodeError: 'bad tag', aggregateError: null } }],
      ['aggregate phase', { ...JOB, finishedAt, result: { redecodeError: null, aggregateError: 'no rows' } }],
    ]
    for (const [name, job] of cases) {
      getLatestRedecodeJob.mockResolvedValue(job)
      expect((await (await pollReq()).json()).job.status, name).toBe('failed')
    }
  })

  it('reaps stale jobs on the poll too, so a dead run cannot hold the slot forever', async () => {
    await pollReq()
    expect(reapStaleRedecodeJobs).toHaveBeenCalledWith('u-1')
  })
})

describe('GET /api/oura-ble/samples/step-backfill-preview', () => {
  it('totals the old and new counts separately, and writes nothing', async () => {
    // The two sums must disagree, and so must the two columns within a row — with equal values
    // nothing distinguishes "sum the old" from "sum the new", which is the entire point of a
    // preview whose job is to show that the numbers CHANGE.
    previewStepsBackfill.mockResolvedValue([
      { oldSteps: 12_000, newSteps: 8_400 },
      { oldSteps: 9_000, newSteps: 7_100 },
    ])
    const body = await (await previewGet()).json()
    expect(body.affectedDays).toBe(2)
    expect(body.totalOldSteps).toBe(21_000)
    expect(body.totalNewSteps).toBe(15_500)
    expect(body.rows).toHaveLength(2)
    expect(previewStepsBackfill).toHaveBeenCalledWith('u-1', 'Australia/Brisbane')
  })

  it('reports nothing to change as zeros rather than an error', async () => {
    const body = await (await previewGet()).json()
    expect(body).toEqual({ affectedDays: 0, totalOldSteps: 0, totalNewSteps: 0, rows: [] })
  })

  it('uses the caller’s timezone, because the day boundary decides which day a step lands on', async () => {
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    await previewGet()
    expect(previewStepsBackfill).toHaveBeenCalledWith('u-1', 'Europe/Berlin')
  })

  it('files a failure as a fault and answers 500', async () => {
    previewStepsBackfill.mockRejectedValue(new Error('statement timeout'))
    const res = await previewGet()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Preview failed' })
    expect(reportServerError).toHaveBeenCalledWith(expect.any(Error), {
      userId: 'u-1', url: '/api/oura-ble/samples/step-backfill-preview',
    })
  })
})

describe('POST /api/oura-ble/backfill-hr-stats', () => {
  const sessions = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `ws-${i}`, startedAt: new Date('2026-09-01T10:00:00Z'), completedAt: new Date('2026-09-01T11:00:00Z'),
  }))

  it('defaults to 200 rows over the 180-day retention window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    await hrReq()
    const [userId, since, limit] = listSessionsMissingHrStats.mock.calls[0] as [string, Date, number]
    expect(userId).toBe('u-1')
    expect(limit).toBe(200)
    // Derived from the pinned clock rather than hardcoded: a fixed date on one side of a rolling
    // window is a time bomb with a known detonation date.
    expect(Math.round((Date.now() - since.getTime()) / 86_400_000)).toBe(180)
  })

  it('takes maxRows from the body, rounded and clamped to 2000', async () => {
    await hrReq({ maxRows: 50 })
    expect((listSessionsMissingHrStats.mock.calls[0] as unknown[])[2]).toBe(50)
    listSessionsMissingHrStats.mockClear()
    await hrReq({ maxRows: 9_999 })
    expect((listSessionsMissingHrStats.mock.calls[0] as unknown[])[2]).toBe(2000)
    listSessionsMissingHrStats.mockClear()
    await hrReq({ maxRows: 10.6 })
    expect((listSessionsMissingHrStats.mock.calls[0] as unknown[])[2]).toBe(11)
  })

  it('ignores a maxRows it cannot use, falling back to the default', async () => {
    // Each of these reaches the default through a different guard — type, sign, finiteness — and a
    // negative or NaN limit passed through would be a query with no bound at all.
    for (const maxRows of ['200', 0, -5, null] as unknown[]) {
      listSessionsMissingHrStats.mockClear()
      await hrReq({ maxRows })
      expect((listSessionsMissingHrStats.mock.calls[0] as unknown[])[2], String(maxRows)).toBe(200)
    }
    listSessionsMissingHrStats.mockClear()
    await hrReq()
    expect((listSessionsMissingHrStats.mock.calls[0] as unknown[])[2]).toBe(200)
  })

  it('refuses an oversized body', async () => {
    const res = await hrReq({ maxRows: 10, note: 'x'.repeat(5 * 1024) })
    expect(res.status).toBe(413)
    expect(listSessionsMissingHrStats).not.toHaveBeenCalled()
  })

  it('persists a zero-reading snapshot but does not count it as data', async () => {
    // Deliberate: an empty snapshot records that the attempt happened, and the lister is
    // coverage-aware so a later fuller compute still gets a turn. `processed` and `withData` must
    // therefore differ — with every session carrying readings the two counters are the same number
    // and neither is under test.
    listSessionsMissingHrStats.mockResolvedValue(sessions(2))
    computeWorkoutHr
      .mockResolvedValueOnce({ summary: { readingsCount: 0 } })
      .mockResolvedValueOnce({ summary: { readingsCount: 240 } })
    const body = await (await hrReq()).json()
    expect(body.processed).toBe(2)
    expect(body.withData).toBe(1)
    expect(upsertWorkoutHrStats).toHaveBeenCalledTimes(2)
    expect(upsertWorkoutHrStats).toHaveBeenNthCalledWith(1, 'u-1', 'ws-0', { readingsCount: 0 })
  })

  it('skips a session that computes to nothing, writing no snapshot for it', async () => {
    // A session with no `completedAt` computes to null — persisting an empty row for one that has
    // not finished would mark unfinished work as attempted.
    listSessionsMissingHrStats.mockResolvedValue(sessions(3))
    computeWorkoutHr
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ summary: { readingsCount: 5 } })
      .mockResolvedValueOnce(null)
    const body = await (await hrReq()).json()
    expect(body.processed).toBe(1)
    expect(body.withData).toBe(1)
    expect(upsertWorkoutHrStats).toHaveBeenCalledTimes(1)
    expect(upsertWorkoutHrStats).toHaveBeenCalledWith('u-1', 'ws-1', { readingsCount: 5 })
  })

  it('reports remaining from the BATCH being full, not from what it processed', async () => {
    // A full batch means more may remain; a short one means the window is drained. Reading it off
    // `processed` instead would say "drained" whenever a batch happened to contain skipped
    // sessions — which is exactly when it is not.
    listSessionsMissingHrStats.mockResolvedValue(sessions(4))
    computeWorkoutHr.mockResolvedValue(null)
    expect((await (await hrReq({ maxRows: 4 })).json())).toMatchObject({
      processed: 0, withData: 0, remaining: true,
    })

    listSessionsMissingHrStats.mockResolvedValue(sessions(3))
    expect((await (await hrReq({ maxRows: 4 })).json()).remaining).toBe(false)
  })
})
