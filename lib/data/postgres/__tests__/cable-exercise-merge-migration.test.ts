// Migration 164 (Q-5b follow-up) — the two cable groups the owner confirmed are one movement each:
//   Cable Lat Pulldown + Straight Arm Pulldown -> Cable Pulldown
//   Cable Crunch                               -> Cable Crunch Abs
//
// Migration 163 deliberately left these alone because both sides of each group are real
// exercise_library entries and both were actively logged, making the merge a statement about what
// the movements ARE rather than data hygiene.
//
// Runs only against a real Postgres. NOTE: CI's "Tests" job DOES set DATABASE_URL, so these run
// there; reproduce CI locally by setting it too, or vitest silently skips them.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-000000164001'
const USER_B = '00000000-0000-4000-8000-000000164002'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/164_cable_exercise_merge.sql'), 'utf8')

describe.skipIf(!canRun)('migration 164 — cable exercise merge (Q-5b follow-up)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `m164-${id}@example.com`],
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

  async function seedLog(userId: string, name: string, oneRm: number, loggedAt: string) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'M164', $2) RETURNING id`,
      [userId, loggedAt],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
       VALUES ($1, $2, $3, $4)`,
      [ws.rows[0].id, name, oneRm, loggedAt],
    )
  }

  const seedPr = (userId: string, name: string, oneRm: number, achievedAt: string) =>
    pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1,$2,$3,$4)`,
      [userId, name, oneRm, achievedAt],
    )

  const prs = async (userId: string) => (await pool.query(
    `SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1 ORDER BY exercise_name`,
    [userId],
  )).rows

  const logNames = async (userId: string) => (await pool.query(
    `SELECT el.exercise_name, count(*)::int AS n FROM exercise_logs el
     JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE ws.user_id = $1 GROUP BY 1 ORDER BY 1`,
    [userId],
  )).rows

  const run = () => pool.query(migrationSql())

  // Mirrors the production shapes measured before the migration was written.
  async function seedProductionShape(userId: string) {
    for (const [name, v, at] of [
      ['Cable Pulldown', 36, '2026-07-03T02:00:00Z'],
      ['Cable Lat Pulldown', 28.5, '2026-06-08T02:00:00Z'],
      ['Straight Arm Pulldown', 32.5, '2026-06-24T02:00:00Z'],
      ['Cable Crunch', 37.75, '2026-06-25T02:00:00Z'],
      ['Cable Crunch Abs', 39.75, '2026-07-24T02:00:00Z'],
    ] as [string, number, string][]) {
      await seedLog(userId, name, v, at)
      await seedPr(userId, name, v, at)
    }
  }

  it('collapses five rows into the two names the active program uses', async () => {
    await seedProductionShape(USER_A)

    await run()

    expect(await prs(USER_A)).toEqual([
      { exercise_name: 'Cable Crunch Abs', estimated_1rm: 39.75 },
      { exercise_name: 'Cable Pulldown', estimated_1rm: 36 },
    ])
  })

  it('moves the history too, so the surviving PR stays derivable', async () => {
    // A PR-only merge leaves the table asserting a best the logs under that name cannot support,
    // and the next reconcilePersonalRecord call would quietly re-split it.
    await seedProductionShape(USER_A)

    await run()

    expect(await logNames(USER_A)).toEqual([
      { exercise_name: 'Cable Crunch Abs', n: 2 },
      { exercise_name: 'Cable Pulldown', n: 3 },
    ])
  })

  it('folds BOTH pulldown variants into one survivor, not just the first', async () => {
    await seedLog(USER_A, 'Cable Lat Pulldown', 28.5, '2026-06-08T02:00:00Z')
    await seedLog(USER_A, 'Straight Arm Pulldown', 32.5, '2026-06-24T02:00:00Z')
    await seedPr(USER_A, 'Cable Lat Pulldown', 28.5, '2026-06-08T02:00:00Z')
    await seedPr(USER_A, 'Straight Arm Pulldown', 32.5, '2026-06-24T02:00:00Z')

    await run()

    // Neither variant had a `Cable Pulldown` row to fold into, so one is renamed and the other
    // must merge into the row that rename created — not be dropped on the floor.
    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 32.5 }])
  })

  it('renames rather than deletes when the user only ever used a variant', async () => {
    await seedLog(USER_A, 'Straight Arm Pulldown', 31, '2026-06-24T02:00:00Z')
    await seedPr(USER_A, 'Straight Arm Pulldown', 31, '2026-06-24T02:00:00Z')

    await run()

    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 31 }])
  })

  it('keeps the higher number when a variant held it', async () => {
    await seedLog(USER_A, 'Cable Pulldown', 30, '2026-07-03T02:00:00Z')
    await seedLog(USER_A, 'Straight Arm Pulldown', 44, '2026-06-24T02:00:00Z')
    await seedPr(USER_A, 'Cable Pulldown', 30, '2026-07-03T02:00:00Z')
    await seedPr(USER_A, 'Straight Arm Pulldown', 44, '2026-06-24T02:00:00Z')

    await run()

    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 44 }])
  })

  it('keeps the higher number even when NO log can re-derive it', async () => {
    // The case above is carried by the step-4 re-derive over merged logs, so it would still pass
    // with the raise removed. This one isolates the raise: neither row has a log, so step 4's
    // UPDATE never fires and only the raise can move the value.
    await seedPr(USER_A, 'Cable Pulldown', 30, '2026-07-03T02:00:00Z')
    await seedPr(USER_A, 'Straight Arm Pulldown', 44, '2026-06-24T02:00:00Z')

    await run()

    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 44 }])
  })

  it('preserves a variant value no log supports before merging it away', async () => {
    await seedLog(USER_A, 'Cable Crunch', 20, '2026-06-25T02:00:00Z')
    await seedPr(USER_A, 'Cable Crunch', 99, '2026-06-25T02:00:00Z')

    await run()

    const est = await pool.query(
      `SELECT exercise_name, estimated_1rm FROM exercise_estimates WHERE user_id = $1`, [USER_A])
    // Moved onto the surviving name, and not lost.
    expect(est.rows).toEqual([{ exercise_name: 'Cable Crunch Abs', estimated_1rm: 99 }])
  })

  it('never mixes one user’s records into another’s', async () => {
    await seedLog(USER_A, 'Straight Arm Pulldown', 200, '2026-06-24T02:00:00Z')
    await seedLog(USER_B, 'Straight Arm Pulldown', 20, '2026-06-24T02:00:00Z')
    await seedPr(USER_A, 'Straight Arm Pulldown', 200, '2026-06-24T02:00:00Z')
    await seedPr(USER_B, 'Straight Arm Pulldown', 20, '2026-06-24T02:00:00Z')

    await run()

    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 200 }])
    expect(await prs(USER_B)).toEqual([{ exercise_name: 'Cable Pulldown', estimated_1rm: 20 }])
  })

  it('leaves unrelated exercises completely alone', async () => {
    // 163 already reconciled the rest of the table; re-stamping it here would be churn.
    await seedLog(USER_A, 'Barbell Bench Press', 96, '2026-05-21T02:00:00Z')
    await seedPr(USER_A, 'Barbell Bench Press', 92.75, '2026-07-27T02:00:00Z')

    await run()

    expect(await prs(USER_A)).toEqual([{ exercise_name: 'Barbell Bench Press', estimated_1rm: 92.75 }])
  })

  it('is idempotent — a second run changes nothing', async () => {
    await seedProductionShape(USER_A)

    await run()
    const first = await prs(USER_A)
    await run()

    expect(await prs(USER_A)).toEqual(first)
  })

  it('is inert on a user who has none of these rows', async () => {
    await run()
    expect(await prs(USER_B)).toEqual([])
  })
})
