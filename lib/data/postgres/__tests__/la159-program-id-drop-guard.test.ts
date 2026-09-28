// LA-159 — migration 293 drops program_phases.program_id only when no row anywhere holds a value.
// The production measurement behind it could only see the owner's rows (claude_ro is owner-scoped),
// so the guard is what makes the drop safe for every other account. Each case runs inside a
// transaction that re-creates the pre-293 shape and is rolled back, so the shared test database is
// never left altered.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/293_drop_program_phases_program_id.sql'), 'utf8')
const USER = '00000000-0000-4000-8000-000000000159'

describe.skipIf(!canRun)('migration 293 — the program_id drop guard (LA-159)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  /** Runs `fn` against the pre-293 shape, then rolls everything back. */
  async function inPre293Shape(programIdValue: 'set' | 'null', fn: (q: (sql: string) => Promise<unknown[]>) => Promise<void>) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE program_phases ADD COLUMN IF NOT EXISTS program_id uuid')
      await client.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'la159@example.com', 'x') ON CONFLICT (id) DO NOTHING`, [USER])
      const { rows: [program] } = await client.query(
        `INSERT INTO programs (user_id, name) VALUES ($1, 'LA-159') RETURNING id`, [USER])
      const { rows: [set] } = await client.query(
        `INSERT INTO phase_sets (user_id, name) VALUES ($1, 'LA-159') RETURNING id`, [USER])
      await client.query(
        `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, program_id)
         VALUES ($1, 0, 'P', 1, 'normal', $2)`,
        [set.id, programIdValue === 'set' ? program.id : null])
      await client.query(`UPDATE program_phases SET program_id = NULL WHERE phase_set_id <> $1`, [set.id])
      await fn(async sql => (await client.query(sql)).rows)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  const hasColumn = `SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'program_phases' AND column_name = 'program_id'`

  it('keeps the column when any row holds a value', async () => {
    await inPre293Shape('set', async q => {
      await q(MIGRATION)
      expect(await q(hasColumn)).toHaveLength(1)
    })
  })

  it('drops the column when every row is empty', async () => {
    await inPre293Shape('null', async q => {
      await q(MIGRATION)
      expect(await q(hasColumn)).toHaveLength(0)
    })
  })

  it('is a no-op once the column is gone', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(MIGRATION)
      expect((await client.query(hasColumn)).rows).toHaveLength(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
