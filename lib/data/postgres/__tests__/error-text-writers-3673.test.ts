// #3673 review round, item 4: error text is scrubbed AT the writers, so a caller that forgets cannot
// store a bound parameter or an echoed value. Each test stores a REAL Drizzle error (a real query
// that Postgres refuses, wrapping the real pg error) and reads the row back. Values are made up.
// Runs only against a real local dev Postgres; skips in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql } from 'drizzle-orm'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000367301'
const MULTI = 'CANARY-first-line\n    at the gym\nCANARY-third-line'
const LATER = 'CANARY-later-parameter'
const WORDS = ['CANARY', 'at the gym']

function clean(text: unknown) {
  const t = typeof text === 'string' ? text : JSON.stringify(text)
  expect(t).toBeTruthy()
  for (const w of WORDS) expect(t, w).not.toContain(w)
}

describe.skipIf(!canRun)('error text is scrubbed at the writer (#3673)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository

  /** A real Drizzle error: Postgres refuses the cast and Drizzle wraps it with the parameters. */
  const realError = async (): Promise<Error> => {
    try { await db.execute(sql`select ${MULTI}::uuid, ${LATER}::text`); throw new Error('expected a failure') } catch (e) { return e as Error }
  }

  beforeAll(async () => {
    const c = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = c.getPool(); db = c.getDb(); repo = await getRepository()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'writers-3673@example.com','x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id=$1`, [USER])
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id=$1`, [USER])
    await pool.query(`DELETE FROM users WHERE id=$1`, [USER])
  })

  it('the real error does carry the values (so the tests below mean something)', async () => {
    const err = await realError()
    expect(err.message).toContain(LATER)
    expect(String((err as { cause?: Error }).cause?.message)).toContain('CANARY-third-line')
  })

  it('finishRedecodeJob: the error column and every string inside result', async () => {
    const err = await realError()
    const { job } = await repo.startRedecodeJob(USER, { fullHistory: true })
    // A caller that stores the RAW text, as the routes and the in-process paths used to.
    await repo.finishRedecodeJob(job.id, {
      redecoded: null,
      redecodeError: err.message,
      aggregated: { stepErrors: [{ step: 'x', message: `${(err as { cause: Error }).cause.message}` }], n: 3 },
      aggregateError: `${err.message}\n  caused by: ${(err as { cause: Error }).cause.message}`,
    }, err.message)
    const { rows: [row] } = await pool.query(`SELECT result, error FROM oura_redecode_jobs WHERE id=$1`, [job.id])
    clean(row.error); clean(row.result)
    expect(row.result.aggregated.n).toBe(3)
    expect(row.error).toContain('Failed query:')
  })

  it('the GET ?jobId= answer scrubs even a row written before the fix', async () => {
    const err = await realError()
    const { job } = await repo.startRedecodeJob(USER, {})
    await pool.query(`UPDATE oura_redecode_jobs SET finished_at=now(), error=$2, result=$3 WHERE id=$1`,
      [job.id, err.message, JSON.stringify({ aggregateError: `x: ${(err as { cause: Error }).cause.message}` })])
    const { describeRedecodeJob } = await import('@/lib/oura-ble/stress-backfill-job')
    const stored = (await repo.getRedecodeJob(USER, job.id))!
    expect(JSON.stringify(stored.result)).toContain('CANARY') // the old row is untouched
    const answer = describeRedecodeJob(stored)
    clean(answer)
    expect(answer.status).toBe('failed')
  })

  it('agent_action_log.error: first line is taken after the scrub', async () => {
    const err = await realError()
    const pg = (err as { cause: Error }).cause
    const run = await repo.startAgentAction({ job: `test-3673-${Math.random().toString(36).slice(2, 8)}`, actor: 'orchestrator', targetUserId: USER })
    const done = await repo.finishAgentAction(run.id, { outcome: 'failed', error: pg.message })
    clean(done!.error)
    const { rows: [row] } = await pool.query(`SELECT error FROM agent_action_log WHERE id=$1`, [run.id])
    clean(row.error)
    expect(row.error).toBe('invalid input syntax for type uuid: "…"')
    const run2 = await repo.startAgentAction({ job: `test-3673-${Math.random().toString(36).slice(2, 8)}`, actor: 'orchestrator', targetUserId: USER })
    const done2 = await repo.finishAgentAction(run2.id, { outcome: 'failed', error: err.message })
    clean(done2!.error)
    expect(done2!.error).toMatch(/^Failed query: /)
  })

  it('the worker\'s msg() keeps the pg code and no value', async () => {
    const { msg } = await import('@/lib/oura-ble/rollup-worker-entry')
    const out = msg(await realError())
    clean(out)
    expect(out).toContain('[22P02]')
    expect(out).toContain('caused by: invalid input syntax for type uuid: "…"')
  })

  it('the in-process redecode and stress-backfill paths, into the job row', async () => {
    const err = await realError()
    vi.resetModules()
    // A built worker bundle (`.rollup-worker/`) may exist in a full run; this test is the in-process path.
    vi.doMock('fs', async (orig) => {
      const actual = await orig<typeof import('fs')>()
      return { ...actual, default: actual, existsSync: (f: unknown) => String(f).includes('.rollup-worker') ? false : actual.existsSync(f as string) }
    })
    vi.doMock('@/lib/data', () => ({
      getRepositoryAsync: async () => ({
        redecodeOuraRawSamples: async () => { throw err },
        aggregateOuraRawSamples: async () => { throw err },
        backfillDaytimeStressBuckets: async () => { throw err },
      }),
    }))
    const w = await import('@/lib/oura-ble/rollup-worker')
    const phases = await w.runRedecodeOffLoop(USER, 'Australia/Brisbane', {}, true)
    const stress = await w.runStressBackfillOffLoop(USER, 'Australia/Brisbane', true)
    vi.doUnmock('@/lib/data')
    vi.doUnmock('fs')
    clean(phases); clean(stress)
    expect(phases.redecodeError).toContain('[22P02]')

    const { job } = await repo.startRedecodeJob(USER, { fullHistory: true })
    await repo.finishRedecodeJob(job.id, { ...phases }, null)
    const { rows: [row] } = await pool.query(`SELECT result FROM oura_redecode_jobs WHERE id=$1`, [job.id])
    clean(row.result)
  })

  it('stress backfill job: a throw that reaches the .catch is stored scrubbed', async () => {
    const err = await realError()
    vi.resetModules()
    vi.doMock('@/lib/oura-ble/rollup-worker', () => ({ runStressBackfillOffLoop: async () => { throw err } }))
    const { startStressBackfillJob } = await import('@/lib/oura-ble/stress-backfill-job')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const started = await startStressBackfillJob(repo, USER, 'Australia/Brisbane', true)
    expect(started.state).toBe('started')
    if (started.state === 'started') await started.done
    vi.doUnmock('@/lib/oura-ble/rollup-worker')
    vi.restoreAllMocks()
    const { rows: [row] } = await pool.query(`SELECT result, error FROM oura_redecode_jobs WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [USER])
    clean(row.error)
  })

  it('rederive-body-battery: days[].error in the admin answer', async () => {
    const err = await realError()
    const { rederiveBodyBattery } = await import('@/lib/health/rederive-body-battery')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const yesterday = shiftDateStr(todayInTz('Australia/Brisbane'), -1)
    const stored = { date: yesterday, endValue: 50, modelVersion: 1, totalCharged: 1, totalDrained: 1 }
    const repoStub = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => prop === 'getBodyBatteryHistory' ? async () => [stored] : async () => { throw err },
    })
    const result = await rederiveBodyBattery({ repo: repoStub as never, userId: USER, tz: 'Australia/Brisbane', from: yesterday, to: yesterday, dryRun: true })
    vi.restoreAllMocks()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.report.days[0].error).toBeTruthy()
      clean(result.report)
    }
  })

  it('body-battery replay: the recording, its serialised form and the replayed answer', async () => {
    const err = await realError()
    const rep = await import('@/lib/health/body-battery-replay')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    const yesterday = shiftDateStr(todayInTz('Australia/Brisbane'), -1)
    const repoStub = new Proxy({} as Record<string, unknown>, { get: (_t, prop) => prop === 'getBodyBatteryHistory' ? async () => [] : async () => { throw err } })
    const { recording, dates } = await rep.captureFinishedDays(repoStub as never, USER, 'Australia/Brisbane', yesterday, yesterday)
    expect(recording.calls.some(c => c.threw !== undefined)).toBe(true)
    clean(recording)
    clean(rep.serialiseRecording(recording))
    const days = await rep.replayFinishedDays(recording, dates)
    expect(days[0].error).toBeTruthy()
    clean(days)
  })

  it('raw-rolled-up-from-server: result.error', async () => {
    const err = await realError()
    const { runRawRolledUpMaintenance } = await import('@/lib/oura-ble/raw-rolled-up-from-server')
    const result = await runRawRolledUpMaintenance({
      plugin: {} as never,
      readWatermark: async () => { throw err },
      isPruneEnabled: () => false,
      now: () => Date.now(),
      loadHistogram: () => ({}),
      saveHistogram: () => {},
      log: () => {},
    })
    expect(result.outcome).toBe('watermark-error')
    clean(result.error)
  })
})
