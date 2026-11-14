// #3801 item 3: the `reconcile-personal-records` agent job against a real Postgres. It applies
// reconcilePersonalRecord's own rule (`bestQualifyingPersonalRecord`), adds a missing record, leaves
// a matching one, reports (and never applies) a lower, writes nothing on a dry run, and writes 0 on a
// second run. Skips where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000038013'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('reconcile-personal-records (#3801)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let reconcile: typeof import('@/lib/workout/reconcile-personal-records').reconcilePersonalRecords

  async function log(name: string, rm: number, at: string, opts: { deloaded?: boolean; phase?: string } = {}) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type)
       VALUES ($1, '#3801 PR', $2::timestamptz, $2::timestamptz + interval '1 hour', $3) RETURNING id`,
      [TEST_USER_ID, at, opts.phase ?? null],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, exercise_deloaded)
       VALUES ($1, $2, $3, 100, $4::timestamptz, $5)`,
      [ws.rows[0].id, name, rm, at, opts.deloaded ?? false],
    )
  }
  const stored = async () => Object.fromEntries((await pool.query(
    'SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1', [TEST_USER_ID])).rows
    .map(r => [r.exercise_name, Number(r.estimated_1rm)]))

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    reconcile = (await import('@/lib/workout/reconcile-personal-records')).reconcilePersonalRecords
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `pr-reconcile-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query('DELETE FROM personal_records WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    // Missing: two qualifying logs and no record, plus a deload log that must not count.
    await log('PR Missing Press', 70, '2026-05-02T08:00:00Z')
    await log('PR Missing Press', 75, '2026-05-09T08:00:00Z')
    await log('PR Missing Press', 99, '2026-05-16T08:00:00Z', { phase: 'deload' })
    // Matching: the record equals its best log.
    await log('PR Matching Row', 100, '2026-05-03T08:00:00Z')
    // Higher than any log: reconcile would lower it; the job must not.
    await log('PR Too High', 50, '2026-05-04T08:00:00Z')
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES
         ($1, 'PR Matching Row', 100, '2026-05-03T08:00:00Z'), ($1, 'PR Too High', 60, '2026-05-04T08:00:00Z')`,
      [TEST_USER_ID],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM personal_records WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  it('a dry run reports and writes nothing', async () => {
    const r = await reconcile(repo, TEST_USER_ID, TZ, { dryRun: true })
    expect(r.examined).toBe(3)
    expect(r.summary).toEqual({ add: 1, raise: 0, unchanged: 1, wouldLower: 1, wouldRemove: 0, none: 0, written: 0 })
    expect(r.changes).toEqual([
      { exerciseName: 'PR Missing Press', action: 'add', written: false },
      { exerciseName: 'PR Too High', action: 'lower', written: false },
    ])
    expect(r.achievedOn).toEqual(['2026-05-09'])
    expect(await stored()).toEqual({ 'PR Matching Row': 100, 'PR Too High': 60 })
  })

  it('a write adds the missing record from the best non-deload log and leaves the rest', async () => {
    const r = await reconcile(repo, TEST_USER_ID, TZ, { dryRun: false })
    expect(r.summary.written).toBe(1)
    expect(await stored()).toEqual({ 'PR Matching Row': 100, 'PR Too High': 60, 'PR Missing Press': 75 })
    const at = await pool.query(
      `SELECT achieved_at FROM personal_records WHERE user_id = $1 AND exercise_name = 'PR Missing Press'`, [TEST_USER_ID])
    expect(new Date(at.rows[0].achieved_at).toISOString()).toBe('2026-05-09T08:00:00.000Z')
  })

  it('a second run writes nothing', async () => {
    const r = await reconcile(repo, TEST_USER_ID, TZ, { dryRun: false })
    expect(r.summary).toMatchObject({ add: 0, raise: 0, unchanged: 2, wouldLower: 1, written: 0 })
  })

  it('a named list limits the run to those exercises', async () => {
    const r = await reconcile(repo, TEST_USER_ID, TZ, { dryRun: true, exercises: ['PR Matching Row', 'Never Logged'] })
    expect(r.examined).toBe(2)
    expect(r.summary).toMatchObject({ unchanged: 1, none: 1 })
  })
})
