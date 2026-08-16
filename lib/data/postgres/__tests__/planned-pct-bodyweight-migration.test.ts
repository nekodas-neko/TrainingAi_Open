// Migration 153 (audit finding Q-14) — clear planned_pct where no %1RM was ever prescribed.
//
// A bodyweight movement carries no %1RM: resolveBodyweightStyle turns the style's pct into a REP
// target instead. Storing that pct as planned_pct put it beside a BW_REF-relative intensity_pct on
// a different basis, so every such set recorded a phantom 14-18 pp overshoot against a target that
// never existed.
//
// Unlike migration 152 this one is predicate-driven rather than id-driven, so its real behaviour is
// testable directly: it must clear bodyweight rows, leave weighted rows untouched, and be
// idempotent.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000014'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/153_set_log_planned_reps.sql'), 'utf8')

describe.skipIf(!canRun)('migration 153 — planned_pct on bodyweight sets (Q-14)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `q14-${TEST_USER_ID}@example.com`],
    )
    await pool.query(
      `INSERT INTO exercise_library (name, exercise_type) VALUES ('Q14 Chin', 'bodyweight'), ('Q14 Bench', 'weighted')
       ON CONFLICT (name) DO UPDATE SET exercise_type = EXCLUDED.exercise_type`)
  })

  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM exercise_library WHERE name IN ('Q14 Chin', 'Q14 Bench')`)
  })

  beforeEach(async () => {
    await lock.acquire()
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  /** Seeds one set with the given planned_pct under an exercise of the given name. */
  async function seedSet(exerciseName: string, plannedPct: number) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Q14', now(), now()) RETURNING id`,
      [TEST_USER_ID],
    )
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, $2, 0, now()) RETURNING id`,
      [ws.rows[0].id, exerciseName],
    )
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_pct, intensity_pct)
       VALUES ($1, 1, 0, 6, $2, 88.5)`,
      [el.rows[0].id, plannedPct],
    )
    return el.rows[0].id as string
  }

  const plannedPctOf = async (exerciseLogId: string) => {
    const { rows } = await pool.query(
      `SELECT planned_pct FROM set_logs WHERE exercise_log_id = $1`, [exerciseLogId])
    return rows[0].planned_pct as number | null
  }

  it('clears the phantom percentage on a bodyweight set', async () => {
    const id = await seedSet('Q14 Chin', 75)
    expect(await plannedPctOf(id)).toBe(75)

    await pool.query(migrationSql())

    expect(await plannedPctOf(id)).toBeNull()
  })

  it('leaves a weighted set’s prescribed percentage alone', async () => {
    const id = await seedSet('Q14 Bench', 80)

    await pool.query(migrationSql())

    // Real autoregulation deviations live here and must survive.
    expect(Number(await plannedPctOf(id))).toBe(80)
  })

  it('is idempotent — a second run matches nothing', async () => {
    const bodyweight = await seedSet('Q14 Chin', 68)
    const weighted = await seedSet('Q14 Bench', 72.5)

    await pool.query(migrationSql())
    await pool.query(migrationSql())

    expect(await plannedPctOf(bodyweight)).toBeNull()
    expect(Number(await plannedPctOf(weighted))).toBe(72.5)
  })

  it('adds planned_reps to both set_logs and set_hr_stats', async () => {
    await pool.query(migrationSql())
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'planned_reps'
        ORDER BY table_name`)
    expect(rows.map(r => r.table_name)).toEqual(['set_hr_stats', 'set_logs'])
  })
})
