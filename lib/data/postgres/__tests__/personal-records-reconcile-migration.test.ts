// Migration 163 (Q-5b) — personal_records becomes log-derived, with anything a log cannot account
// for preserved into exercise_estimates first, and three free-text duplicate names merged away.
//
// The migration carries no production row ids: every statement is generic over users, so the whole
// thing is testable here against fixtures.
//
// Runs only against a real Postgres. NOTE: CI's "Tests" job DOES set DATABASE_URL, so these run
// there; reproduce CI locally by setting it too, or vitest silently skips them.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-00000005b001'
const USER_B = '00000000-0000-4000-8000-00000005b002'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/163_personal_records_reconcile.sql'), 'utf8')

describe.skipIf(!canRun)('migration 163 — personal_records reconcile (Q-5b)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `q5b-${id}@example.com`],
      )
    }
  })

  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_A, USER_B]])
  })

  beforeEach(async () => {
    await lock.acquire()
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM exercise_estimates WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
    }
  })

  async function seedLog(
    userId: string, name: string, oneRm: number, loggedAt: string,
    opts: { phaseType?: string | null; earlyDeload?: boolean; exerciseDeloaded?: boolean } = {},
  ) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, phase_type, is_early_deload)
       VALUES ($1, 'Q5B', $2, $3, $4) RETURNING id`,
      [userId, loggedAt, opts.phaseType ?? null, opts.earlyDeload ?? false],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at, exercise_deloaded)
       VALUES ($1, $2, $3, $4, $5)`,
      [ws.rows[0].id, name, oneRm, loggedAt, opts.exerciseDeloaded ?? false],
    )
  }

  const seedPr = (userId: string, name: string, oneRm: number, achievedAt: string) =>
    pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1,$2,$3,$4)`,
      [userId, name, oneRm, achievedAt],
    )

  const prs = async (userId: string) => (await pool.query(
    `SELECT exercise_name, estimated_1rm, achieved_at FROM personal_records WHERE user_id = $1 ORDER BY exercise_name`,
    [userId],
  )).rows

  const estimates = async (userId: string) => (await pool.query(
    `SELECT exercise_name, estimated_1rm FROM exercise_estimates WHERE user_id = $1 ORDER BY exercise_name`,
    [userId],
  )).rows

  const run = () => pool.query(migrationSql())

  it('raises a PR the log path never promoted', async () => {
    // The production Barbell Bench Press case: the best log is OLDER than the PR's own row, so
    // the IfBetter gate never saw it.
    await seedLog(USER_A, 'Q5B Bench', 96, '2026-05-21T02:00:00Z')
    await seedLog(USER_A, 'Q5B Bench', 92.75, '2026-07-27T02:00:00Z')
    await seedPr(USER_A, 'Q5B Bench', 92.75, '2026-07-27T02:00:00Z')

    await run()

    const [row] = await prs(USER_A)
    expect(Number(row.estimated_1rm)).toBe(96)
    expect(new Date(row.achieved_at).toISOString()).toBe('2026-05-21T02:00:00.000Z')
  })

  it('lowers a PR no log supports, and preserves the old value as an estimate first', async () => {
    await seedLog(USER_A, 'Q5B Hammer', 15.75, '2026-06-24T02:00:00Z')
    await seedPr(USER_A, 'Q5B Hammer', 19.25, '2026-06-29T02:00:00Z')

    await run()

    expect(Number((await prs(USER_A))[0].estimated_1rm)).toBe(15.75)
    // The correction is lossless: the number the user typed moves to the table that means
    // "claimed" instead of being deleted, and resolveWorkingBasis still sees it.
    expect(await estimates(USER_A)).toEqual([{ exercise_name: 'Q5B Hammer', estimated_1rm: 19.25 }])
  })

  it('never lets a deloaded log set a PR', async () => {
    await seedLog(USER_A, 'Q5B Squat', 100, '2026-06-01T02:00:00Z')
    await seedLog(USER_A, 'Q5B Squat', 999, '2026-06-02T02:00:00Z', { phaseType: 'deload' })
    await seedLog(USER_A, 'Q5B Squat', 998, '2026-06-03T02:00:00Z', { earlyDeload: true })
    await seedLog(USER_A, 'Q5B Squat', 997, '2026-06-04T02:00:00Z', { exerciseDeloaded: true })
    await seedPr(USER_A, 'Q5B Squat', 100, '2026-06-01T02:00:00Z')

    await run()

    expect(Number((await prs(USER_A))[0].estimated_1rm)).toBe(100)
  })

  it('counts a NULL phase_type as "not deload" (manual-mode programs never set it)', async () => {
    await seedLog(USER_A, 'Q5B Manual', 80, '2026-06-01T02:00:00Z', { phaseType: null })
    await seedPr(USER_A, 'Q5B Manual', 70, '2026-06-01T02:00:00Z')

    await run()

    expect(Number((await prs(USER_A))[0].estimated_1rm)).toBe(80)
  })

  it('re-stamps achieved_at when it points at a different day than the log that earned it', async () => {
    await seedLog(USER_A, 'Q5B Raise', 16.75, '2026-06-21T02:19:00Z')
    await seedPr(USER_A, 'Q5B Raise', 16.75, '2026-06-20T10:04:00Z')

    await run()

    expect(new Date((await prs(USER_A))[0].achieved_at).toISOString()).toBe('2026-06-21T02:19:00.000Z')
  })

  it('leaves achieved_at alone when it differs only by hours within the same day', async () => {
    // The PR was stamped at write time rather than log time on ~25 production rows. Rewriting
    // those is churn on real records with nothing to show for it.
    await seedLog(USER_A, 'Q5B SameDay', 50, '2026-06-21T02:00:00Z')
    await seedPr(USER_A, 'Q5B SameDay', 50, '2026-06-21T22:00:00Z')

    await run()

    expect(new Date((await prs(USER_A))[0].achieved_at).toISOString()).toBe('2026-06-21T22:00:00.000Z')
  })

  it('leaves a PR with no surviving log alone rather than deleting it', async () => {
    await seedPr(USER_A, 'Q5B Orphan', 42, '2026-06-01T02:00:00Z')

    await run()

    expect(Number((await prs(USER_A))[0].estimated_1rm)).toBe(42)
    expect(await estimates(USER_A)).toEqual([{ exercise_name: 'Q5B Orphan', estimated_1rm: 42 }])
  })

  describe('duplicate-name merge', () => {
    it('folds the variant away and moves its history onto the canonical name', async () => {
      await seedLog(USER_A, 'DB lateral Raises', 13.25, '2026-05-30T02:00:00Z')
      await seedLog(USER_A, 'Dumbbell Lateral Raise', 16.75, '2026-06-21T02:00:00Z')
      await seedPr(USER_A, 'DB lateral Raises', 13.25, '2026-05-30T02:00:00Z')
      await seedPr(USER_A, 'Dumbbell Lateral Raise', 16.75, '2026-06-21T02:00:00Z')

      await run()

      const rows = await prs(USER_A)
      expect(rows.map(r => r.exercise_name)).toEqual(['Dumbbell Lateral Raise'])
      expect(Number(rows[0].estimated_1rm)).toBe(16.75)

      // The logs move too. A PR merge alone would leave the table asserting a best the logs under
      // that name cannot support, and the next reconcile would quietly undo it.
      const logs = await pool.query(
        `SELECT el.exercise_name FROM exercise_logs el
         JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = $1`,
        [USER_A],
      )
      expect(logs.rows.every(r => r.exercise_name === 'Dumbbell Lateral Raise')).toBe(true)
    })

    it('renames rather than deletes when the user only ever used the variant', async () => {
      await seedLog(USER_A, 'Dumbell Shoulder Press', 20, '2026-05-25T02:00:00Z')
      await seedPr(USER_A, 'Dumbell Shoulder Press', 20, '2026-05-25T02:00:00Z')

      await run()

      const rows = await prs(USER_A)
      expect(rows.map(r => r.exercise_name)).toEqual(['Dumbbell Shoulder Press'])
      expect(Number(rows[0].estimated_1rm)).toBe(20)
    })

    it('keeps the higher number when the variant held it', async () => {
      await seedLog(USER_A, 'Dumbell Preacher Curl', 30, '2026-05-11T02:00:00Z')
      await seedLog(USER_A, 'Dumbbell Preacher Curl', 24.5, '2026-07-26T02:00:00Z')
      await seedPr(USER_A, 'Dumbell Preacher Curl', 30, '2026-05-11T02:00:00Z')
      await seedPr(USER_A, 'Dumbbell Preacher Curl', 24.5, '2026-07-26T02:00:00Z')

      await run()

      const rows = await prs(USER_A)
      expect(rows.map(r => r.exercise_name)).toEqual(['Dumbbell Preacher Curl'])
      expect(Number(rows[0].estimated_1rm)).toBe(30)
    })
  })

  it('never mixes one user’s records into another’s', async () => {
    // A bare DISTINCT ON (exercise_name) would pick one row across ALL accounts and stamp it onto
    // every user's PR for that movement.
    await seedLog(USER_A, 'Q5B Shared', 200, '2026-06-01T02:00:00Z')
    await seedLog(USER_B, 'Q5B Shared', 50, '2026-06-01T02:00:00Z')
    await seedPr(USER_A, 'Q5B Shared', 190, '2026-06-01T02:00:00Z')
    await seedPr(USER_B, 'Q5B Shared', 40, '2026-06-01T02:00:00Z')

    await run()

    expect(Number((await prs(USER_A))[0].estimated_1rm)).toBe(200)
    expect(Number((await prs(USER_B))[0].estimated_1rm)).toBe(50)
  })

  it('is idempotent — a second run changes nothing', async () => {
    await seedLog(USER_A, 'Q5B Bench', 96, '2026-05-21T02:00:00Z')
    await seedPr(USER_A, 'Q5B Bench', 92.75, '2026-07-27T02:00:00Z')
    await seedLog(USER_A, 'Dumbell Shoulder Press', 20, '2026-05-25T02:00:00Z')
    await seedPr(USER_A, 'Dumbell Shoulder Press', 20, '2026-05-25T02:00:00Z')

    await run()
    const first = { prs: await prs(USER_A), est: await estimates(USER_A) }
    await run()

    expect({ prs: await prs(USER_A), est: await estimates(USER_A) }).toEqual(first)
  })

  it('is inert on a user who has no records at all', async () => {
    await run()
    expect(await prs(USER_B)).toEqual([])
    expect(await estimates(USER_B)).toEqual([])
  })
})
