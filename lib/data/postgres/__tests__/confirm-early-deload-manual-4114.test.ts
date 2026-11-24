// #4114: `confirmEarlyDeload` refuses a manual program before it writes anything; automatic and
// ai_dynamic programs behave as before. Runs only against a real local dev Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { EarlyDeloadNotAvailableError } from '@trainingai/shared/phase-engine'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000d411'
const PROGRAM = '00000000-0000-4000-8000-00000000d412'
const TODAY = '2026-03-05'

describe.skipIf(!canRun)('confirmEarlyDeload by program kind (#4114)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let confirmEarlyDeload: typeof import('@/lib/data/postgres/slices/programs').confirmEarlyDeload

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ confirmEarlyDeload } = await import('@/lib/data/postgres/slices/programs'))
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'early-deload-4114@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  const seed = async (mode: string) => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM])
    await pool.query(`INSERT INTO programs (id, user_id, name, is_active, phase_mode) VALUES ($1, $2, 'P', true, $3)`, [PROGRAM, USER, mode])
    await pool.query(`INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', '2026-03-05T01:00:00Z')`, [USER])
  }
  const state = async () => (await pool.query(
    `SELECT (SELECT to_char(early_deload_week_start, 'YYYY-MM-DD') FROM programs WHERE id = $1) AS start,
            (SELECT count(*)::int FROM workout_sessions WHERE user_id = $2 AND is_early_deload) AS flagged`, [PROGRAM, USER])).rows[0]
  beforeEach(() => seed('manual'))

  it('refuses a manual program and writes nothing', async () => {
    await expect(confirmEarlyDeload(db, USER, PROGRAM, TODAY, 'Australia/Brisbane')).rejects.toBeInstanceOf(EarlyDeloadNotAvailableError)
    expect(await state()).toEqual({ start: null, flagged: 0 })
  })

  it.each(['automatic', 'ai_dynamic'])('confirms a %s program as before', async mode => {
    await seed(mode)
    await confirmEarlyDeload(db, USER, PROGRAM, TODAY, 'Australia/Brisbane')
    expect(await state()).toEqual({ start: TODAY, flagged: 1 })
  })
})
