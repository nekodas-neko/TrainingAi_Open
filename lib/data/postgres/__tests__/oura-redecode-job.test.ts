import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { REDECODE_JOB_STALE_MS, reapStaleRedecodeJobs } from '@/lib/data/postgres/slices/oura'

// Q-535. `POST /api/oura-ble/samples/redecode` awaited the heaviest pair of calls in the app,
// exceeded the gateway timeout, and Railway returned 502 — so the tester printed "redecode failed"
// for work that had completed (measured: `scanned=1098158`, every `sleep_sessions` row stamped
// AFTER the 502). A false failure invites a retry, and a retry is another full-history pass of the
// operation that took production down on 2026-08-13.
//
// The job row is what lets the request return before the work does. These tests are mostly about
// the two ways that goes wrong: two runs at once, and a run whose process died leaving the slot
// held forever.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000535'

describe.skipIf(!canRun)('the redecode job row', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = client.getPool(); db = client.getDb(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `redecode-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id=$1`, [TEST_USER_ID])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  it('starts, reads back, and finishes with the phases verbatim', async () => {
    const { job, alreadyRunning } = await repo.startRedecodeJob(TEST_USER_ID, { fullHistory: true })
    expect(alreadyRunning).toBe(false)
    expect(job.finishedAt).toBeNull()
    expect(job.opts).toEqual({ fullHistory: true })

    const phases = { redecoded: { scanned: 0, updated: 0, restamped: 0 }, redecodeError: null, aggregated: { sleepSessions: 82 }, aggregateError: null }
    await repo.finishRedecodeJob(job.id, phases, null)

    const done = await repo.getRedecodeJob(TEST_USER_ID, job.id)
    expect(done!.finishedAt).not.toBeNull()
    expect(done!.result).toEqual(phases)
    expect(done!.error).toBeNull()
  })

  // The rate limit is 4/min, which does not stop two overlapping runs — and two concurrent
  // full-history re-aggregates are exactly the load this item exists to prevent.
  it('never starts a second run while one is in flight', async () => {
    const first = await repo.startRedecodeJob(TEST_USER_ID, {})
    const second = await repo.startRedecodeJob(TEST_USER_ID, {})
    expect(second.alreadyRunning).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    const { rows } = await pool.query(`SELECT count(*)::int n FROM oura_redecode_jobs WHERE user_id=$1`, [TEST_USER_ID])
    expect(rows[0].n).toBe(1)
  })

  it('allows the next run once the first has finished', async () => {
    const first = await repo.startRedecodeJob(TEST_USER_ID, {})
    await repo.finishRedecodeJob(first.job.id, {}, null)
    const second = await repo.startRedecodeJob(TEST_USER_ID, {})
    expect(second.alreadyRunning).toBe(false)
    expect(second.job.id).not.toBe(first.job.id)
  })

  it('records a throw as an error rather than a result', async () => {
    const { job } = await repo.startRedecodeJob(TEST_USER_ID, {})
    await repo.finishRedecodeJob(job.id, null, 'worker exited')
    const done = await repo.getRedecodeJob(TEST_USER_ID, job.id)
    expect(done!.error).toBe('worker exited')
    expect(done!.result).toBeNull()
  })

  it('finishing twice does not overwrite the first result', async () => {
    const { job } = await repo.startRedecodeJob(TEST_USER_ID, {})
    await repo.finishRedecodeJob(job.id, { first: true }, null)
    await repo.finishRedecodeJob(job.id, { second: true }, 'late error')
    const done = await repo.getRedecodeJob(TEST_USER_ID, job.id)
    expect(done!.result).toEqual({ first: true })
    expect(done!.error).toBeNull()
  })

  // Without this, a process that died mid-run holds the one-at-a-time slot forever and every future
  // redecode is refused — a worse outcome than the 502 this replaces, and a silent one.
  it('reaps a job whose process died, freeing the slot', async () => {
    const { job } = await repo.startRedecodeJob(TEST_USER_ID, {})
    await pool.query(
      `UPDATE oura_redecode_jobs SET started_at = now() - ($2::bigint || ' milliseconds')::interval WHERE id=$1`,
      [job.id, REDECODE_JOB_STALE_MS + 60_000])

    expect(await repo.reapStaleRedecodeJobs(TEST_USER_ID)).toBe(1)
    const reaped = await repo.getRedecodeJob(TEST_USER_ID, job.id)
    expect(reaped!.finishedAt).not.toBeNull()
    expect(reaped!.error).toMatch(/abandoned/)
    // And the slot is free.
    expect((await repo.startRedecodeJob(TEST_USER_ID, {})).alreadyRunning).toBe(false)
  })

  it('does not reap a job that is merely slow', async () => {
    const { job } = await repo.startRedecodeJob(TEST_USER_ID, {})
    await pool.query(
      `UPDATE oura_redecode_jobs SET started_at = now() - ($2::bigint || ' milliseconds')::interval WHERE id=$1`,
      [job.id, REDECODE_JOB_STALE_MS - 60_000])
    expect(await reapStaleRedecodeJobs(db, TEST_USER_ID)).toBe(0)
    expect((await repo.getRedecodeJob(TEST_USER_ID, job.id))!.finishedAt).toBeNull()
  })

  // A job id is handed to a client, so it must not be readable across accounts just because it was
  // guessed.
  it('scopes a job to its own user', async () => {
    const OTHER = '00000000-0000-4000-8000-000000000536'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [OTHER, `redecode-other-${OTHER}@example.com`])
    try {
      const { job } = await repo.startRedecodeJob(TEST_USER_ID, {})
      expect(await repo.getRedecodeJob(OTHER, job.id)).toBeNull()
      expect(await repo.getLatestRedecodeJob(OTHER)).toBeNull()
      // The other user's slot is their own — one in flight per user, not per install.
      expect((await repo.startRedecodeJob(OTHER, {})).alreadyRunning).toBe(false)
    } finally {
      await pool.query(`DELETE FROM oura_redecode_jobs WHERE user_id=$1`, [OTHER])
      await pool.query(`DELETE FROM users WHERE id=$1`, [OTHER])
    }
  })

  it('getLatestRedecodeJob returns the newest', async () => {
    const first = await repo.startRedecodeJob(TEST_USER_ID, { n: 1 })
    await repo.finishRedecodeJob(first.job.id, {}, null)
    const second = await repo.startRedecodeJob(TEST_USER_ID, { n: 2 })
    expect((await repo.getLatestRedecodeJob(TEST_USER_ID))!.id).toBe(second.job.id)
  })
})
