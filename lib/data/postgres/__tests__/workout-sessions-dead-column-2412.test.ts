import { describe, expect, it, beforeAll } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import type { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { workoutSessions } from '../schema'

// #2412. `workout_sessions.program_session_id` was dead: never written, never read, and the live link
// to `program_sessions` is `session_id`. Step 1 (#3697) stopped the schema declaring it, because
// Drizzle selects every declared column and a drop would have broken every `workout_sessions` read on
// a build that still declared it. Step 2 (202611241514_drop_workout_sessions_program_session_id.sql)
// dropped it. These keep it gone from both the schema file and the database.
//
// `session_periodization.program_session_id` and `prescription_shadow.program_session_id` are
// different, live columns; only `workout_sessions` is asserted here.
const canRun = !!process.env.DATABASE_URL && !/railway|rlwy\.net/i.test(process.env.DATABASE_URL ?? '')

describe('workout_sessions schema (#2412)', () => {
  it('does not declare the dead program_session_id column', () => {
    const columns = Object.values(getTableColumns(workoutSessions)).map(c => c.name)
    expect(columns).not.toContain('program_session_id')
  })

  it('keeps the live link to program_sessions on session_id', () => {
    expect(getTableColumns(workoutSessions).programSessionId.name).toBe('session_id')
  })
})

describe.skipIf(!canRun)('workout_sessions in the database after migrations (#2412)', () => {
  let pool: Pool

  beforeAll(async () => {
    const { ensureSchema, getPool } = await import('../client')
    await ensureSchema()
    pool = getPool()
  })

  it('has no program_session_id column', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workout_sessions' AND column_name = 'program_session_id'`)
    expect(rows).toHaveLength(0)
  })

  it('has no foreign key left over from it', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_program_session_id_fkey'`)
    expect(rows).toHaveLength(0)
  })

  it('still has the live session_id link', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workout_sessions' AND column_name = 'session_id'`)
    expect(rows).toHaveLength(1)
  })

  it('the claude_ro view does not list it either', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'claude_ro' AND table_name = 'workout_sessions' AND column_name = 'program_session_id'`)
    expect(rows).toHaveLength(0)
  })

  it('the generated views file does not name it for workout_sessions', () => {
    const sql = readFileSync(join(process.cwd(), 'lib/data/postgres/claude-ro-views.sql'), 'utf8')
    const view = sql.match(/CREATE VIEW claude_ro\.workout_sessions AS[\s\S]*?FROM public\.workout_sessions/)?.[0] ?? ''
    expect(view).toContain('t.session_id')
    expect(view).not.toContain('program_session_id')
  })
})
